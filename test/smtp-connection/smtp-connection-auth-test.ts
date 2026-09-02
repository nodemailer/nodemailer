/**
 * Authentication paths of SMTPConnection that the main suite does not reach:
 * AUTH LOGIN, CRAM-MD5, the PLAIN wire format, SASL method selection and the
 * custom authentication handler contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import SMTPConnection, {
    type SMTPConnectionCustomAuthContext,
    type SMTPConnectionCustomAuthResponse
} from '../../src/smtp-connection/index.js';
import type { NodemailerError } from '../../src/errors.js';
import { SMTPServer } from 'smtp-server';
import { startRawServer, finishRawServer, createClient } from './raw-smtp-server.js';

interface SeenAuth {
    method: string;
    username: string;
    password?: string;
}

/**
 * smtp-server with the given SASL methods, recording what the client submitted
 */
function startAuthServer(
    authMethods: string[],
    callback: (server: any, port: number, seen: SeenAuth[]) => void,
    validate?: (auth: any) => boolean
): void {
    const seen: SeenAuth[] = [];
    const server = new SMTPServer({
        authMethods,
        disabledCommands: ['STARTTLS'],
        logger: false,
        onAuth: (auth: any, session: any, done: (err: Error | null, response?: any) => void) => {
            seen.push({ method: auth.method, username: auth.username, password: auth.password });
            const valid = validate ? validate(auth) : auth.username === 'testuser' && auth.password === 'testpass';
            if (!valid) {
                return done(new Error('Invalid username or password'));
            }
            done(null, { user: auth.username });
        }
    });

    server.listen(0, '127.0.0.1', () => callback(server, server.server.address().port, seen));
}

