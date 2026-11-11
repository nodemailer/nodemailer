import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { SMTPServer } from 'smtp-server';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import nodemailer from '../../src/nodemailer.js';

const message = { from: 'from@example.test', to: 'to@example.test', text: 'hello' };

// Keep the server's writable side open after the client sends FIN. A normal
// server closes it automatically and can mask a client socket left alive.
async function halfOpenServer(options: { silentGreeting?: boolean; holdFirstData?: boolean } = {}) {
    const peers = new Set<net.Socket>();
    let dataCount = 0;
    let signalBody!: () => void;
    const firstBody = new Promise<void>(resolve => (signalBody = resolve));
    let signalData!: () => void;
    const firstData = new Promise<void>(resolve => (signalData = resolve));
    const server = net.createServer({ allowHalfOpen: true }, socket => {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.on('error', () => {});
        if (!options.silentGreeting) socket.write('220 localhost ESMTP\r\n');
        let buffer = '';
        let inData = false;
        socket.on('data', chunk => {
            buffer += chunk.toString();
            let index: number;
            while ((index = buffer.indexOf('\r\n')) !== -1) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 2);
                if (inData) {
                    signalBody();
                    if (line === '.') {
                        inData = false;
                        dataCount++;
                        signalData();
                        if (!options.holdFirstData || dataCount > 1) socket.write('250 accepted\r\n');
                    }
                } else if (/^(EHLO|HELO)/.test(line)) socket.write('250 localhost\r\n');
                else if (/^(MAIL|RCPT)/.test(line)) socket.write('250 OK\r\n');
                else if (line === 'DATA') {
                    inData = true;
                    socket.write('354 continue\r\n');
                } else if (line === 'QUIT') socket.write('221 bye\r\n');
            }
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
        port: (server.address() as net.AddressInfo).port,
        firstData,
        firstBody,
        get dataCount() {
            return dataCount;
        },
        async close() {
            for (const socket of peers) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    };
}

describe('SMTP socketCloseTimeout integration', { timeout: 5000 }, () => {
    for (const pool of [false, true]) {
        it(`destroys the native socket when an active ${pool ? 'pooled' : 'direct'} send is aborted`, async t => {
            const server = await halfOpenServer({ holdFirstData: true });
            const sockets: net.Socket[] = [];
            const connect = net.connect;
            t.mock.method(net, 'connect', ((...args: any[]) => {
                const socket = (connect as any)(...args) as net.Socket;
                sockets.push(socket);
                return socket;
            }) as typeof net.connect);
            const transport = nodemailer.createTransport({
                host: '127.0.0.1',
                port: server.port,
                ignoreTLS: true,
                pool,
                maxConnections: 1,
                socketCloseTimeout: 0
            });
            const controller = new AbortController();
            let calls = 0;
            try {
                const result = new Promise<any>(resolve =>
                    transport.sendMail({ ...message, signal: controller.signal }, err => {
                        calls++;
                        resolve(err);
                    })
                );
                await server.firstData;
                controller.abort();
                const error = await result;
                assert.strictEqual(error.code, 'EABORT');
                assert.strictEqual(sockets[0].destroyed, true);
                if (pool) {
                    await transport.sendMail(message);
                    assert.strictEqual(server.dataCount, 2);
                }
                assert.strictEqual(calls, 1);
            } finally {
                transport.close({ force: true });
                for (const socket of sockets) socket.destroy();
                await server.close();
            }
        });
    }

    for (const action of ['force', 'timeout'] as const) {
        it(`destroys a native socket on ${action === 'force' ? 'forced pool close during DATA' : 'greeting timeout'}`, async t => {
            const server = await halfOpenServer(action === 'force' ? { holdFirstData: true } : { silentGreeting: true });
            const sockets: net.Socket[] = [];
            const connect = net.connect;
            t.mock.method(net, 'connect', ((...args: any[]) => {
                const socket = (connect as any)(...args) as net.Socket;
                sockets.push(socket);
                return socket;
            }) as typeof net.connect);
            const transport = nodemailer.createTransport({
                host: '127.0.0.1',
                port: server.port,
                ignoreTLS: true,
                pool: action === 'force',
                greetingTimeout: 100,
                socketCloseTimeout: 0
            });
            try {
                const sending = transport.sendMail(message);
                const failed = assert.rejects(sending);
                if (action === 'force') {
                    await server.firstData;
                    transport.close({ force: true });
                }
                await failed;
                assert.strictEqual(sockets[0].destroyed, true);
            } finally {
                transport.close({ force: true });
                for (const socket of sockets) socket.destroy();
                await server.close();
            }
        });
    }
    it('destroys a pooled socket on DATA acknowledgement timeout without requeueing', async t => {
        const server = await halfOpenServer({ holdFirstData: true });
        const sockets: net.Socket[] = [];
        const connect = net.connect;
        t.mock.method(net, 'connect', ((...args: any[]) => {
            const socket = (connect as any)(...args) as net.Socket;
            sockets.push(socket);
            return socket;
        }) as typeof net.connect);
        const transport = nodemailer.createTransport({
            host: '127.0.0.1',
            port: server.port,
            ignoreTLS: true,
            pool: true,
            maxConnections: 1,
            maxRequeues: 0,
            socketTimeout: 100,
            socketCloseTimeout: 0
        });
        try {
            let calls = 0;
            const result = new Promise<any>(resolve =>
                transport.sendMail(message, err => {
                    calls++;
                    resolve(err);
                })
            );
            await server.firstData;
            const error = await result;
            assert.strictEqual(error.code, 'ETIMEDOUT');
            assert.strictEqual(sockets[0].destroyed, true);
            await new Promise(resolve => setTimeout(resolve, 120));
            assert.strictEqual(calls, 1);
            assert.strictEqual(sockets.length, 1);
            assert.strictEqual(server.dataCount, 1);
        } finally {
            transport.close({ force: true });
            for (const socket of sockets) socket.destroy();
            await server.close();
        }
    });

    it('destroys the upgraded STARTTLS socket when an encrypted reply is pending', async t => {
        const { key, cert } = new SMTPServer({ logger: false, secure: true }).options;
        const peers = new Set<net.Socket>();
        let securePeer: tls.TLSSocket | undefined;
        let postTlsEhlo!: () => void;
        const upgraded = new Promise<void>(resolve => (postTlsEhlo = resolve));
        const server = net.createServer({ allowHalfOpen: true }, socket => {
            peers.add(socket);
            socket.on('close', () => peers.delete(socket));
            socket.on('error', () => {});
            socket.write('220 localhost ESMTP\r\n');
            const onPlainData = (data: Buffer) => {
                if (/^EHLO/i.test(data.toString())) socket.write('250-localhost\r\n250 STARTTLS\r\n');
                else if (/^STARTTLS/i.test(data.toString())) {
                    socket.removeListener('data', onPlainData);
                    socket.write('220 Ready for TLS\r\n');
                    securePeer = new tls.TLSSocket(socket, { isServer: true, key, cert });
                    securePeer.on('error', () => {});
                    securePeer.on('data', chunk => {
                        if (/^EHLO/i.test(chunk.toString())) postTlsEhlo();
                    });
                }
            };
            socket.on('data', onPlainData);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const sockets: tls.TLSSocket[] = [];
        const connect = tls.connect;
        t.mock.method(tls, 'connect', ((...args: any[]) => {
            const socket = (connect as any)(...args) as tls.TLSSocket;
            sockets.push(socket);
            return socket;
        }) as typeof tls.connect);
        const transport = nodemailer.createTransport({
            host: '127.0.0.1',
            port: (server.address() as net.AddressInfo).port,
            requireTLS: true,
            tls: { rejectUnauthorized: false },
            socketCloseTimeout: 0
        });
        const controller = new AbortController();
        try {
            const sending = transport.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, { code: 'EABORT' });
            await upgraded;
            assert.strictEqual(sockets.length, 1);
            assert.strictEqual(sockets[0].encrypted, true);
            controller.abort();
            await cancelled;
            assert.strictEqual(sockets[0].destroyed, true);
        } finally {
            transport.close({ force: true });
            for (const socket of sockets) socket.destroy();
            securePeer?.destroy();
            for (const socket of peers) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('destroys the socket and releases the attachment stream during DATA', async t => {
        const server = await halfOpenServer();
        const sockets: net.Socket[] = [];
        const connect = net.connect;
        t.mock.method(net, 'connect', ((...args: any[]) => {
            const socket = (connect as any)(...args) as net.Socket;
            sockets.push(socket);
            return socket;
        }) as typeof net.connect);
        const transport = nodemailer.createTransport({ host: '127.0.0.1', port: server.port, ignoreTLS: true, socketCloseTimeout: 0 });
        const controller = new AbortController();
        const source = new PassThrough();
        try {
            const sending = transport.sendMail({ ...message, signal: controller.signal, attachments: [{ filename: 'test.txt', content: source }] });
            const cancelled = assert.rejects(sending, { code: 'EABORT' });
            source.write('partial attachment');
            await server.firstBody;
            controller.abort();
            await cancelled;
            assert.strictEqual(sockets[0].destroyed, true);
            assert.strictEqual(source.destroyed, true);
        } finally {
            source.destroy();
            transport.close({ force: true });
            for (const socket of sockets) socket.destroy();
            await server.close();
        }
    });

    it('destroys the native socket when aborted during the TLS handshake', async t => {
        const peers = new Set<net.Socket>();
        let accepted!: () => void;
        const connected = new Promise<void>(resolve => (accepted = resolve));
        const server = net.createServer({ allowHalfOpen: true }, socket => {
            peers.add(socket);
            socket.on('close', () => peers.delete(socket));
            socket.on('error', () => {});
            accepted();
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const sockets: tls.TLSSocket[] = [];
        const connect = tls.connect;
        t.mock.method(tls, 'connect', ((...args: any[]) => {
            const socket = (connect as any)(...args) as tls.TLSSocket;
            sockets.push(socket);
            return socket;
        }) as typeof tls.connect);
        const transport = nodemailer.createTransport({
            host: '127.0.0.1',
            port: (server.address() as net.AddressInfo).port,
            secure: true,
            socketCloseTimeout: 0
        });
        const controller = new AbortController();
        try {
            const sending = transport.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, { code: 'EABORT' });
            await connected;
            controller.abort();
            await cancelled;
            assert.strictEqual(sockets[0].destroyed, true);
        } finally {
            transport.close({ force: true });
            for (const socket of sockets) socket.destroy();
            for (const socket of peers) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('destroys the native TLS socket when aborted while awaiting the greeting', async t => {
        // Reuse smtp-server's test certificate but keep the peer half-open ourselves.
        const { key, cert } = new SMTPServer({ logger: false, secure: true }).options;
        const peers = new Set<tls.TLSSocket>();
        let handshake!: () => void;
        const ready = new Promise<void>(resolve => (handshake = resolve));
        const server = tls.createServer({ key, cert, allowHalfOpen: true }, socket => {
            peers.add(socket);
            socket.on('close', () => peers.delete(socket));
            socket.on('error', () => {});
            handshake();
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const sockets: tls.TLSSocket[] = [];
        const connect = tls.connect;
        t.mock.method(tls, 'connect', ((...args: any[]) => {
            const socket = (connect as any)(...args) as tls.TLSSocket;
            sockets.push(socket);
            return socket;
        }) as typeof tls.connect);
        const transport = nodemailer.createTransport({
            host: '127.0.0.1',
            port: (server.address() as net.AddressInfo).port,
            secure: true,
            tls: { rejectUnauthorized: false },
            socketCloseTimeout: 0
        });
        const controller = new AbortController();
        try {
            const sending = transport.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, { code: 'EABORT' });
            await ready;
            controller.abort();
            await cancelled;
            assert.strictEqual(sockets[0].destroyed, true);
        } finally {
            transport.close({ force: true });
            for (const socket of sockets) socket.destroy();
            for (const socket of peers) socket.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
