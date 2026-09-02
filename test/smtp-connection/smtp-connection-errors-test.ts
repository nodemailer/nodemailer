/**
 * Failure handling of SMTPConnection: rejected replies at every stage of the
 * session, TLS upgrade and connection failures, envelope validation and the
 * guards that apply once the connection has been torn down.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import SMTPConnection from '../../src/smtp-connection/index.js';
import type { NodemailerError } from '../../src/errors.js';
import { SMTPServer } from 'smtp-server';
import { startRawServer, finishRawServer, createClient, type RawServer } from './raw-smtp-server.js';

/**
 * Connects the client, expects the session to fail before the connect callback
 * runs and hands the emitted error to the assertions once the server is closed
 */
function expectConnectError(
    client: SMTPConnection,
    server: RawServer,
    done: (err?: unknown) => void,
    assertions: (err: NodemailerError) => void
): void {
    let error: NodemailerError | undefined;
    let connected = false;

    client.on('error', err => {
        error = err;
    });

    client.on('end', () => {
        finishRawServer(server, done, () => {
            assert.strictEqual(connected, false, 'the connect callback must not run');
            assert.ok(error, 'expected an error event');
            assertions(error);
        });
    });

    client.connect(() => {
        connected = true;
    });
}

describe('SMTP-Connection failure handling', () => {
    describe('Defaults', () => {
        it('uses a secure connection by default on port 465', () => {
            const implicit = new SMTPConnection({ port: 465, logger: false });
            assert.strictEqual(implicit.secureConnection, true);
            assert.strictEqual(implicit.secure, true);

            const explicit = new SMTPConnection({ port: 465, secure: false, logger: false });
            assert.strictEqual(explicit.secureConnection, false);

            const other = new SMTPConnection({ port: 587, logger: false });
            assert.strictEqual(other.secureConnection, false);
        });

        it('derives the EHLO name from the machine hostname', t => {
            const hostname = t.mock.method(os, 'hostname', () => 'mail.example.com');
            assert.strictEqual(new SMTPConnection({ logger: false }).name, 'mail.example.com');

            // a name without a dot is not a FQDN
            hostname.mock.mockImplementation(() => 'myhost');
            assert.strictEqual(new SMTPConnection({ logger: false }).name, '[127.0.0.1]');

            // an IP address must be enclosed in brackets
            hostname.mock.mockImplementation(() => '10.0.0.1');
            assert.strictEqual(new SMTPConnection({ logger: false }).name, '[10.0.0.1]');

            hostname.mock.mockImplementation(() => {
                throw new Error('hostname unavailable');
            });
            assert.strictEqual(new SMTPConnection({ logger: false }).name, '[127.0.0.1]');

            // an explicit name always wins
            assert.strictEqual(new SMTPConnection({ name: 'client.example.com', logger: false }).name, 'client.example.com');
        });
    });

    describe('Calls on a destroyed connection', () => {
        it('connect() reports ECONNECTION', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            client._destroy();
            client.connect(err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ECONNECTION');
                assert.strictEqual(err.command, 'CONN');
                assert.strictEqual(err.message, 'Cannot connect - smtp connection is already destroyed.');
                done();
            });
        });

        it('login() and send() report ECONNECTION', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            client._destroy();
            client.login({ user: 'testuser', pass: 'testpass' }, err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ECONNECTION');
                assert.strictEqual(err.command, 'API');
                assert.strictEqual(err.message, 'Cannot login - smtp connection is already destroyed.');

                client.send({ from: 'a@example.com', to: 'b@example.com' }, 'test', err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'ECONNECTION');
                    assert.strictEqual(err.command, 'API');
                    assert.strictEqual(err.message, 'Cannot send message - smtp connection is already destroyed.');
                    done();
                });
            });
        });

        it('send() rejects an empty message', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            client.send({ from: 'a@example.com', to: 'b@example.com' }, '', err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EMESSAGE');
                assert.strictEqual(err.command, 'API');
                assert.strictEqual(err.message, 'Empty message');
                done();
            });
        });

        it('refuses commands once the socket is half-closed or destroyed', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);
                const results: string[] = [];

                client.on('error', () => {});

                client.connect(() => {
                    const socket = client._socket as net.Socket;

                    socket.end();
                    client.login({ user: 'testuser', pass: 'testpass' }, err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'ECONNECTION');
                        results.push(err.message);
                    });

                    socket.destroy();
                    client.send({ from: 'a@example.com', to: 'b@example.com' }, 'test', err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'ECONNECTION');
                        results.push(err.message);
                    });
                    client.reset(err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'ECONNECTION');
                        results.push(err.message);
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.deepStrictEqual(results, [
                            'Cannot login - smtp connection socket is already half-closed.',
                            'Cannot send message - smtp connection socket is already destroyed.',
                            'Cannot reset - smtp connection socket is already destroyed.'
                        ]);
                    });
                });
            });
        });

        it('closes instead of writing when the socket was destroyed underneath it', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);
                let endEvents = 0;

                client.on('error', () => {});
                client.on('end', () => {
                    endEvents++;
                });

                client.connect(() => {
                    (client._socket as net.Socket).destroy();
                    assert.strictEqual(client.destroyed, false);

                    client.quit();

                    // the dead socket is noticed synchronously, the client is torn down at once
                    assert.strictEqual(client.destroyed, true);
                    assert.strictEqual(endEvents, 1);
                    assert.ok(!server.commands.some(line => /^QUIT/i.test(line)), 'QUIT must not reach the server');

                    setImmediate(() => {
                        finishRawServer(server, done, () => {
                            assert.strictEqual(endEvents, 1);
                        });
                    });
                });
            });
        });

        it('ignores commands and late socket events after close()', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);
                let endEvents = 0;
                let errors = 0;

                client.on('error', () => {
                    errors++;
                });
                client.on('end', () => {
                    endEvents++;
                });

                client.connect(() => {
                    client.close();
                    assert.strictEqual(client.destroyed, true);

                    // none of these may throw or emit anything once the connection is gone
                    client.quit();
                    client._destroy();
                    client._onError(new Error('late socket error'), 'ESOCKET', false, 'CONN');
                    client._onData(Buffer.from('250 late reply\r\n'));
                    client._onData(Buffer.alloc(0));

                    assert.deepStrictEqual(client._responseQueue, []);

                    setImmediate(() => {
                        finishRawServer(server, done, () => {
                            assert.strictEqual(endEvents, 1);
                            assert.strictEqual(errors, 0);
                            assert.ok(!server.commands.some(line => /^QUIT/i.test(line)), 'QUIT must not reach the server');
                        });
                    });
                });
            });
        });
    });

    describe('Greeting and EHLO stage', () => {
        it('rejects a non-220 greeting with EPROTOCOL', (t, done) => {
            startRawServer({ greeting: '554 5.3.2 No SMTP service here\r\n' }, server => {
                expectConnectError(createClient(server), server, done, err => {
                    assert.strictEqual(err.code, 'EPROTOCOL');
                    assert.strictEqual(err.command, 'CONN');
                    assert.strictEqual(err.responseCode, 554);
                    assert.strictEqual(err.response, '554 5.3.2 No SMTP service here');
                    assert.strictEqual(
                        err.message,
                        'Invalid greeting. response=554 5.3.2 No SMTP service here: 554 5.3.2 No SMTP service here'
                    );
                    assert.deepStrictEqual(server.commands, []);
                });
            });
        });

        it('reports an unterminated 4xx line when the server hangs up before the greeting completes', (t, done) => {
            startRawServer(
                {
                    greeting: (line, socket) => {
                        // no CRLF, the line is only complete once the connection closes
                        socket.end('421 4.7.0 Too many connections');
                    }
                },
                server => {
                    expectConnectError(createClient(server, { transactionLog: true }), server, done, err => {
                        assert.strictEqual(err.code, 'ECONNECTION');
                        assert.strictEqual(err.command, 'CONN');
                        assert.strictEqual(err.responseCode, 421);
                        assert.strictEqual(err.response, '421 4.7.0 Too many connections');
                        assert.strictEqual(err.message, 'Connection closed unexpectedly: 421 4.7.0 Too many connections');
                    });
                }
            );
        });

        it('clears its timers when the server drops the connection before the greeting', (t, done) => {
            startRawServer(
                {
                    greeting: (line, socket) => {
                        socket.destroy();
                        return false;
                    }
                },
                server => {
                    // the default greeting timeout is 30 seconds, it must not outlive the connection
                    const client = createClient(server);
                    client.on('error', () => false);
                    client.once('end', () => {
                        finishRawServer(server, done, () => {
                            assert.strictEqual(client._greetingTimeout, false);
                            assert.strictEqual(client._connectionTimeout, false);
                            assert.strictEqual(client.destroyed, true);
                        });
                    });
                    client.connect(() => {
                        assert.fail('the connect callback must not run');
                    });
                }
            );
        });

        it('times out when the greeting never arrives', (t, done) => {
            startRawServer({ greeting: false }, server => {
                expectConnectError(createClient(server, { greetingTimeout: 100 }), server, done, err => {
                    assert.strictEqual(err.code, 'ETIMEDOUT');
                    assert.strictEqual(err.command, 'CONN');
                    assert.strictEqual(err.message, 'Greeting never received');
                });
            });
        });

        it('treats a 421 EHLO reply as the server terminating the connection', (t, done) => {
            startRawServer({ EHLO: '421 4.3.2 Service shutting down\r\n' }, server => {
                expectConnectError(createClient(server), server, done, err => {
                    assert.strictEqual(err.code, 'ECONNECTION');
                    assert.strictEqual(err.command, 'EHLO');
                    assert.strictEqual(err.responseCode, 421);
                    assert.ok(/^Server terminates connection/.test(err.message), err.message);
                    assert.strictEqual(server.commands.length, 1, 'no HELO fallback after 421');
                });
            });
        });

        it('falls back to HELO when EHLO is rejected', (t, done) => {
            startRawServer({ EHLO: '502 5.5.1 Command not implemented\r\n' }, server => {
                const client = createClient(server, { name: 'client.example.com' });

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    assert.strictEqual(client.allowsAuth, true, 'HELO sessions assume AUTH is available');
                    assert.deepStrictEqual(client._supportedExtensions, []);
                    assert.strictEqual(client._ehloLines, undefined);
                    client.quit();
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.deepStrictEqual(server.commands, ['EHLO client.example.com', 'HELO client.example.com', 'QUIT']);
                    });
                });
            });
        });

        it('fails with EPROTOCOL when both EHLO and HELO are rejected', (t, done) => {
            startRawServer({ EHLO: '502 5.5.1 Command not implemented\r\n', HELO: '501 5.5.4 Syntax error\r\n' }, server => {
                expectConnectError(createClient(server), server, done, err => {
                    assert.strictEqual(err.code, 'EPROTOCOL');
                    assert.strictEqual(err.command, 'HELO');
                    assert.strictEqual(err.responseCode, 501);
                    assert.ok(/^Invalid HELO/.test(err.message), err.message);
                });
            });
        });

        it('does not fall back to HELO when requireTLS is set', (t, done) => {
            startRawServer({ EHLO: '502 5.5.1 Command not implemented\r\n' }, server => {
                expectConnectError(createClient(server, { ignoreTLS: false, requireTLS: true }), server, done, err => {
                    assert.strictEqual(err.code, 'ECONNECTION');
                    assert.strictEqual(err.command, 'EHLO');
                    assert.strictEqual(err.responseCode, 502);
                    assert.ok(/HELO does not support required STARTTLS/.test(err.message), err.message);
                    assert.ok(!server.commands.some(line => /^HELO/i.test(line)), 'HELO must not be attempted');
                });
            });
        });

        it('assembles a multi-line EHLO reply that arrives in several chunks', (t, done) => {
            startRawServer(
                {
                    EHLO: (line, socket) => {
                        socket.write('250-test\r\n250-PIPELINING\r\n');
                        setImmediate(() => socket.write('250 SIZE 1000\r\n'));
                    }
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        assert.strictEqual(client.lastServerResponse, '250-test\n250-PIPELINING\n250 SIZE 1000');
                        assert.deepStrictEqual(client._supportedExtensions, ['PIPELINING', 'SIZE']);
                        assert.strictEqual(client._maxAllowedSize, 1000);
                        assert.deepStrictEqual(client._ehloLines, ['PIPELINING', 'SIZE 1000']);
                        client.quit();
                    });

                    client.on('end', () => finishRawServer(server, done));
                }
            );
        });

        it('reports an LHLO rejection with EPROTOCOL', (t, done) => {
            startRawServer({ LHLO: '500 5.5.1 Command unrecognized\r\n' }, server => {
                expectConnectError(createClient(server, { lmtp: true }), server, done, err => {
                    assert.strictEqual(err.code, 'EPROTOCOL');
                    assert.strictEqual(err.command, 'LHLO');
                    assert.strictEqual(err.responseCode, 500);
                    assert.ok(/^Invalid LHLO/.test(err.message), err.message);
                    assert.strictEqual(server.commands.length, 1);
                    assert.ok(/^LHLO /.test(server.commands[0]), 'LMTP sessions open with LHLO');
                });
            });
        });
    });

    describe('TLS upgrade failures', () => {
        // tls.connect() rejects an unknown secureProtocol synchronously, which is the
        // one failure the upgrade code has to catch instead of receiving on the socket
        const brokenTls = { secureProtocol: 'bogus_method' };

        it('reports ETLS when the STARTTLS upgrade cannot be started', (t, done) => {
            startRawServer({ EHLO: '250-test\r\n250 STARTTLS\r\n', STARTTLS: '220 2.0.0 Ready to start TLS\r\n' }, server => {
                expectConnectError(createClient(server, { ignoreTLS: false, tls: brokenTls }), server, done, err => {
                    assert.strictEqual(err.code, 'ETLS');
                    assert.strictEqual(err.command, 'STARTTLS');
                    assert.strictEqual(err.message, 'Error initiating TLS - Unknown method: bogus_method');
                    assert.ok(server.commands.some(line => /^STARTTLS/i.test(line)));
                });
            });
        });

        it('reports ETLS when TLS cannot be started on a provided connection', (t, done) => {
            startRawServer({}, server => {
                const socket = net.connect(server.port, '127.0.0.1', () => {
                    const client = new SMTPConnection({ connection: socket, secure: true, tls: brokenTls, logger: false });
                    expectConnectError(client, server, done, err => {
                        assert.strictEqual(err.code, 'ETLS');
                        assert.strictEqual(err.command, 'CONN');
                        assert.strictEqual(err.message, 'Error initiating TLS - Unknown method: bogus_method');
                        assert.strictEqual(socket.destroyed, true);
                    });
                });
            });
        });

        it('reports ETLS when TLS cannot be started on a provided socket', (t, done) => {
            startRawServer({}, server => {
                const socket = new net.Socket();
                const client = createClient(server, { socket, secure: true, tls: brokenTls });
                expectConnectError(client, server, done, err => {
                    assert.strictEqual(err.code, 'ETLS');
                    assert.strictEqual(err.command, 'CONN');
                    assert.strictEqual(err.message, 'Error initiating TLS - Unknown method: bogus_method');
                    assert.strictEqual(socket.destroyed, true);
                });
            });
        });

        it('restarts the LMTP session with LHLO after STARTTLS', (t, done) => {
            // smtp-server answers EHLO with 500 in LMTP mode, so the connection only
            // succeeds when the client re-opens the secured session with LHLO
            const server = new SMTPServer({
                lmtp: true,
                disabledCommands: ['AUTH'],
                logger: false
            });

            server.listen(0, '127.0.0.1', () => {
                const client = new SMTPConnection({
                    port: server.server.address().port,
                    host: '127.0.0.1',
                    lmtp: true,
                    tls: { rejectUnauthorized: false },
                    logger: false
                });
                let error: Error | undefined;

                client.on('error', err => {
                    error = err;
                });

                client.connect(() => {
                    assert.strictEqual(client.secure, true);
                    assert.strictEqual(client.stage, 'connected');
                    // the capabilities come from the LHLO reply of the secured session
                    assert.ok(client._supportedExtensions.includes('PIPELINING'), client.lastServerResponse || '');
                    client.quit();
                });

                client.on('end', () => {
                    server.close(() => {
                        assert.ok(!error, error && error.message);
                        done();
                    });
                });
            });
        });
    });

    describe('Connection failures', () => {
        it('reports ECONNECTION when the provided socket cannot connect', (t, done) => {
            const socket = new net.Socket();
            const client = new SMTPConnection({ port: 999999999, host: '127.0.0.1', socket, logger: false });
            let connected = false;

            client.once('error', err => {
                assert.strictEqual(err.code, 'ECONNECTION');
                assert.strictEqual(err.command, 'CONN');
                assert.ok(/999999999/.test(err.message), err.message);
            });

            client.on('end', () => {
                assert.strictEqual(connected, false);
                socket.destroy();
                done();
            });

            client.connect(() => {
                connected = true;
            });
        });

        it('reports ETIMEDOUT when the TCP connection is not established in time', (t, done) => {
            // a socket that never connects stands in for a host that drops the SYN
            const pending = new net.Socket();
            t.mock.method(net, 'connect', () => pending);

            const client = new SMTPConnection({ port: 25, host: '127.0.0.1', connectionTimeout: 50, logger: false });
            let error: NodemailerError | undefined;
            let connected = false;

            client.on('error', err => {
                error = err;
            });

            client.on('end', () => {
                assert.strictEqual(connected, false);
                assert.ok(error);
                assert.strictEqual(error.code, 'ETIMEDOUT');
                assert.strictEqual(error.command, 'CONN');
                assert.strictEqual(error.message, 'Connection timeout');
                assert.strictEqual(pending.destroyed, true, 'the pending socket must be torn down');
                done();
            });

            client.connect(() => {
                connected = true;
            });
        });

        it('reports EDNS when the hostname cannot be resolved', (t, done) => {
            const resolverFailure = (hostname: string, callback: (err: Error | null, addresses?: string[]) => void) => {
                callback(Object.assign(new Error('resolver failed'), { code: 'ETIMEOUT' }));
            };
            t.mock.method(dns.Resolver.prototype, 'resolve4', resolverFailure);
            t.mock.method(dns.Resolver.prototype, 'resolve6', resolverFailure);
            t.mock.method(dns, 'lookup', (hostname: string, options: unknown, callback: (err: Error | null) => void) => {
                callback(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }));
            });

            const client = new SMTPConnection({ port: 25, host: 'unresolvable.invalid', logger: false });
            let error: NodemailerError | undefined;
            let connected = false;

            client.on('error', err => {
                error = err;
            });

            client.on('end', () => {
                assert.strictEqual(connected, false);
                assert.ok(error);
                assert.strictEqual(error.code, 'EDNS');
                assert.strictEqual(error.command, 'CONN');
                assert.strictEqual(error.message, 'lookup failed');
                assert.strictEqual(client._socket, false, 'no socket may be opened');
                done();
            });

            client.connect(() => {
                connected = true;
            });
        });

        it('reports ESOCKET when localAddress cannot be bound', (t, done) => {
            startRawServer({}, server => {
                // 192.0.2.0/24 is reserved for documentation and never assigned to an interface
                expectConnectError(createClient(server, { localAddress: '192.0.2.1' }), server, done, err => {
                    assert.strictEqual(err.code, 'ESOCKET');
                    assert.strictEqual(err.command, 'CONN');
                    assert.ok(/EADDRNOTAVAIL/.test(err.message), err.message);
                });
            });
        });

        it('does not start the session when close() runs before a provided connection is picked up', (t, done) => {
            startRawServer({}, server => {
                const socket = net.connect(server.port, '127.0.0.1', () => {
                    const client = new SMTPConnection({ connection: socket, logger: false });
                    let connected = false;
                    let endEvents = 0;

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });
                    client.on('end', () => {
                        endEvents++;
                    });

                    client.connect(() => {
                        connected = true;
                    });
                    client.close();

                    // _onConnect for a provided connection is deferred with setImmediate,
                    // so it has run by the time this nested immediate fires
                    setImmediate(() => {
                        setImmediate(() => {
                            finishRawServer(server, done, () => {
                                assert.strictEqual(connected, false);
                                assert.strictEqual(client.stage, 'init');
                                assert.strictEqual(socket.destroyed, true);
                                assert.strictEqual(endEvents, 1);
                                assert.deepStrictEqual(server.commands, []);
                            });
                        });
                    });
                });
            });
        });
    });

    describe('Envelope validation', () => {
        it('rejects an envelope without recipients', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            client.send({ from: 'a@example.com', to: [] }, 'test', err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EENVELOPE');
                assert.strictEqual(err.command, 'API');
                assert.strictEqual(err.message, 'No recipients defined');
                done();
            });
        });

        it('rejects a sender address with CRLF or angle brackets', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            client.send({ from: 'a@example.com\r\nRCPT TO:<x@example.com>', to: 'b@example.com' }, 'test', err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EENVELOPE');
                assert.strictEqual(err.command, 'API');
                assert.strictEqual(err.message, 'Invalid sender "a@example.com\\r\\nRCPT TO:<x@example.com>"');

                client.send({ from: { address: '<a@example.com>' }, to: 'b@example.com' }, 'test', err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EENVELOPE');
                    assert.strictEqual(err.message, 'Invalid sender "<a@example.com>"');
                    done();
                });
            });
        });

        it('rejects invalid DSN parameters', (t, done) => {
            const client = new SMTPConnection({ logger: false });
            const envelope = { from: 'a@example.com', to: 'b@example.com' };

            client.send(Object.assign({ dsn: { ret: 'SOMETHING' } }, envelope), 'test', err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EENVELOPE');
                assert.strictEqual(err.command, 'API');
                assert.strictEqual(err.message, 'Invalid DSN ret: "SOMETHING"');

                client.send(Object.assign({ dsn: { notify: 'never, success' } }, envelope), 'test', err => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EENVELOPE');
                    assert.strictEqual(err.message, 'Invalid DSN notify: "NEVER,SUCCESS"');

                    client.send(Object.assign({ dsn: { notify: ['success', 'bogus'] } }, envelope), 'test', err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'EENVELOPE');
                        assert.strictEqual(err.message, 'Invalid DSN notify: "SUCCESS,BOGUS"');
                        done();
                    });
                });
            });
        });

        it('sends DSN parameters when the server advertises DSN', (t, done) => {
            startRawServer({ EHLO: '250-test\r\n250 DSN\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.send(
                        {
                            from: 'a@example.com',
                            to: 'b@example.com',
                            dsn: {
                                return: 'body',
                                id: 'env id',
                                notify: ['success', ' failure '],
                                recipient: 'orig@example.com'
                            }
                        },
                        'test',
                        (err, info) => {
                            assert.ok(!err, err?.message);
                            assert.deepStrictEqual(info!.accepted, ['b@example.com']);
                            client.quit();
                        }
                    );
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(
                            server.commands.includes('MAIL FROM:<a@example.com> RET=FULL ENVID=env+20id'),
                            server.commands.join('\n')
                        );
                        assert.ok(
                            server.commands.includes('RCPT TO:<b@example.com> NOTIFY=SUCCESS,FAILURE ORCPT=rfc822;orig@example.com'),
                            server.commands.join('\n')
                        );
                    });
                });
            });
        });

        it('normalizes the DSN aliases', (t, done) => {
            startRawServer({ EHLO: '250-test\r\n250 DSN\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.send(
                        {
                            from: 'a@example.com',
                            to: 'b@example.com',
                            dsn: {
                                ret: 'headers',
                                envid: 'abc',
                                notify: 'never',
                                // an address type prefix is kept as is
                                orcpt: 'utf-8;x@example.com'
                            }
                        },
                        'test',
                        err => {
                            assert.ok(!err, err?.message);
                            client.quit();
                        }
                    );
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(server.commands.includes('MAIL FROM:<a@example.com> RET=HDRS ENVID=abc'), server.commands.join('\n'));
                        assert.ok(
                            server.commands.includes('RCPT TO:<b@example.com> NOTIFY=NEVER ORCPT=utf-8;x@example.com'),
                            server.commands.join('\n')
                        );
                    });
                });
            });
        });

        it('omits DSN parameters when the server does not advertise DSN', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.send(
                        {
                            from: 'a@example.com',
                            to: 'b@example.com',
                            dsn: { ret: 'FULL', envid: 'abc', notify: 'SUCCESS', recipient: 'orig@example.com' }
                        },
                        'test',
                        err => {
                            assert.ok(!err, err?.message);
                            client.quit();
                        }
                    );
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(server.commands.includes('MAIL FROM:<a@example.com>'), server.commands.join('\n'));
                        assert.ok(server.commands.includes('RCPT TO:<b@example.com>'), server.commands.join('\n'));
                    });
                });
            });
        });
    });

    describe('Transaction failures', () => {
        it('reports an internationalized sender rejected by the server', (t, done) => {
            startRawServer(
                {
                    EHLO: '250-test\r\n250 SMTPUTF8\r\n',
                    MAIL: '550 5.6.7 Internationalized sender not allowed\r\n'
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.send({ from: 'tõst@example.com', to: 'b@example.com' }, 'test', (err, info) => {
                            assert.ok(err);
                            assert.ok(!info);
                            assert.strictEqual(err.code, 'EENVELOPE');
                            assert.strictEqual(err.command, 'MAIL FROM');
                            assert.strictEqual(err.responseCode, 550);
                            assert.strictEqual(
                                err.message,
                                'Internationalized mailbox name not allowed: 550 5.6.7 Internationalized sender not allowed'
                            );
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.ok(server.commands.includes('MAIL FROM:<tõst@example.com> SMTPUTF8'), server.commands.join('\n'));
                        });
                    });
                }
            );
        });

        it('reports an internationalized recipient rejected by the server', (t, done) => {
            startRawServer(
                {
                    EHLO: '250-test\r\n250 SMTPUTF8\r\n',
                    RCPT: '553 5.6.7 Internationalized recipient not allowed\r\n'
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.send({ from: 'a@example.com', to: 'tõst@example.com' }, 'test', (err, info) => {
                            assert.ok(err);
                            assert.ok(!info);
                            assert.strictEqual(err.code, 'EENVELOPE');
                            assert.strictEqual(err.command, 'RCPT TO');
                            assert.strictEqual(err.responseCode, 553);
                            assert.deepStrictEqual(err.rejected, ['tõst@example.com']);
                            assert.strictEqual(err.rejectedErrors!.length, 1);
                            assert.strictEqual(err.rejectedErrors![0].recipient, 'tõst@example.com');
                            assert.strictEqual(err.rejectedErrors![0].responseCode, 553);
                            assert.strictEqual(
                                err.rejectedErrors![0].message,
                                'Internationalized mailbox name not allowed: 553 5.6.7 Internationalized recipient not allowed'
                            );
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.ok(server.commands.includes('MAIL FROM:<a@example.com> SMTPUTF8'), server.commands.join('\n'));
                            assert.ok(
                                !server.commands.some(line => /^DATA/i.test(line)),
                                'DATA must not be sent without accepted recipients'
                            );
                        });
                    });
                }
            );
        });

        it('reports a rejected DATA command', (t, done) => {
            startRawServer({ DATA: '554 5.7.1 Message refused\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.send({ from: 'a@example.com', to: 'b@example.com' }, 'test', (err, info) => {
                        assert.ok(err);
                        assert.ok(!info);
                        assert.strictEqual(err.code, 'EENVELOPE');
                        assert.strictEqual(err.command, 'DATA');
                        assert.strictEqual(err.responseCode, 554);
                        assert.strictEqual(err.message, 'Data command failed: 554 5.7.1 Message refused');
                        client.quit();
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.deepStrictEqual(server.messages, [], 'no message body may be sent after a rejected DATA');
                    });
                });
            });
        });

        it('reports a failed RSET', (t, done) => {
            startRawServer({ RSET: '503 5.5.1 Bad sequence of commands\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.reset((err, result) => {
                        assert.ok(err);
                        assert.ok(!result);
                        assert.strictEqual(err.code, 'EPROTOCOL');
                        assert.strictEqual(err.command, 'RSET');
                        assert.strictEqual(err.responseCode, 503);
                        assert.strictEqual(
                            err.message,
                            'Could not reset session state. response=503 5.5.1 Bad sequence of commands: 503 5.5.1 Bad sequence of commands'
                        );
                        client.quit();
                    });
                });

                client.on('end', () => finishRawServer(server, done));
            });
        });

        it('detaches an in-flight message stream when close() is called during DATA', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);
                const message = new PassThrough();
                let sendCallbacks = 0;
                let dataStream: PassThrough | false = false;

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                // the first body line proves DATA was accepted and the message is being streamed
                server.once('body', () => {
                    dataStream = client._currentDataStream;
                    assert.ok(dataStream, 'a data stream must be tracked while the message is in flight');
                    client.close();
                });

                client.connect(() => {
                    client.send({ from: 'a@example.com', to: 'b@example.com' }, message, () => {
                        sendCallbacks++;
                    });
                    // never ended, the message stays in flight until close()
                    message.write('Subject: test\r\n\r\nhello\r\n');
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(dataStream);
                        assert.strictEqual(client._currentDataStream, false);
                        assert.strictEqual(
                            (dataStream as PassThrough).listenerCount('data'),
                            0,
                            'the data stream must be unpiped from the socket'
                        );
                        assert.strictEqual(sendCallbacks, 0);
                        assert.deepStrictEqual(server.messages, [], 'the message was never terminated');
                    });
                });
            });
        });

        it('calls the send callback only once when the message stream errors afterwards', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);
                const message = new PassThrough();
                let sendCallbacks = 0;

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.send({ from: 'a@example.com', to: 'b@example.com' }, message, (err, info) => {
                        sendCallbacks++;
                        assert.ok(!err, err?.message);
                        assert.strictEqual(info!.response, '250 2.0.0 OK queued');

                        // a late error on the source stream must not surface a second result
                        message.emit('error', new Error('late stream error'));
                        assert.strictEqual(sendCallbacks, 1);

                        client.quit();
                    });
                    message.end('Subject: test\r\n\r\nhello\r\n');
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.strictEqual(sendCallbacks, 1);
                        assert.deepStrictEqual(server.messages, ['Subject: test\r\n\r\nhello']);
                    });
                });
            });
        });
    });
});
