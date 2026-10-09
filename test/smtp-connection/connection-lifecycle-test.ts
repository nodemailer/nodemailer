import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
import SMTPConnection from '../../src/smtp-connection/index.js';
import * as shared from '../../src/shared/index.js';
import { closeRawServer as closeServer, createClient, startRawServerAsync as rawServer, type RawServer } from './raw-smtp-server.js';
import { captureLogger, freePort } from '../smtp-transport/smtp-fixtures.js';
import type { NodemailerError } from '../../src/errors.js';

const EHLO_WITH_STARTTLS = '250-test\r\n250-STARTTLS\r\n250-PIPELINING\r\n250-SIZE 1000\r\n250 AUTH PLAIN LOGIN\r\n';

describe('SMTPConnection STARTTLS upgrade', { timeout: 10000 }, () => {
    it('keeps the extensions of the plaintext session but not AUTH when opportunisticTLS falls back', async () => {
        const server = await rawServer({ EHLO: EHLO_WITH_STARTTLS, STARTTLS: '454 4.7.0 TLS not available\r\n' });
        try {
            const client = createClient(server, { ignoreTLS: false, opportunisticTLS: true });
            await new Promise<void>((resolve, reject) => {
                client.once('error', reject);
                client.connect(() => resolve());
            });

            assert.strictEqual(client.secure, false);
            // credentials are not sent over a connection that failed to encrypt
            assert.strictEqual(client.allowsAuth, false);
            assert.deepStrictEqual(client._supportedAuth, []);
            assert.deepStrictEqual(client._supportedExtensions, ['PIPELINING', 'SIZE']);
            assert.strictEqual(client._maxAllowedSize, 1000);
            client.close();
        } finally {
            await closeServer(server);
        }
    });

    it('times out a TLS handshake the server never completes', async () => {
        // the server agrees to STARTTLS and then never answers the client hello
        const server = await rawServer({ EHLO: EHLO_WITH_STARTTLS, STARTTLS: '220 2.0.0 Ready to start TLS\r\n' });
        try {
            const client = createClient(server, { ignoreTLS: false, greetingTimeout: 300, socketTimeout: 60 * 1000 });
            const started = Date.now();
            const err = await new Promise<NodemailerError>((resolve, reject) => {
                client.once('error', resolve);
                client.connect(() => reject(new Error('connected')));
            });

            assert.strictEqual(err.code, 'ETIMEDOUT');
            assert.strictEqual(err.message, 'TLS handshake timed out');
            assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
        } finally {
            await closeServer(server);
        }
    });

    it('warns about plaintext that follows the STARTTLS response', async () => {
        const { logger, lines } = captureLogger();
        // the injected line must never be read as a response of the TLS session
        const server = await rawServer({ EHLO: EHLO_WITH_STARTTLS, STARTTLS: '220 2.0.0 Ready to start TLS\r\n250 injected\r\n' });
        try {
            const client = createClient(server, { ignoreTLS: false, greetingTimeout: 300, logger: logger as any });
            await new Promise<void>(resolve => {
                client.once('error', () => resolve());
                client.connect(() => resolve());
            });

            const warnings = lines.filter(line => line.level === 'warn').map(line => line.message);
            assert.ok(warnings.includes('Discarded 12 bytes received in plaintext after the STARTTLS response'), warnings.join('; '));
        } finally {
            await closeServer(server);
        }
    });
});