describe('SMTP-Connection authentication', () => {
    describe('Method selection', () => {
        it('detects DSN and the advertised SASL methods in the EHLO reply', (t, done) => {
            startRawServer({ EHLO: '250-test\r\n250-DSN\r\n250 AUTH CRAM-MD5 LOGIN\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    assert.strictEqual(client.allowsAuth, true);
                    assert.deepStrictEqual(client._supportedAuth, ['LOGIN', 'CRAM-MD5']);
                    assert.deepStrictEqual(client._supportedExtensions, ['DSN']);
                    client.quit();
                });

                client.on('end', () => finishRawServer(server, done));
            });
        });

        it('sends AUTH PLAIN without an authorization identity when nothing is advertised', (t, done) => {
            let authCommand: string | undefined;
            startRawServer(
                {
                    AUTH: line => {
                        authCommand = line;
                        return '235 2.7.0 Authentication successful\r\n';
                    }
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        assert.strictEqual(client.allowsAuth, false);
                        client.login({ user: 'testuser', pass: 'testpass' }, (err, result) => {
                            assert.ok(!err, err?.message);
                            assert.strictEqual(result, true);
                            assert.strictEqual(client.authenticated, true);
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.strictEqual(authCommand, 'AUTH PLAIN ' + Buffer.from('\0testuser\0testpass').toString('base64'));
                        });
                    });
                }
            );
        });

        it('falls back to the first advertised method when XOAUTH2 is requested without a token', (t, done) => {
            startAuthServer(['LOGIN'], (server, port, seen) => {
                const client = new SMTPConnection({ port, host: '127.0.0.1', logger: false });

                client.on('error', err => {
                    server.close(() => done(err));
                });

                client.connect(() => {
                    client.login({ method: 'XOAUTH2', user: 'testuser', pass: 'testpass' }, err => {
                        assert.ok(!err, err?.message);
                        assert.strictEqual(client.authenticated, true);
                        assert.strictEqual(client._authMethod, 'LOGIN');
                        client.quit();
                    });
                });

                client.on('end', () => {
                    server.close(() => {
                        assert.deepStrictEqual(seen, [{ method: 'LOGIN', username: 'testuser', password: 'testpass' }]);
                        done();
                    });
                });
            });
        });

        it('rejects an unknown authentication method', (t, done) => {
            startRawServer({}, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ method: 'digest-md5', user: 'testuser', pass: 'testpass' }, err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'EAUTH');
                        assert.strictEqual(err.command, 'API');
                        assert.strictEqual(err.message, 'Unknown authentication method "DIGEST-MD5"');
                        assert.strictEqual(client.authenticated, false);
                        client.quit();
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(!server.commands.some(line => /^AUTH/i.test(line)), 'no AUTH command may be sent');
                    });
                });
            });
        });
    });

    describe('AUTH LOGIN', () => {
        it('authenticates against a server that only offers LOGIN', (t, done) => {
            startAuthServer(['LOGIN'], (server, port, seen) => {
                const client = new SMTPConnection({ port, host: '127.0.0.1', logger: false });

                client.on('error', err => {
                    server.close(() => done(err));
                });

                client.connect(() => {
                    assert.deepStrictEqual(client._supportedAuth, ['LOGIN']);
                    client.login({ user: 'testuser', pass: 'testpass' }, (err, result) => {
                        assert.ok(!err, err?.message);
                        assert.strictEqual(result, true);
                        assert.strictEqual(client.authenticated, true);
                        client.quit();
                    });
                });

                client.on('end', () => {
                    server.close(() => {
                        assert.deepStrictEqual(seen, [{ method: 'LOGIN', username: 'testuser', password: 'testpass' }]);
                        done();
                    });
                });
            });
        });

        it('sends the username and password as separate base64 lines', (t, done) => {
            const continuationLines: string[] = [];
            startRawServer(
                {
                    EHLO: '250-test\r\n250 AUTH LOGIN\r\n',
                    AUTH: '334 VXNlcm5hbWU6\r\n',
                    DEFAULT: line => {
                        continuationLines.push(line);
                        return continuationLines.length === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 Authentication successful\r\n';
                    }
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.login({ user: 'testuser', pass: 'pässword' }, err => {
                            assert.ok(!err, err?.message);
                            assert.strictEqual(client.authenticated, true);
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.ok(server.commands.includes('AUTH LOGIN'));
                            assert.deepStrictEqual(continuationLines, [
                                Buffer.from('testuser').toString('base64'),
                                Buffer.from('pässword', 'utf-8').toString('base64')
                            ]);
                        });
                    });
                }
            );
        });

        it('reports EAUTH when the server does not send the username challenge', (t, done) => {
            startRawServer({ EHLO: '250-test\r\n250 AUTH LOGIN\r\n', AUTH: '503 5.5.1 Not now\r\n' }, server => {
                const client = createClient(server);

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ user: 'testuser', pass: 'testpass' }, err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'EAUTH');
                        assert.strictEqual(err.command, 'AUTH LOGIN');
                        assert.strictEqual(err.responseCode, 503);
                        assert.strictEqual(err.message, 'Invalid login sequence while waiting for "334 VXNlcm5hbWU6": 503 5.5.1 Not now');
                        assert.strictEqual(client.authenticated, false);
                        client.quit();
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.deepStrictEqual(
                            server.commands.filter(line => !/^(EHLO|QUIT)/i.test(line)),
                            ['AUTH LOGIN'],
                            'no credentials may be sent after a refused AUTH LOGIN'
                        );
                    });
                });
            });
        });

        it('reports EAUTH when the server does not send the password challenge', (t, done) => {
            const continuationLines: string[] = [];
            startRawServer(
                {
                    EHLO: '250-test\r\n250 AUTH LOGIN\r\n',
                    AUTH: '334 VXNlcm5hbWU6\r\n',
                    DEFAULT: line => {
                        continuationLines.push(line);
                        return '535 5.7.8 Unknown user\r\n';
                    }
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.login({ user: 'testuser', pass: 'testpass' }, err => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 'EAUTH');
                            assert.strictEqual(err.command, 'AUTH LOGIN');
                            assert.strictEqual(err.responseCode, 535);
                            assert.strictEqual(
                                err.message,
                                'Invalid login sequence while waiting for "334 UGFzc3dvcmQ6": 535 5.7.8 Unknown user'
                            );
                            assert.strictEqual(client.authenticated, false);
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            // only the username was sent, the password never left the client
                            assert.deepStrictEqual(continuationLines, [Buffer.from('testuser').toString('base64')]);
                        });
                    });
                }
            );
        });
    });

    describe('AUTH CRAM-MD5', () => {
        it('answers the challenge with the RFC 2195 digest', (t, done) => {
            // the worked example from RFC 2195 section 2
            const challenge = '<1896.697170952@postoffice.reston.mci.net>';
            const expectedResponse = 'dGltIGI5MTNhNjAyYzdlZGE3YTQ5NWI0ZTZlNzMzNGQzODkw';
            const continuationLines: string[] = [];

            startRawServer(
                {
                    EHLO: '250-test\r\n250 AUTH CRAM-MD5\r\n',
                    AUTH: '334 ' + Buffer.from(challenge).toString('base64') + '\r\n',
                    DEFAULT: line => {
                        continuationLines.push(line);
                        return line === expectedResponse ? '235 2.7.0 Authentication successful\r\n' : '535 5.7.8 Bad digest\r\n';
                    }
                },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.login({ user: 'tim', pass: 'tanstaaftanstaaf' }, (err, result) => {
                            assert.ok(!err, err?.message);
                            assert.strictEqual(result, true);
                            assert.strictEqual(client.authenticated, true);
                            assert.strictEqual(client._authMethod, 'CRAM-MD5');
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.ok(server.commands.includes('AUTH CRAM-MD5'));
                            assert.deepStrictEqual(continuationLines, [expectedResponse]);
                            // and the digest is what HMAC-MD5 over the decoded challenge gives
                            const digest = crypto.createHmac('md5', 'tanstaaftanstaaf').update(challenge).digest('hex');
                            assert.strictEqual(Buffer.from(continuationLines[0], 'base64').toString(), 'tim ' + digest);
                        });
                    });
                }
            );
        });

        it('authenticates against smtp-server', (t, done) => {
            startAuthServer(
                ['CRAM-MD5'],
                (server, port, seen) => {
                    const client = new SMTPConnection({ port, host: '127.0.0.1', logger: false });

                    client.on('error', err => {
                        server.close(() => done(err));
                    });

                    client.connect(() => {
                        assert.deepStrictEqual(client._supportedAuth, ['CRAM-MD5']);
                        client.login({ user: 'testuser', pass: 'testpass' }, (err, result) => {
                            assert.ok(!err, err?.message);
                            assert.strictEqual(result, true);
                            assert.strictEqual(client.authenticated, true);
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        server.close(() => {
                            assert.strictEqual(seen.length, 1);
                            assert.strictEqual(seen[0].method, 'CRAM-MD5');
                            assert.strictEqual(seen[0].username, 'testuser');
                            done();
                        });
                    });
                },
                auth => auth.method === 'CRAM-MD5' && auth.validatePassword('testpass')
            );
        });

        it('reports EAUTH when the digest is rejected', (t, done) => {
            startAuthServer(
                ['CRAM-MD5'],
                (server, port) => {
                    const client = new SMTPConnection({ port, host: '127.0.0.1', logger: false });

                    client.on('error', err => {
                        server.close(() => done(err));
                    });

                    client.connect(() => {
                        client.login({ user: 'testuser', pass: 'wrongpass' }, err => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 'EAUTH');
                            assert.strictEqual(err.command, 'AUTH CRAM-MD5');
                            assert.strictEqual(err.responseCode, 535);
                            assert.ok(/^Invalid login sequence while waiting for "235"/.test(err.message), err.message);
                            assert.strictEqual(client.authenticated, false);
                            client.quit();
                        });
                    });

                    client.on('end', () => server.close(done));
                },
                auth => auth.method === 'CRAM-MD5' && auth.validatePassword('testpass')
            );
        });

        it('reports EAUTH when the server does not send a challenge', (t, done) => {
            startRawServer(
                { EHLO: '250-test\r\n250 AUTH CRAM-MD5\r\n', AUTH: '504 5.5.4 Unrecognized authentication type\r\n' },
                server => {
                    const client = createClient(server);

                    client.on('error', err => {
                        finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                    });

                    client.connect(() => {
                        client.login({ user: 'testuser', pass: 'testpass' }, err => {
                            assert.ok(err);
                            assert.strictEqual(err.code, 'EAUTH');
                            assert.strictEqual(err.command, 'AUTH CRAM-MD5');
                            assert.strictEqual(err.responseCode, 504);
                            assert.strictEqual(
                                err.message,
                                'Invalid login sequence while waiting for server challenge string: 504 5.5.4 Unrecognized authentication type'
                            );
                            assert.strictEqual(client.authenticated, false);
                            client.quit();
                        });
                    });

                    client.on('end', () => {
                        finishRawServer(server, done, () => {
                            assert.deepStrictEqual(
                                server.commands.filter(line => !/^(EHLO|QUIT)/i.test(line)),
                                ['AUTH CRAM-MD5'],
                                'no digest may be sent without a challenge'
                            );
                        });
                    });
                }
            );
        });
    });

    describe('Custom authentication handlers', () => {
        const script = {
            EHLO: '250-test\r\n250-SIZE 1000\r\n250 AUTH PLAIN\r\n',
            XAUTH: (line: string) => (line === 'XAUTH first' ? '250 2.0.0 ok first\r\n' : 'no status code here\r\n')
        };

        it('resolves through a returned promise and parses the replies of sendCommand', (t, done) => {
            const replies: SMTPConnectionCustomAuthResponse[] = [];
            let context: SMTPConnectionCustomAuthContext | undefined;

            startRawServer(script, server => {
                const client = createClient(server, {
                    customAuth: {
                        promiseAuth: async ctx => {
                            context = ctx;
                            // no callback: sendCommand returns a promise
                            replies.push((await ctx.sendCommand('XAUTH first')) as SMTPConnectionCustomAuthResponse);
                            replies.push((await ctx.sendCommand('XAUTH second')) as SMTPConnectionCustomAuthResponse);
                        }
                    }
                });

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ method: 'promiseauth', user: 'testuser', pass: 'testpass' }, (err, result) => {
                        assert.ok(!err, err?.message);
                        assert.strictEqual(result, true);
                        assert.strictEqual(client.authenticated, true);
                        client.quit();
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.ok(context);
                        assert.strictEqual(context.method, 'PROMISEAUTH');
                        assert.deepStrictEqual(context.extensions, ['SIZE']);
                        assert.deepStrictEqual(context.authMethods, ['PLAIN']);
                        assert.strictEqual(context.maxAllowedSize, 1000);
                        assert.strictEqual(context.auth.user, 'testuser');

                        assert.deepStrictEqual(replies, [
                            { command: 'XAUTH first', response: '250 2.0.0 ok first', status: 250, code: '2.0.0', text: 'ok first' },
                            { command: 'XAUTH second', response: 'no status code here', status: 0, text: 'no status code here' }
                        ]);
                        assert.deepStrictEqual(
                            server.commands.filter(line => /^XAUTH/.test(line)),
                            ['XAUTH first', 'XAUTH second']
                        );
                    });
                });
            });
        });

        it('fails with EAUTH and the last server reply when the handler promise rejects', (t, done) => {
            startRawServer(script, server => {
                const client = createClient(server, {
                    customAuth: {
                        rejectAuth: async ctx => {
                            await ctx.sendCommand('XAUTH first');
                            throw new Error('token expired');
                        }
                    }
                });

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ method: 'rejectAuth', user: 'testuser', pass: 'testpass' }, err => {
                        assert.ok(err);
                        assert.strictEqual(err.code, 'EAUTH');
                        assert.strictEqual(err.command, 'AUTH REJECTAUTH');
                        assert.strictEqual(err.response, '250 2.0.0 ok first');
                        assert.strictEqual(err.responseCode, 250);
                        assert.strictEqual(err.message, 'token expired: 250 2.0.0 ok first');
                        assert.strictEqual(client.authenticated, false);
                        client.quit();
                    });
                });

                client.on('end', () => finishRawServer(server, done));
            });
        });

        it('reports reject() with EAUTH and ignores a later resolve()', (t, done) => {
            const results: Array<NodemailerError | null> = [];

            startRawServer(script, server => {
                const client = createClient(server, {
                    customAuth: {
                        rejectAuth: ctx => {
                            ctx.reject('access denied');
                            ctx.resolve();
                            ctx.reject('second rejection');
                        }
                    }
                });

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ method: 'rejectAuth', user: 'testuser', pass: 'testpass' }, err => {
                        results.push(err);
                        setImmediate(() => client.quit());
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.strictEqual(results.length, 1, 'the login callback must run exactly once');
                        const err = results[0];
                        assert.ok(err);
                        assert.strictEqual(err.code, 'EAUTH');
                        assert.strictEqual(err.command, 'AUTH REJECTAUTH');
                        assert.strictEqual(err.message, 'access denied');
                        assert.strictEqual(err.response, undefined);
                        assert.strictEqual(client.authenticated, false);
                    });
                });
            });
        });

        it('calls the login callback once when resolve() is repeated', (t, done) => {
            const results: Array<NodemailerError | null> = [];

            startRawServer(script, server => {
                const client = createClient(server, {
                    customAuth: {
                        resolveAuth: ctx => {
                            ctx.resolve();
                            ctx.resolve();
                            ctx.reject('too late');
                        }
                    }
                });

                client.on('error', err => {
                    finishRawServer(server, done, () => assert.fail('unexpected error: ' + err.message));
                });

                client.connect(() => {
                    client.login({ method: 'resolveAuth', user: 'testuser', pass: 'testpass' }, err => {
                        results.push(err);
                        setImmediate(() => client.quit());
                    });
                });

                client.on('end', () => {
                    finishRawServer(server, done, () => {
                        assert.deepStrictEqual(results, [null]);
                        assert.strictEqual(client.authenticated, true);
                    });
                });
            });
        });
    });
});
