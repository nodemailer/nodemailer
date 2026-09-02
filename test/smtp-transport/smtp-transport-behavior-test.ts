process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import SMTPTransport, { type SMTPTransportAuth } from '../../src/smtp-transport/index.js';
import nodemailer from '../../src/nodemailer.js';
import type { XOAuth2Token } from '../../src/xoauth2/index.js';
import { captureLogger, mockMail, oauthServerOptions, settle, startOAuthServer, startRawSmtpServer, startServer } from './smtp-fixtures.js';

const auth = { user: 'testuser', pass: 'testpass' };
const envelope = { from: 'test@valid.sender', to: 'test@valid.recipient' };

describe('SMTP transport behavior', { timeout: 20000 }, () => {
    describe('send()', () => {
        it('fails with the getSocket error', async () => {
            const proxyError = new Error('proxy unreachable');
            const transport = new SMTPTransport({
                host: 'smtp.example.com',
                port: 25,
                logger: false,
                getSocket(options, callback) {
                    setImmediate(() => callback(proxyError));
                }
            });

            const { err } = await settle(transport, mockMail(envelope));
            assert.strictEqual(err, proxyError);
        });

        it('reports Unexpected socket close when the server drops the connection before the greeting', async () => {
            const raw = await startRawSmtpServer(Infinity);
            const transport = new SMTPTransport({ host: '127.0.0.1', port: raw.port, logger: false });

            try {
                // nothing else reports the close, the transport waits a second before giving up
                const { err } = await settle(transport, mockMail(envelope));
                assert.ok(err);
                assert.strictEqual(err.message, 'Unexpected socket close');
                assert.strictEqual(err.code, undefined);
                assert.strictEqual(raw.connections, 1);
            } finally {
                await raw.close();
            }
        });

        it('logs a callback error thrown by the caller', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger });

            try {
                const delivered = new Promise<void>(resolve => {
                    transport.send(mockMail(envelope), (err, info) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(info!.accepted, ['test@valid.recipient']);
                        resolve();
                        throw new Error('boom');
                    });
                });
                await delivered;

                const logged = records.filter(record => record.level === 'error' && record.entry.tnx === 'callback');
                assert.strictEqual(logged.length, 1);
                assert.strictEqual(logged[0].entry.component, 'smtp-transport');
                assert.strictEqual(logged[0].entry.err.message, 'boom');
                assert.deepStrictEqual(logged[0].args, ['<test@valid.sender>', 'boom']);
            } finally {
                await ts.close();
            }
        });

        it('logs the recipient list truncated after two addresses and reports every recipient', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger });
            const to = ['a@valid.recipient', 'b@valid.recipient', 'c@valid.recipient', 'd@valid.recipient', 'e@valid.recipient'];

            try {
                const { err, info } = await settle(transport, mockMail({ from: 'test@valid.sender', to }));
                assert.ifError(err);
                assert.deepStrictEqual(info!.accepted, to);
                assert.deepStrictEqual(info!.rejected, []);
                assert.deepStrictEqual(info!.envelope, { from: 'test@valid.sender', to });
                assert.strictEqual(info!.messageId, '<test@valid.sender>');

                const sendLog = records.find(
                    record => record.level === 'info' && record.entry.tnx === 'send' && record.entry.component === 'smtp-transport'
                );
                assert.ok(sendLog);
                assert.strictEqual(sendLog.entry.messageId, '<test@valid.sender>');
                assert.deepStrictEqual(sendLog.args, ['<test@valid.sender>', 'a@valid.recipient, b@valid.recipient, ...and 3 more']);
            } finally {
                await ts.close();
            }
        });

        it('passes the DSN settings of the message to MAIL FROM and RCPT TO', async () => {
            let envelopeDsn: unknown;
            let rcptDsn: unknown;
            const ts = await startServer({
                hideDSN: false,
                onRcptTo(address: any, session: any, done: any) {
                    rcptDsn = address.dsn;
                    done();
                },
                onData(stream: any, session: any, done: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        envelopeDsn = session.envelope.dsn;
                        done();
                    });
                }
            });
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger: false });

            try {
                const { err } = await settle(
                    transport,
                    mockMail(envelope, { dsn: { ret: 'HDRS', envid: 'dsn-id-1', notify: ['FAILURE', 'DELAY'] } })
                );
                assert.ifError(err);
                assert.deepStrictEqual(envelopeDsn, { ret: 'HDRS', envid: 'dsn-id-1' });
                assert.deepStrictEqual(rcptDsn, { notify: ['FAILURE', 'DELAY'] });
            } finally {
                await ts.close();
            }
        });

        it('sends REQUIRETLS when the message asks for it', async () => {
            let requireTLS: unknown;
            const ts = await startServer({
                secure: true,
                hideREQUIRETLS: false,
                onData(stream: any, session: any, done: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        requireTLS = session.envelope.requireTLS;
                        done();
                    });
                }
            });
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                secure: true,
                tls: { rejectUnauthorized: false },
                auth,
                logger: false
            });

            try {
                const { err } = await settle(transport, mockMail(envelope, { requireTLSExtensionEnabled: true }));
                assert.ifError(err);
                assert.strictEqual(requireTLS, true);
            } finally {
                await ts.close();
            }
        });

        it('builds the envelope from the message addresses and reports the delivery details', async () => {
            const rcptTo: string[][] = [];
            const ts = await startServer({
                onData(stream: any, session: any, done: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        rcptTo.push(session.envelope.rcptTo.map((rcpt: any) => rcpt.address));
                        done();
                    });
                }
            });
            const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, ignoreTLS: true, auth, logger: false });
            const recipients = ['a@valid.recipient', 'b@valid.recipient', 'c@valid.recipient', 'd@valid.recipient'];

            try {
                const info = await transporter.sendMail({
                    from: 'Sender Name <test@valid.sender>',
                    to: 'A <a@valid.recipient>, b@valid.recipient',
                    cc: 'c@valid.recipient',
                    bcc: 'd@valid.recipient',
                    subject: 'envelope',
                    text: 'hello'
                });
                assert.deepStrictEqual(info.envelope, { from: 'test@valid.sender', to: recipients });
                assert.deepStrictEqual(info.accepted, recipients);
                assert.deepStrictEqual(info.rejected, []);
                assert.match(info.messageId, /^<[^>]+@valid\.sender>$/);
                assert.match(info.response as string, /^250 /);
                assert.ok(Array.isArray(info.ehlo) && info.ehlo.includes('PIPELINING'));
                assert.strictEqual(typeof info.envelopeTime, 'number');
                assert.strictEqual(typeof info.messageTime, 'number');
                assert.ok((info.messageSize as number) > 0);
                assert.deepStrictEqual(rcptTo, [recipients]);

                // an explicit envelope replaces the one derived from the headers
                const custom = await transporter.sendMail({
                    from: 'test@valid.sender',
                    to: 'a@valid.recipient',
                    envelope: { from: 'bounces@valid.sender', to: 'x@valid.recipient' },
                    subject: 'envelope',
                    text: 'hello'
                });
                assert.deepStrictEqual(custom.envelope, { from: 'bounces@valid.sender', to: ['x@valid.recipient'] });
                assert.deepStrictEqual(custom.accepted, ['x@valid.recipient']);
                assert.deepStrictEqual(rcptTo[1], ['x@valid.recipient']);
            } finally {
                await ts.close();
            }
        });

        it('reports accepted and rejected recipients of a partially rejected envelope', async () => {
            const ts = await startServer();
            const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, ignoreTLS: true, auth, logger: false });

            try {
                const info = await transporter.sendMail({
                    from: 'test@valid.sender',
                    to: ['a@valid.recipient', 'nobody@invalid.recipient'],
                    subject: 'partial',
                    text: 'hello'
                });
                assert.deepStrictEqual(info.accepted, ['a@valid.recipient']);
                assert.deepStrictEqual(info.rejected, ['nobody@invalid.recipient']);
                assert.strictEqual(info.rejectedErrors!.length, 1);
                assert.strictEqual(info.rejectedErrors![0].code, 'EENVELOPE');
                assert.strictEqual(info.rejectedErrors![0].recipient, 'nobody@invalid.recipient');
                assert.strictEqual(info.rejectedErrors![0].command, 'RCPT TO');
                assert.strictEqual(info.rejectedErrors![0].responseCode, 550);

                // nothing is sent when every recipient is rejected
                await assert.rejects(
                    transporter.sendMail({ from: 'test@valid.sender', to: 'nobody@invalid.recipient', subject: 'partial', text: 'hello' }),
                    { code: 'EENVELOPE', command: 'RCPT TO', rejected: ['nobody@invalid.recipient'] }
                );
            } finally {
                await ts.close();
            }
        });
    });

    describe('authentication', () => {
        it('ignores OAuth2 settings without a user or service', async () => {
            const ts = await startServer();
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                auth: { type: 'OAuth2', clientId: 'client-id' },
                forceAuth: true,
                logger: false
            });

            try {
                assert.strictEqual(transport.auth, false);
                await assert.rejects(transport.verify(), { code: 'ENOAUTH' });
            } finally {
                await ts.close();
            }
        });

        it('runs the custom authentication handler of the configured method', async () => {
            const serverAuth: Array<{ method: string; username: string }> = [];
            const ts = await startServer({
                onAuth(auth: any, session: any, done: any) {
                    serverAuth.push({ method: auth.method, username: auth.username });
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return done(new Error('Invalid username or password'));
                    }
                    done(null, { user: 123 });
                }
            });
            const seen: Array<{ method: string; authMethods: string[]; user?: string }> = [];
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                logger: false,
                auth: { user: 'testuser', pass: 'testpass', method: 'x-custom' },
                customAuth: {
                    'X-CUSTOM': ctx => {
                        seen.push({ method: ctx.method, authMethods: ctx.authMethods, user: ctx.auth.user });
                        const credentials = ctx.auth.credentials!;
                        const token = Buffer.from('\u0000' + credentials.user + '\u0000' + credentials.pass).toString('base64');
                        ctx.sendCommand('AUTH PLAIN ' + token, (err, response) => {
                            if (err) {
                                return ctx.reject(err);
                            }
                            if (response.status !== 235) {
                                return ctx.reject(new Error('Unexpected status ' + response.status));
                            }
                            ctx.resolve();
                        });
                    }
                }
            });
            const rejecting = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                logger: false,
                auth: { user: 'testuser', pass: 'testpass', method: 'X-CUSTOM' },
                customAuth: {
                    'x-custom': ctx => ctx.reject('handler says no')
                }
            });

            try {
                const { err, info } = await settle(transport, mockMail(envelope));
                assert.ifError(err);
                assert.deepStrictEqual(info!.accepted, ['test@valid.recipient']);
                assert.deepStrictEqual(seen, [{ method: 'X-CUSTOM', authMethods: ['PLAIN', 'LOGIN'], user: 'testuser' }]);
                assert.deepStrictEqual(serverAuth, [{ method: 'PLAIN', username: 'testuser' }]);

                const failed = await settle(rejecting, mockMail(envelope));
                assert.ok(failed.err);
                assert.strictEqual(failed.err.code, 'EAUTH');
                assert.strictEqual(failed.err.message, 'handler says no');
                assert.strictEqual(failed.err.command, 'AUTH X-CUSTOM');
                assert.strictEqual(serverAuth.length, 1);
            } finally {
                await ts.close();
            }
        });

        it('uses the authMethod option as the SASL method unless the auth settings name one', async () => {
            const methods: string[] = [];
            const ts = await startServer({
                onAuth(auth: any, session: any, done: any) {
                    methods.push(auth.method);
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return done(new Error('Invalid username or password'));
                    }
                    done(null, { user: 123 });
                }
            });
            const fromOption = new SMTPTransport({ host: '127.0.0.1', port: ts.port, authMethod: 'LOGIN', auth, logger: false });
            const fromAuth = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                authMethod: 'LOGIN',
                auth: Object.assign({ method: 'plain' }, auth),
                logger: false
            });

            try {
                const first = await settle(fromOption, mockMail(envelope));
                assert.ifError(first.err);
                const second = await settle(fromAuth, mockMail(envelope));
                assert.ifError(second.err);
                assert.deepStrictEqual(methods, ['LOGIN', 'PLAIN']);
            } finally {
                await ts.close();
            }
        });

        it('generates an access token through the OAuth2 endpoint and emits token on the transporter', async () => {
            const oauth = await startOAuthServer();
            const attempts: string[] = [];
            const ts = await startServer(oauthServerOptions(oauth.x2server, attempts));
            const transporter = nodemailer.createTransport({
                host: '127.0.0.1',
                port: ts.port,
                ignoreTLS: true,
                logger: false,
                auth: {
                    type: 'OAuth2',
                    user: 'testuser',
                    clientId: 'client-id',
                    clientSecret: 'client-secret',
                    refreshToken: 'refresh-token',
                    accessUrl: oauth.accessUrl
                }
            });
            const tokens: XOAuth2Token[] = [];
            transporter.on('token', (token: XOAuth2Token) => tokens.push(token));
            const message = { from: 'test@valid.sender', to: 'test@valid.recipient', subject: 'oauth2', text: 'hello' };

            try {
                const info = await transporter.sendMail(message);
                assert.deepStrictEqual(info.accepted, ['test@valid.recipient']);
                assert.strictEqual(oauth.issued.length, 1);
                assert.deepStrictEqual(attempts, [oauth.issued[0]]);
                assert.strictEqual(tokens.length, 1);
                assert.strictEqual(tokens[0].user, 'testuser');
                assert.strictEqual(tokens[0].accessToken, oauth.issued[0]);
                assert.ok(tokens[0].expires > Date.now());

                // the next message opens a new connection and logs in with the cached token
                await transporter.sendMail(message);
                assert.deepStrictEqual(attempts, [oauth.issued[0], oauth.issued[0]]);
                assert.strictEqual(oauth.issued.length, 1);
                assert.strictEqual(tokens.length, 1);
            } finally {
                transporter.close();
                await ts.close();
                await oauth.stop();
            }
        });

        it('renews the access token when the server rejects the cached one', async () => {
            const oauth = await startOAuthServer();
            const attempts: string[] = [];
            const ts = await startServer(oauthServerOptions(oauth.x2server, attempts));
            const transporter = nodemailer.createTransport({
                host: '127.0.0.1',
                port: ts.port,
                ignoreTLS: true,
                logger: false,
                auth: {
                    type: 'OAuth2',
                    user: 'testuser',
                    clientId: 'client-id',
                    clientSecret: 'client-secret',
                    refreshToken: 'refresh-token',
                    accessToken: 'stale-token',
                    accessUrl: oauth.accessUrl
                }
            });
            const tokens: XOAuth2Token[] = [];
            transporter.on('token', (token: XOAuth2Token) => tokens.push(token));

            try {
                const info = await transporter.sendMail({
                    from: 'test@valid.sender',
                    to: 'test@valid.recipient',
                    subject: 'oauth2',
                    text: 'hello'
                });
                assert.deepStrictEqual(info.accepted, ['test@valid.recipient']);
                assert.strictEqual(oauth.issued.length, 1);
                assert.deepStrictEqual(attempts, ['stale-token', oauth.issued[0]]);
                assert.strictEqual(tokens.length, 1);
                assert.strictEqual(tokens[0].accessToken, oauth.issued[0]);
            } finally {
                transporter.close();
                await ts.close();
                await oauth.stop();
            }
        });

        it('close() detaches the OAuth2 listeners and emits close', () => {
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: 1,
                logger: false,
                auth: { type: 'OAuth2', user: 'testuser', accessToken: 'token' }
            });
            const oauth2 = (transport.auth as SMTPTransportAuth).oauth2!;
            assert.strictEqual(oauth2.listenerCount('token'), 1);
            assert.strictEqual(oauth2.listenerCount('error'), 1);

            let closed = 0;
            transport.on('close', () => closed++);
            transport.close();

            assert.strictEqual(closed, 1);
            assert.strictEqual(oauth2.listenerCount('token'), 0);
            assert.strictEqual(oauth2.listenerCount('error'), 0);
        });
    });

    describe('logging', () => {
        it('logs the SMTP transaction through the configured logger when transactionLog is set', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger, transactionLog: true });

            try {
                const { err } = await settle(transport, mockMail(envelope));
                assert.ifError(err);

                const serverLines = records
                    .filter(record => record.level === 'debug' && record.entry.tnx === 'server')
                    .map(record => record.message);
                const clientLines = records
                    .filter(record => record.level === 'debug' && record.entry.tnx === 'client')
                    .map(record => record.message);

                assert.ok(
                    serverLines.some(line => /^220 /.test(line)),
                    'greeting is logged'
                );
                assert.ok(
                    serverLines.some(line => /^250 OK: message queued/.test(line)),
                    'final response is logged'
                );
                assert.ok(
                    clientLines.some(line => /^EHLO /.test(line)),
                    'EHLO is logged'
                );
                assert.ok(
                    clientLines.some(line => line === 'MAIL FROM:<test@valid.sender>'),
                    'MAIL FROM is logged'
                );
                assert.ok(
                    clientLines.some(line => line === 'RCPT TO:<test@valid.recipient>'),
                    'RCPT TO is logged'
                );

                // the credentials never reach the log
                const secret = Buffer.from('\u0000testuser\u0000testpass').toString('base64');
                assert.ok(clientLines.some(line => /^AUTH PLAIN /.test(line)));
                assert.ok(!clientLines.some(line => line.includes(secret)));

                // the transport logs under its own component, the connection under its own
                assert.ok(records.some(record => record.entry.tnx === 'send' && record.entry.component === 'smtp-transport'));
                assert.ok(records.some(record => record.entry.tnx === 'client' && record.entry.component === 'smtp-connection'));
            } finally {
                await ts.close();
            }
        });

        it('uses the component option for the transport and connection log entries', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger, component: 'custom-mailer' });

            try {
                const { err } = await settle(transport, mockMail(envelope));
                assert.ifError(err);
                const components = new Set(records.map(record => record.entry.component));
                assert.deepStrictEqual([...components], ['custom-mailer']);
                assert.ok(records.some(record => record.entry.tnx === 'send'));
                assert.ok(records.some(record => record.entry.tnx === 'network'));
            } finally {
                await ts.close();
            }
        });
    });

    describe('verify()', () => {
        it('resolves with true when called without a callback', async () => {
            const ts = await startServer();
            const transport = new SMTPTransport({ host: '127.0.0.1', port: ts.port, auth, logger: false });

            try {
                assert.strictEqual(await transport.verify(), true);
            } finally {
                await ts.close();
            }
        });

        it('rejects with EAUTH for wrong credentials', async () => {
            const ts = await startServer();
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                auth: { user: 'testuser', pass: 'wrong' },
                logger: false
            });

            try {
                await assert.rejects(transport.verify(), { code: 'EAUTH', responseCode: 535 });
            } finally {
                await ts.close();
            }
        });

        it('fails with the getSocket error', async () => {
            const proxyError = new Error('proxy unreachable');
            const transport = new SMTPTransport({
                host: 'smtp.example.com',
                port: 25,
                logger: false,
                getSocket(options, callback) {
                    setImmediate(() => callback(proxyError));
                }
            });

            await assert.rejects(transport.verify(), err => err === proxyError);
        });

        it('verifies through a proxied socket', async () => {
            const ts = await startServer();
            const seenHosts: Array<string | undefined> = [];
            const transport = new SMTPTransport({
                url: 'smtp://testuser:testpass@www.example.com:1234',
                logger: false,
                getSocket(options, callback) {
                    seenHosts.push(options.host);
                    const socket = net.connect(ts.port, '127.0.0.1');
                    socket.once('error', err => callback(err));
                    socket.once('connect', () => callback(null, { connection: socket }));
                }
            });

            try {
                assert.strictEqual(await transport.verify(), true);
                assert.deepStrictEqual(seenHosts, ['www.example.com']);
            } finally {
                await ts.close();
            }
        });

        it('fails with Connection closed when the server drops the connection before the greeting', async () => {
            const raw = await startRawSmtpServer(Infinity);
            const transport = new SMTPTransport({ host: '127.0.0.1', port: raw.port, logger: false });

            try {
                await assert.rejects(transport.verify(), { message: 'Connection closed' });
                assert.strictEqual(raw.connections, 1);
            } finally {
                await raw.close();
            }
        });

        it('cleans up the per-call OAuth2 listeners and keeps the transport level ones', async () => {
            const ts = await startServer({
                authMethods: ['XOAUTH2'],
                onAuth(auth: any, session: any, done: any) {
                    if (auth.method === 'XOAUTH2' && auth.username === 'testuser' && auth.accessToken === 'valid-token') {
                        return done(null, { user: 123 });
                    }
                    done(null, { data: { status: '401', schemes: 'bearer mac', scope: 'https://mail.google.com/' } });
                }
            });
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port: ts.port,
                logger: false,
                auth: { type: 'OAuth2', user: 'testuser', accessToken: 'valid-token' }
            });

            // capture the auth object verify() builds for the call
            let perCall: SMTPTransportAuth | undefined;
            const originalGetAuth = transport.getAuth.bind(transport);
            transport.getAuth = authOpts => {
                const result = originalGetAuth(authOpts);
                if (result && result.oauth2) {
                    perCall = result;
                }
                return result;
            };

            try {
                assert.strictEqual(await transport.verify(), true);
                assert.ok(perCall);
                assert.notStrictEqual(perCall, transport.auth);
                assert.strictEqual(perCall.oauth2!.listenerCount('token'), 0);
                assert.strictEqual(perCall.oauth2!.listenerCount('error'), 0);
                assert.strictEqual((transport.auth as SMTPTransportAuth).oauth2!.listenerCount('token'), 1);
            } finally {
                transport.close();
                await ts.close();
            }
        });
    });
});
