process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import SMTPPool from '../../src/smtp-pool/index.js';
import nodemailer from '../../src/nodemailer.js';
import type { XOAuth2Token } from '../../src/xoauth2/index.js';
import {
    captureLogger,
    freePort,
    mockMail,
    oauthServerOptions,
    settle,
    startOAuthServer,
    startRawSmtpServer,
    startServer
} from '../smtp-transport/smtp-fixtures.js';

const auth = { user: 'testuser', pass: 'testpass' };
const envelope = { from: 'test@valid.sender', to: 'test@valid.recipient' };

describe('SMTP pool lifecycle', { timeout: 20000 }, () => {
    describe('queue handling', () => {
        it('send() refuses new messages once the pool is closed', () => {
            const pool = new SMTPPool({ host: '127.0.0.1', port: 1, logger: false });
            pool.close();

            const queued = pool.send(mockMail(envelope), () => {
                assert.fail('a message sent after close() must not be processed');
            });

            assert.strictEqual(queued, false);
            assert.strictEqual(pool._queue.length, 0);
        });

        it('emits idle once a saturated queue has drained', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, maxConnections: 1, auth, logger: false });
            const idleAt: number[] = [];
            let delivered = 0;
            pool.on('idle', () => idleAt.push(delivered));

            try {
                const first = settle(pool, mockMail(envelope)).then(outcome => {
                    delivered++;
                    return outcome;
                });
                const second = settle(pool, mockMail(envelope)).then(outcome => {
                    delivered++;
                    return outcome;
                });

                // two messages for a single slot, the pool is busy right away
                assert.strictEqual(pool.isIdle(), false);

                const outcomes = await Promise.all([first, second]);
                outcomes.forEach(outcome => assert.ifError(outcome.err));

                await once(pool, 'idle');
                assert.deepStrictEqual(idleAt, [2]);
                assert.strictEqual(pool.isIdle(), true);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('never opens more than maxConnections connections', async () => {
            let active = 0;
            let peak = 0;
            let accepted = 0;
            const held: Array<() => void> = [];
            const ts = await startServer({
                onConnect(session: any, done: any) {
                    active++;
                    accepted++;
                    peak = Math.max(peak, active);
                    done();
                },
                onClose() {
                    active--;
                },
                onData(stream: any, session: any, done: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        // hold both slots busy before letting either message through
                        held.push(done);
                        if (held.length === 2) {
                            held.splice(0).forEach(release => release());
                        }
                    });
                }
            });
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, maxConnections: 2, auth, logger: false });

            try {
                const outcomes = await Promise.all([1, 2, 3, 4].map(() => settle(pool, mockMail(envelope))));
                outcomes.forEach(outcome => assert.ifError(outcome.err));
                assert.strictEqual(peak, 2);
                assert.strictEqual(accepted, 2);
                assert.strictEqual(pool._connections.length, 2);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('retires a connection after maxMessages messages and opens a new one', async () => {
            const perSession = new Map<string, number>();
            const ts = await startServer({
                onData(stream: any, session: any, done: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        perSession.set(session.id, (perSession.get(session.id) || 0) + 1);
                        done();
                    });
                }
            });
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, maxConnections: 1, maxMessages: 2, auth, logger: false });

            try {
                const outcomes = await Promise.all([1, 2, 3, 4, 5].map(() => settle(pool, mockMail(envelope))));
                outcomes.forEach(outcome => assert.ifError(outcome.err));
                assert.deepStrictEqual([...perSession.values()].sort(), [1, 2, 2]);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('emits clear once the last connection is retired with an empty queue', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, maxMessages: 1, auth, logger: false });
            const cleared = once(pool, 'clear');

            try {
                const { err } = await settle(pool, mockMail(envelope));
                assert.ifError(err);
                await cleared;
                assert.strictEqual(pool._connections.length, 0);
                assert.strictEqual(pool.isIdle(), true);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('holds messages beyond rateLimit until the rateDelta window passes', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({
                host: '127.0.0.1',
                port: ts.port,
                maxConnections: 1,
                rateLimit: 2,
                rateDelta: 300,
                auth,
                logger: false
            });
            const started = Date.now();

            try {
                const finished = await Promise.all(
                    [1, 2, 3, 4].map(() =>
                        settle(pool, mockMail(envelope)).then(outcome => {
                            assert.ifError(outcome.err);
                            return Date.now() - started;
                        })
                    )
                );
                assert.ok(finished[0] < 200 && finished[1] < 200, 'the first two messages go out at once: ' + finished.join(', '));
                assert.ok(finished[2] >= 290 && finished[3] >= 290, 'later messages wait for the window: ' + finished.join(', '));
            } finally {
                pool.close();
                await ts.close();
            }
        });
    });

    describe('connection failures', () => {
        it('fails queued messages with EAUTH when the pooled connection cannot log in', async () => {
            let authAttempts = 0;
            const ts = await startServer({
                onAuth(auth: any, session: any, done: any) {
                    authAttempts++;
                    done(new Error('Invalid username or password'));
                }
            });
            const pool = new SMTPPool({
                host: '127.0.0.1',
                port: ts.port,
                maxConnections: 1,
                auth: { user: 'testuser', pass: 'wrong' },
                logger: false
            });

            try {
                const outcomes = await Promise.all([settle(pool, mockMail(envelope)), settle(pool, mockMail(envelope))]);
                for (const { err } of outcomes) {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EAUTH');
                    assert.strictEqual(err.responseCode, 535);
                    assert.strictEqual(err.command, 'AUTH PLAIN');
                }
                // each message got a fresh connection and its own login attempt
                assert.strictEqual(authAttempts, 2);
                assert.strictEqual(pool._connections.length, 0);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('fails the message with ESOCKET when the connection is refused', async () => {
            const port = await freePort();
            const pool = new SMTPPool({ host: '127.0.0.1', port, logger: false });

            try {
                const { err } = await settle(pool, mockMail(envelope));
                assert.ok(err);
                assert.strictEqual(err.code, 'ESOCKET');
                assert.strictEqual(err.command, 'CONN');
                assert.strictEqual(pool._connections.length, 0);
            } finally {
                pool.close();
            }
        });

        it('fails the message with the getSocket error', async () => {
            const proxyError = new Error('proxy unreachable');
            const pool = new SMTPPool({
                host: 'smtp.example.com',
                port: 25,
                logger: false,
                getSocket(options, callback) {
                    setImmediate(() => callback(proxyError));
                }
            });

            try {
                const { err } = await settle(pool, mockMail(envelope));
                assert.strictEqual(err, proxyError);
            } finally {
                pool.close();
            }
        });

        it('frees the pool slot after a getSocket error', async () => {
            const ts = await startServer();
            let calls = 0;
            const pool = new SMTPPool({
                host: '127.0.0.1',
                port: ts.port,
                maxConnections: 1,
                auth,
                logger: false,
                getSocket(options, callback) {
                    if (++calls === 1) {
                        return setImmediate(() => callback(new Error('proxy unreachable')));
                    }
                    setImmediate(() => callback(null, false));
                }
            });

            try {
                const first = await settle(pool, mockMail(envelope));
                assert.strictEqual(first.err && first.err.message, 'proxy unreachable');

                const second = await Promise.race([
                    settle(pool, mockMail(envelope)),
                    new Promise<never>((resolve, reject) => setTimeout(() => reject(new Error('second message was never sent')), 700))
                ]);
                assert.ifError(second.err);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('requeues a message when its connection closes before the greeting', async () => {
            const raw = await startRawSmtpServer(2);
            const pool = new SMTPPool({ host: '127.0.0.1', port: raw.port, maxConnections: 1, logger: false });

            try {
                const { err, info } = await settle(pool, mockMail(envelope));
                assert.ifError(err);
                assert.deepStrictEqual(info!.accepted, ['test@valid.recipient']);
                // two dropped attempts and the one that went through
                assert.strictEqual(raw.connections, 3);
            } finally {
                pool.close();
                await raw.close();
            }
        });

        for (const [maxRequeues, attempts] of [
            [0, 1],
            [2, 3]
        ]) {
            it('fails the message after ' + maxRequeues + ' requeue attempts with maxRequeues=' + maxRequeues, async () => {
                const raw = await startRawSmtpServer(Infinity);
                const pool = new SMTPPool({ host: '127.0.0.1', port: raw.port, maxConnections: 1, maxRequeues, logger: false });

                try {
                    const { err } = await settle(pool, mockMail(envelope));
                    assert.ok(err);
                    assert.strictEqual(err.message, 'Reached maximum number of retries after connection was closed');
                    assert.strictEqual(raw.connections, attempts);
                    assert.strictEqual(pool._queue.length, 0);
                } finally {
                    pool.close();
                    await raw.close();
                }
            });
        }

        it('keeps delivering when a send callback throws and logs the callback error', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, maxConnections: 1, auth, logger });

            try {
                let firstCalled = false;
                pool.send(mockMail(envelope), () => {
                    firstCalled = true;
                    throw new Error('boom');
                });
                const { err, info } = await settle(pool, mockMail(envelope));

                assert.ok(firstCalled);
                assert.ifError(err);
                assert.deepStrictEqual(info!.accepted, ['test@valid.recipient']);

                const logged = records.filter(record => record.level === 'error' && record.entry.tnx === 'callback');
                assert.strictEqual(logged.length, 1);
                assert.strictEqual(logged[0].entry.component, 'smtp-pool');
                assert.strictEqual(logged[0].entry.cid, 1);
                assert.strictEqual(logged[0].entry.err.message, 'boom');
                assert.deepStrictEqual(logged[0].args, [1, 'boom']);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('logs a callback error thrown while reporting a connection error', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth: { user: 'testuser', pass: 'wrong' }, logger });

            try {
                const failed = new Promise<Error | null>(resolve => {
                    pool.send(mockMail(envelope), err => {
                        resolve(err);
                        throw new Error('boom');
                    });
                });
                const err = await failed;
                assert.ok(err);
                assert.strictEqual((err as { code?: string }).code, 'EAUTH');

                const poolError = records.find(record => record.level === 'warn' && record.entry.tnx === 'pool');
                assert.ok(poolError, 'the connection error is logged as a pool warning');
                assert.strictEqual(poolError.entry.err.code, 'EAUTH');

                const logged = records.filter(record => record.level === 'error' && record.entry.tnx === 'callback');
                assert.strictEqual(logged.length, 1);
                assert.strictEqual(logged[0].entry.err.message, 'boom');
                assert.strictEqual(pool._connections.length, 0);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('close() keeps failing the queued messages when one of the callbacks throws', async () => {
            const pool = new SMTPPool({ host: '127.0.0.1', port: 1, logger: false });
            const first = new Promise<Error | null>(resolve => {
                pool.send(mockMail(envelope), err => {
                    resolve(err);
                    throw new Error('boom');
                });
            });
            const second = settle(pool, mockMail(envelope));
            pool.close();

            const firstErr = await first;
            assert.strictEqual(firstErr && firstErr.message, 'Connection pool was closed');
            const secondErr = (await second).err;
            assert.strictEqual(secondErr && secondErr.message, 'Connection pool was closed');
        });
    });

    describe('authentication and envelope options', () => {
        it('treats an auth object without user and pass as no authentication', async () => {
            let sessionUser: unknown = 'not checked';
            const ts = await startServer({
                authOptional: true,
                onMailFrom(address: any, session: any, done: any) {
                    sessionUser = session.user;
                    done();
                }
            });

            const forced = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth: {}, forceAuth: true, logger: false });
            const relaxed = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth: { type: 'login' }, logger: false });

            try {
                await assert.rejects(forced.verify(), { code: 'ENOAUTH' });

                const { err } = await settle(relaxed, mockMail(envelope));
                assert.ifError(err);
                assert.strictEqual(sessionUser, undefined);
            } finally {
                forced.close();
                relaxed.close();
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
            const fromOption = new SMTPPool({ host: '127.0.0.1', port: ts.port, authMethod: 'LOGIN', auth, logger: false });
            const fromAuth = new SMTPPool({
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
                fromOption.close();
                fromAuth.close();
                await ts.close();
            }
        });

        it('logs the recipient list truncated after two addresses and reports every recipient', async () => {
            const { logger, records } = captureLogger();
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth, logger });
            const to = ['a@valid.recipient', 'b@valid.recipient', 'c@valid.recipient', 'd@valid.recipient', 'e@valid.recipient'];

            try {
                const { err, info } = await settle(pool, mockMail({ from: 'test@valid.sender', to }));
                assert.ifError(err);
                assert.deepStrictEqual(info!.accepted, to);
                assert.deepStrictEqual(info!.rejected, []);
                assert.deepStrictEqual(info!.envelope, { from: 'test@valid.sender', to });
                assert.strictEqual(info!.messageId, '<test@valid.sender>');

                const sendLog = records.find(
                    record => record.level === 'info' && record.entry.tnx === 'send' && record.entry.component === 'smtp-pool'
                );
                assert.ok(sendLog);
                assert.strictEqual(sendLog.entry.messageId, '<test@valid.sender>');
                assert.strictEqual(sendLog.entry.cid, 1);
                assert.deepStrictEqual(sendLog.args, ['<test@valid.sender>', 1, 'a@valid.recipient, b@valid.recipient, ...and 3 more']);
            } finally {
                pool.close();
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
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth, logger: false });

            try {
                const { err } = await settle(
                    pool,
                    mockMail(envelope, { dsn: { ret: 'HDRS', envid: 'dsn-id-1', notify: ['FAILURE', 'DELAY'] } })
                );
                assert.ifError(err);
                assert.deepStrictEqual(envelopeDsn, { ret: 'HDRS', envid: 'dsn-id-1' });
                assert.deepStrictEqual(rcptDsn, { notify: ['FAILURE', 'DELAY'] });
            } finally {
                pool.close();
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
            const pool = new SMTPPool({
                host: '127.0.0.1',
                port: ts.port,
                secure: true,
                tls: { rejectUnauthorized: false },
                auth,
                logger: false
            });

            try {
                const { err } = await settle(pool, mockMail(envelope, { requireTLSExtensionEnabled: true }));
                assert.ifError(err);
                assert.strictEqual(requireTLS, true);
            } finally {
                pool.close();
                await ts.close();
            }
        });
    });

    describe('OAuth2', () => {
        it('generates an access token for the pooled connection and emits token on the transporter', async () => {
            const oauth = await startOAuthServer();
            const attempts: string[] = [];
            const ts = await startServer(oauthServerOptions(oauth.x2server, attempts));
            const transporter = nodemailer.createTransport({
                pool: true,
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
                assert.deepStrictEqual(info.envelope, { from: 'test@valid.sender', to: ['test@valid.recipient'] });
                assert.strictEqual(oauth.issued.length, 1);
                assert.deepStrictEqual(attempts, [oauth.issued[0]]);
                assert.strictEqual(tokens.length, 1);
                assert.strictEqual(tokens[0].user, 'testuser');
                assert.strictEqual(tokens[0].accessToken, oauth.issued[0]);
                assert.ok(tokens[0].expires > Date.now());

                // the same connection carries the next message, no new login and no new token
                await transporter.sendMail(message);
                assert.strictEqual(attempts.length, 1);
                assert.strictEqual(oauth.issued.length, 1);

                const pool = transporter.transporter as unknown as SMTPPool;
                const resource = pool._connections[0];
                const oauth2 = resource.auth!.oauth2!;
                assert.ok(oauth2.listenerCount('token') > 0);

                // closing the pool detaches the token listeners of the pooled connection
                const closed = once(resource, 'close');
                transporter.close();
                await closed;
                assert.strictEqual(oauth2.listenerCount('token'), 0);
                assert.strictEqual(oauth2.listenerCount('error'), 0);
                assert.strictEqual(pool._connections.length, 0);
            } finally {
                transporter.close();
                await ts.close();
                await oauth.stop();
            }
        });

        it('uses the oauth2_provision_cb registered on the transporter', async () => {
            const attempts: string[] = [];
            const ts = await startServer({
                authMethods: ['XOAUTH2'],
                onAuth(auth: any, session: any, done: any) {
                    attempts.push(auth.accessToken);
                    if (auth.accessToken === 'provisioned-token') {
                        return done(null, { user: 123 });
                    }
                    done(null, { data: { status: '401', schemes: 'bearer mac', scope: 'https://mail.google.com/' } });
                }
            });
            const transporter = nodemailer.createTransport({
                pool: true,
                host: '127.0.0.1',
                port: ts.port,
                ignoreTLS: true,
                logger: false,
                auth: { type: 'OAuth2', user: 'testuser' }
            });
            const provisionCalls: Array<{ user: string; renew: boolean }> = [];
            transporter.set('oauth2_provision_cb', (user, renew, callback) => {
                provisionCalls.push({ user, renew });
                callback(null, 'provisioned-token');
            });

            try {
                const info = await transporter.sendMail({
                    from: 'test@valid.sender',
                    to: 'test@valid.recipient',
                    subject: 'oauth2',
                    text: 'hello'
                });
                assert.deepStrictEqual(info.accepted, ['test@valid.recipient']);
                assert.deepStrictEqual(provisionCalls, [{ user: 'testuser', renew: false }]);
                assert.deepStrictEqual(attempts, ['provisioned-token']);
            } finally {
                transporter.close();
                await ts.close();
            }
        });

        it('fails with EAUTH when the server rejects a token that cannot be renewed', async () => {
            const attempts: string[] = [];
            const ts = await startServer({
                authMethods: ['XOAUTH2'],
                onAuth(auth: any, session: any, done: any) {
                    attempts.push(auth.accessToken);
                    done(null, { data: { status: '401', schemes: 'bearer mac', scope: 'https://mail.google.com/' } });
                }
            });
            const transporter = nodemailer.createTransport({
                pool: true,
                host: '127.0.0.1',
                port: ts.port,
                ignoreTLS: true,
                logger: false,
                auth: { type: 'OAuth2', user: 'testuser', accessToken: 'stale-token' }
            });

            try {
                await assert.rejects(
                    transporter.sendMail({ from: 'test@valid.sender', to: 'test@valid.recipient', subject: 'oauth2', text: 'hello' }),
                    { code: 'EAUTH', command: 'AUTH XOAUTH2' }
                );
                // the retry reuses the same token because there is nothing to renew it with
                assert.deepStrictEqual(attempts, ['stale-token', 'stale-token']);
                assert.strictEqual((transporter.transporter as unknown as SMTPPool)._connections.length, 0);
            } finally {
                transporter.close();
                await ts.close();
            }
        });
    });

    describe('verify()', () => {
        it('resolves with true when called without a callback', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth, logger: false });

            try {
                assert.strictEqual(await pool.verify(), true);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('rejects with EAUTH for wrong credentials', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth: { user: 'testuser', pass: 'wrong' }, logger: false });

            try {
                await assert.rejects(pool.verify(), { code: 'EAUTH', responseCode: 535 });
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('fails with the getSocket error', async () => {
            const proxyError = new Error('proxy unreachable');
            const pool = new SMTPPool({
                host: 'smtp.example.com',
                port: 25,
                logger: false,
                getSocket(options, callback) {
                    setImmediate(() => callback(proxyError));
                }
            });

            try {
                await assert.rejects(pool.verify(), err => err === proxyError);
            } finally {
                pool.close();
            }
        });

        it('verifies through a proxied socket', async () => {
            const ts = await startServer();
            const seenHosts: Array<string | undefined> = [];
            const pool = new SMTPPool({
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
                assert.strictEqual(await pool.verify(), true);
                assert.deepStrictEqual(seenHosts, ['www.example.com']);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('fails with Connection closed when the server drops the connection before the greeting', async () => {
            const raw = await startRawSmtpServer(Infinity);
            const pool = new SMTPPool({ host: '127.0.0.1', port: raw.port, logger: false });

            try {
                await assert.rejects(pool.verify(), { message: 'Connection closed' });
                assert.strictEqual(raw.connections, 1);
            } finally {
                pool.close();
                await raw.close();
            }
        });

        it('fails with ENOAUTH when forceAuth is set without credentials', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, forceAuth: true, logger: false });

            try {
                await assert.rejects(pool.verify(), { code: 'ENOAUTH' });
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('succeeds without credentials when the server does not require them', async () => {
            const ts = await startServer();
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, logger: false });

            try {
                assert.strictEqual(await pool.verify(), true);
            } finally {
                pool.close();
                await ts.close();
            }
        });

        it('attempts the login with forceAuth even when the server does not advertise AUTH', async () => {
            const ts = await startServer({ disabledCommands: ['STARTTLS', 'AUTH'] });
            const pool = new SMTPPool({ host: '127.0.0.1', port: ts.port, auth, forceAuth: true, logger: false });

            try {
                await assert.rejects(pool.verify(), { code: 'EAUTH', command: 'AUTH PLAIN' });
            } finally {
                pool.close();
                await ts.close();
            }
        });
    });
});