describe('SMTPConnection close', { timeout: 20000 }, () => {
    it('destroys the socket when the server never closes its side', async () => {
        // the server answers the session but ignores the FIN of the client
        const sockets = new Set<net.Socket>();
        const server = net.createServer({ allowHalfOpen: true }, socket => {
            sockets.add(socket);
            socket.on('error', () => false);
            socket.write('220 test ESMTP\r\n');
            socket.on('data', chunk => {
                if (/^EHLO /i.test(chunk.toString())) {
                    socket.write('250 test\r\n');
                }
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const client = createClient({ port: (server.address() as net.AddressInfo).port } as RawServer);
            await new Promise<void>((resolve, reject) => {
                client.once('error', reject);
                client.connect(() => resolve());
            });

            const socket = client._socket as net.Socket;
            client.close();
            assert.ok(!socket.destroyed, 'close() ends the socket gracefully first');
            await new Promise<void>(resolve => socket.once('close', () => resolve()));
        } finally {
            for (const socket of sockets) {
                socket.destroy();
            }
            await new Promise(resolve => server.close(resolve));
        }
    });
});

describe('SMTPConnection error logging', { timeout: 10000 }, () => {
    it('logs the error message as is, without reading the server response as a format string', async () => {
        const { logger, lines } = captureLogger();

        const server = await rawServer({ EHLO: '421 4.4.2 %s closing\r\n' });
        try {
            const client = createClient(server, { logger: logger as any });
            const err = await new Promise<NodemailerError>((resolve, reject) => {
                client.once('error', resolve);
                client.connect(() => reject(new Error('connected')));
            });
            assert.deepStrictEqual(
                lines.filter(line => ['warn', 'error', 'fatal'].includes(line.level)).map(line => line.message),
                [err.message]
            );
        } finally {
            await closeServer(server);
        }
    });
});

describe('SMTPConnection connecting', { timeout: 20000 }, () => {
    // resolve4 and resolve6 answer with the given addresses, or never when the value is null
    let originalResolver: any;
    const stubResolver = (answers: { [family: string]: string[] | null }) => {
        (dns as any).Resolver = class {
            resolve4(hostname: string, callback: (err: Error | null, addresses?: string[]) => void) {
                if (answers[4]) {
                    setImmediate(() => callback(null, answers[4] as string[]));
                }
            }
            resolve6(hostname: string, callback: (err: Error | null, addresses?: string[]) => void) {
                if (answers[6]) {
                    setImmediate(() => callback(null, answers[6] as string[]));
                }
            }
            cancel() {
                // nothing to cancel
            }
        };
    };

    beforeEach(() => {
        originalResolver = dns.Resolver;
        shared.dnsCache.clear();
    });
    afterEach(() => {
        (dns as any).Resolver = originalResolver;
        shared.dnsCache.clear();
    });

    const connectError = (client: SMTPConnection): Promise<NodemailerError> =>
        new Promise((resolve, reject) => {
            client.once('error', resolve);
            client.connect(() => reject(new Error('connected')));
        });

    it('counts the DNS lookup against the connection timeout', async () => {
        stubResolver({ 4: null, 6: null });
        const client = new SMTPConnection({
            host: 'silent.example.test',
            port: 25,
            connectionTimeout: 300,
            dnsTimeout: 30000,
            logger: false
        });
        const started = Date.now();
        const err = await connectError(client);
        assert.strictEqual(err.code, 'EDNS');
        assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`);
    });

    it('keeps the system error code of a failed connection', async () => {
        const port = await freePort();
        const err = await connectError(new SMTPConnection({ host: '127.0.0.1', port, logger: false }));
        assert.strictEqual(err.code, 'ESOCKET');
        assert.strictEqual(err.originalCode, 'ECONNREFUSED');
    });

    it('tells the greeting timeout apart from the other timeouts', async () => {
        const server = await rawServer({ greeting: false });
        try {
            const err = await connectError(createClient(server, { greetingTimeout: 200 }));
            assert.strictEqual(err.code, 'ETIMEDOUT');
            assert.strictEqual(err.timeoutType, 'GREETING_TIMEOUT');
        } finally {
            await closeServer(server);
        }
    });

    it('enables TCP keepalive with a short idle delay and turns Nagle off', async t => {
        const calls: unknown[][] = [];
        const noDelay: unknown[][] = [];
        const setKeepAlive = net.Socket.prototype.setKeepAlive;
        const setNoDelay = net.Socket.prototype.setNoDelay;
        t.mock.method(net.Socket.prototype, 'setKeepAlive', function (this: net.Socket, ...args: unknown[]) {
            calls.push(args);
            return setKeepAlive.apply(this, args as [boolean, number]);
        });
        t.mock.method(net.Socket.prototype, 'setNoDelay', function (this: net.Socket, ...args: unknown[]) {
            noDelay.push(args);
            return setNoDelay.apply(this, args as [boolean]);
        });
        const server = await rawServer({});
        try {
            const client = createClient(server);
            await new Promise<void>((resolve, reject) => {
                client.once('error', reject);
                client.connect(() => resolve());
            });
            client.close();
            assert.ok(calls.length >= 1);
            assert.strictEqual(calls[0][0], true);
            assert.ok(Number(calls[0][1]) > 0 && Number(calls[0][1]) <= 60 * 1000, `delay ${calls[0][1]}`);
            assert.deepStrictEqual(noDelay, [[true]]);
        } finally {
            await closeServer(server);
        }
    });

    it('moves on to IPv4 quickly when the IPv6 address does not answer', async t => {
        // 100::1 is in the IPv6 discard prefix, a connection to it never completes
        stubResolver({ 4: ['127.0.0.1'], 6: ['100::1'] });
        const connectOptions: any[] = [];
        const connect = net.connect;
        t.mock.method(net, 'connect', (...args: any[]) => {
            connectOptions.push(args[0]);
            return (connect as any)(...args);
        });
        const server = await rawServer({});
        try {
            const client = new SMTPConnection({
                host: 'dualstack.example.test',
                port: server.port,
                allowInternalNetworkInterfaces: true,
                ignoreTLS: true,
                connectionTimeout: 15000,
                logger: false
            });
            const started = Date.now();
            await new Promise<void>((resolve, reject) => {
                client.once('error', reject);
                client.connect(() => resolve());
            });
            assert.ok(Date.now() - started < 5000, `took ${Date.now() - started}ms`);
            client.close();

            // both families are handed to net.connect at once, IPv6 first
            assert.strictEqual(connectOptions.length, 1);
            assert.strictEqual(connectOptions[0].autoSelectFamily, true);
            const addresses = await new Promise<any>(resolve =>
                connectOptions[0].lookup('dualstack.example.test', { all: true }, (err: any, all: any) => resolve(err || all))
            );
            assert.deepStrictEqual(addresses, [
                { address: '100::1', family: 6 },
                { address: '127.0.0.1', family: 4 }
            ]);
        } finally {
            await closeServer(server);
        }
    });
});
