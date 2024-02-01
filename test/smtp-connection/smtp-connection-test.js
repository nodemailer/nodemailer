'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('node:fs');
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const SMTPConnection = require('../../lib/smtp-connection');
const packageData = require('../../package.json');
const SMTPServer = require('smtp-server').SMTPServer;
const HttpConnectProxy = require('proxy-test-server');
const xoauth2Server = require('./xoauth2-mock-server');
const XOAuth2 = require('../../lib/xoauth2');

let PORT_NUMBER = 8397;
let PROXY_PORT_NUMBER = 9999;
let LMTP_PORT_NUMBER = 8396;
let XOAUTH_PORT = 8497;

describe('SMTP-Connection Tests', () => {
    describe('Version test', () => {
        it('Should expose version number', () => {
            let client = new SMTPConnection();
            assert.strictEqual(client.version, packageData.version);
        });
    });

    describe('Connection tests', () => {
        let server, insecureServer, invalidServer, secureServer, disconnectingServer, httpProxy;

        before((t, done) => {
            server = new SMTPServer({
                onAuth: (auth, session, callback) => {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                    callback(null, {
                        user: auth.username
                    });
                },
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                }
            });

            insecureServer = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],
                onData: (stream, session, callback) => {
                    let err = false;
                    stream.on('data', chunk => {
                        if (err || session.use8BitMime) {
                            return;
                        }
                        for (let i = 0, len = chunk.length; i < len; i++) {
                            if (chunk[i] >= 0x80) {
                                err = new Error('8 bit content not allowed');
                            }
                        }
                    });
                    stream.on('end', () => {
                        callback(err, false);
                    });
                },
                logger: false
            });

            invalidServer = net.createServer(() => {});

            secureServer = new SMTPServer({
                secure: true,
                onAuth: (auth, session, callback) => {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                    callback(null, {
                        user: auth.username
                    });
                },
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },
                logger: false
            });

            disconnectingServer = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],
                onConnect(sess, callback) {
                    setTimeout(() => {
                        for (const conn of this.connections) {
                            conn._socket.write('454 4.3.0 Try again later\r\n');
                            conn._socket.destroy();
                        }
                    }, 20);
                    callback();
                },
                logger: false
            });

            httpProxy = new HttpConnectProxy();

            server.listen(PORT_NUMBER, () => {
                invalidServer.listen(PORT_NUMBER + 1, () => {
                    secureServer.listen(PORT_NUMBER + 2, () => {
                        insecureServer.listen(PORT_NUMBER + 3, () => {
                            disconnectingServer.listen(PORT_NUMBER + 4, () => {
                                httpProxy.listen(PROXY_PORT_NUMBER, done);
                            });
                        });
                    });
                });
            });
        });

        after((t, done) => {
            server.close(() => {
                invalidServer.close(() => {
                    secureServer.close(() => {
                        insecureServer.close(() => {
                            disconnectingServer.close(() => {
                                httpProxy.close(done);
                            });
                        });
                    });
                });
            });
        });

        it('should connect to unsecure server', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                ignoreTLS: true,
                logger: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, false);
                client.close();
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.on('end', done);
        });

        it('should connect to a server and upgrade with STARTTLS', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                logger: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, true);
                client.close();
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.on('end', done);
        });

        it('should connect and be rejected', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 4,
                logger: false,
                debug: false,
                transactionLog: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, false);
            });

            client.on('error', err => {
                assert.ok(err);
            });

            client.on('end', done);
        });

        it('should connect to a server and upgrade with forced STARTTLS', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                requireTLS: true,
                transactionLog: true,
                logger: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, true);
                client.close();
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.on('end', done);
        });

        it('should connect to a server and try to upgrade STARTTLS', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                logger: false,
                requireTLS: true,
                opportunisticTLS: true
            });

            client.connect(() => {
                assert.strictEqual(client.secure, false);
                client.close();
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.on('end', done);
        });

        it('should try upgrade with STARTTLS where not advertised', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                requireTLS: true,
                logger: false
            });

            client.connect(() => {
                // should not run
                assert.strictEqual(false, true);
                client.close();
            });

            client.once('error', err => {
                assert.ok(err);
            });

            client.on('end', done);
        });

        it('should close connection after STARTTLS', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                logger: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, true);
                server.connections.forEach(conn => {
                    conn.close();
                });
            });

            client.on('error', err => {
                assert.strictEqual(err.message, 'Connection closed unexpectedly');
            });

            client.on('end', done);
        });

        it('should connect to a secure server', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 2,
                secure: true,
                logger: false
            });

            client.connect(() => {
                assert.strictEqual(client.secure, true);
                client.close();
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.on('end', done);
        });

        it('should emit error for invalid port', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 10,
                logger: false
            });

            client.connect(() => {
                // should not run
                assert.strictEqual(false, true);
                client.close();
            });

            client.once('error', err => {
                assert.ok(err);
            });

            client.on('end', done);
        });

        it('should emit error for too large port', (t, done) => {
            let client = new SMTPConnection({
                port: 999999999,
                logger: false
            });

            client.connect(() => {
                // should not run
                assert.strictEqual(false, true);
                client.close();
            });

            client.once('error', err => {
                assert.ok(err);
            });

            client.on('end', done);
        });

        it('should emit inactivity timeout error', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                socketTimeout: 100,
                logger: false
            });

            client.connect(() => {
                // do nothing
            });

            client.once('error', err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ETIMEDOUT');
            });

            client.on('end', done);
        });

        it('should connect through proxy', (t, done) => {
            let runTest = function (socket) {
                let client = new SMTPConnection({
                    logger: false,
                    port: PORT_NUMBER,
                    connection: socket
                });

                client.connect(() => {
                    assert.strictEqual(client.secure, true);
                    client.login(
                        {
                            user: 'testuser',
                            credentials: {
                                user: 'testuser',
                                pass: 'testpass'
                            }
                        },
                        err => {
                            assert.ok(!err);
                            assert.strictEqual(client.authenticated, true);
                            client.close();
                        }
                    );
                });

                client.on('error', err => {
                    assert.ok(!err);
                });

                client.on('end', done);
            };

            proxyConnect(PROXY_PORT_NUMBER, '127.0.0.1', PORT_NUMBER, '127.0.0.1', (err, socket) => {
                assert.ok(!err);
                runTest(socket);
            });
        });

        it('should connect through proxy to secure server', (t, done) => {
            let runTest = function (socket) {
                let client = new SMTPConnection({
                    logger: false,
                    port: PORT_NUMBER + 2,
                    secure: true,
                    connection: socket
                });

                client.connect(() => {
                    assert.strictEqual(client.secure, true);
                    client.login(
                        {
                            user: 'testuser',
                            credentials: {
                                user: 'testuser',
                                pass: 'testpass'
                            }
                        },
                        err => {
                            assert.ok(!err);
                            assert.strictEqual(client.authenticated, true);
                            client.close();
                        }
                    );
                });

                client.on('error', err => {
                    assert.ok(!err);
                });

                client.on('end', done);
            };

            proxyConnect(PROXY_PORT_NUMBER, '127.0.0.1', PORT_NUMBER + 2, '127.0.0.1', (err, socket) => {
                assert.ok(!err);
                runTest(socket);
            });
        });

        it('should send to unsecure server', (t, done) => {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                ignoreTLS: true,
                logger: true,
                debug: true
            });

            client.on('error', err => {
                assert.ok(!err);
            });

            client.connect(() => {
                assert.strictEqual(client.secure, false);

                let chunks = [],
                    fname = __dirname + '/../../LICENSE',
                    message = fs.readFileSync(fname, 'utf-8');

                server.on('data', (connection, chunk) => {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', (connection, callback) => {
                    let body = Buffer.concat(chunks);
                    assert.strictEqual(body.toString(), message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    fs.createReadStream(fname),
                    err => {
                        assert.ok(!err);
                        client.close();
                    }
                );
            });

            client.on('end', done);
        });
    });

    describe('Login tests', () => {
        let server,
            lmtpServer,
            client,
            lmtpClient,
            testtoken = 'testtoken';

        beforeEach((t, done) => {
            server = new SMTPServer({
                authMethods: ['PLAIN', 'XOAUTH2'],
                disabledCommands: ['STARTTLS'],

                size: 100 * 1024,

                onData: (stream, session, callback) => {
                    let err = false;
                    stream.on('data', chunk => {
                        if (err || session.use8BitMime) {
                            return;
                        }
                        for (let i = 0, len = chunk.length; i < len; i++) {
                            if (chunk[i] >= 0x80) {
                                err = new Error('8 bit content not allowed');
                            }
                        }
                    });
                    stream.on('end', () => {
                        callback(err, false);
                    });
                },

                onAuth: (auth, session, callback) => {
                    if (auth.method !== 'XOAUTH2') {
                        if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                            return callback(new Error('Invalid username or password'));
                        }
                    } else if (auth.username !== 'testuser' || auth.accessToken !== testtoken) {
                        return callback(null, {
                            data: {
                                status: '401',
                                schemes: 'bearer mac',
                                scope: 'my_smtp_access_scope_name'
                            }
                        });
                    }
                    callback(null, {
                        user: auth.username
                    });
                },
                onMailFrom: (address, session, callback) => {
                    if (address.args && parseInt(address.args.SIZE, 10) > 50 * 1024) {
                        return callback(new Error('452 Insufficient channel storage: ' + address.address));
                    }

                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }

                    if (address.args.SMTPUTF8) {
                        session.smtpUtf8 = true;
                    }

                    if (address.args.BODY === '8BITMIME') {
                        session.use8BitMime = true;
                    }

                    if (/[\x80-\uFFFF]/.test(address.address) && !session.smtpUtf8) {
                        return callback(new Error('Trying to use Unicode address without declaring SMTPUTF8 first'));
                    }

                    return callback(); // Accept the address
                },
                onRcptTo: (address, session, callback) => {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    if (/[\x80-\uFFFF]/.test(address.address) && !session.smtpUtf8) {
                        return callback(new Error('Trying to use Unicode address without declaring SMTPUTF8 first'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            lmtpServer = new SMTPServer({
                lmtp: true,
                disabledCommands: ['STARTTLS', 'AUTH'],

                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', () => {
                        let response = session.envelope.rcptTo.map((rcpt, i) => {
                            if (i % 2) {
                                return '<' + rcpt.address + '> Accepted';
                            } else {
                                return new Error('<' + rcpt.address + '> Not accepted');
                            }
                        });
                        callback(null, response);
                    });
                },
                onMailFrom: (address, session, callback) => {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },
                onRcptTo: (address, session, callback) => {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            client = new SMTPConnection({
                port: PORT_NUMBER,
                logger: false,
                debug: false
            });

            lmtpClient = new SMTPConnection({
                port: LMTP_PORT_NUMBER,
                lmtp: true,
                logger: false,
                debug: false
            });

            server.listen(PORT_NUMBER, () => {
                lmtpServer.listen(LMTP_PORT_NUMBER, () => {
                    client.connect(() => {
                        lmtpClient.connect(done);
                    });
                });
            });
        });

        afterEach((t, done) => {
            client.close();
            lmtpClient.close();
            server.close(() => {
                lmtpServer.close(done);
            });
        });

        it('should login', (t, done) => {
            assert.strictEqual(client.authenticated, false);
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser',
                        pass: 'testpass'
                    }
                },
                err => {
                    assert.ok(!err);
                    assert.strictEqual(client.authenticated, true);
                    done();
                }
            );
        });

        it('should return error for invalid login', (t, done) => {
            assert.strictEqual(client.authenticated, false);
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser',
                        pass: 'invalid'
                    }
                },
                err => {
                    assert.ok(err);
                    assert.strictEqual(client.authenticated, false);
                    assert.strictEqual(err.code, 'EAUTH');
                    assert.strictEqual(err.responseCode, 535);
                    done();
                }
            );
        });

        it('should return error for missing credentials', (t, done) => {
            assert.strictEqual(client.authenticated, false);
            client.login(
                {
                    user: 'testuser'
                },
                err => {
                    assert.ok(err);
                    assert.strictEqual(client.authenticated, false);
                    assert.ok(/^Missing credentials/.test(err.message));
                    assert.strictEqual(err.code, 'EAUTH');
                    assert.strictEqual(err.response, undefined);
                    done();
                }
            );
        });

        it('should return error for incomplete credentials', (t, done) => {
            assert.strictEqual(client.authenticated, false);
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser'
                    }
                },
                err => {
                    assert.ok(err);
                    assert.strictEqual(client.authenticated, false);
                    assert.ok(/^Missing credentials/.test(err.message));
                    assert.strictEqual(err.code, 'EAUTH');
                    assert.strictEqual(err.response, undefined);
                    done();
                }
            );
        });

        describe('xoauth2 login', () => {
            let x2server;

            beforeEach((t, done) => {
                x2server = xoauth2Server({
                    port: XOAUTH_PORT,
                    onUpdate: (username, accessToken) => {
                        testtoken = accessToken;
                    }
                });

                x2server.addUser('testuser', 'refresh-token');

                x2server.start(done);
            });

            afterEach((t, done) => {
                x2server.stop(done);
            });

            it('should login with xoauth2 string', (t, done) => {
                assert.strictEqual(client.authenticated, false);
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            accessToken: testtoken
                        })
                    },
                    err => {
                        assert.ok(!err);
                        assert.strictEqual(client.authenticated, true);
                        done();
                    }
                );
            });

            it('should return error for invalid xoauth2 string token', (t, done) => {
                assert.strictEqual(client.authenticated, false);
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            accessToken: 'invalid'
                        })
                    },
                    err => {
                        assert.ok(err);
                        assert.strictEqual(client.authenticated, false);
                        assert.strictEqual(err.code, 'EAUTH');
                        done();
                    }
                );
            });

            it('should login with xoauth2 object', (t, done) => {
                assert.strictEqual(client.authenticated, false);
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            clientId: '{Client ID}',
                            clientSecret: '{Client Secret}',
                            refreshToken: 'refresh-token',
                            accessToken: 'uuuuu',
                            accessUrl: 'http://localhost:' + XOAUTH_PORT
                        })
                    },
                    err => {
                        assert.ok(!err);
                        assert.strictEqual(client.authenticated, true);
                        done();
                    }
                );
            });

            it('should fail with xoauth2 object', (t, done) => {
                assert.strictEqual(client.authenticated, false);
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            clientId: '{Client ID}',
                            clientSecret: '{Client Secret}',
                            refreshToken: 'refrsesh-token',
                            accessToken: 'uuuuu',
                            accessUrl: 'http://localhost:' + XOAUTH_PORT
                        })
                    },
                    err => {
                        assert.ok(err);
                        assert.strictEqual(client.authenticated, false);
                        done();
                    }
                );
            });

            it('should fail with invalid xoauth2 response', (t, done) => {
                assert.strictEqual(client.authenticated, false);

                let oauth2 = new XOAuth2({
                    user: 'testuser',
                    clientId: '{Client ID}',
                    clientSecret: '{Client Secret}',
                    refreshToken: 'refrsesh-token',
                    accessToken: 'uuuuu',
                    accessUrl: 'http://localhost:' + XOAUTH_PORT
                });

                t.mock.method(oauth2, 'generateToken', cb => cb(null, 'dXNlcj10ZXN0dXNlcgFhdXRoPUJlYXJlciB1dXV1dQEB'));

                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2
                    },
                    err => {
                        assert.ok(err);
                        assert.strictEqual(client.authenticated, false);

                        t.mock.restoreAll();
                        done();
                    }
                );
            });
        });

        describe('custom login', () => {
            let customClient;
            beforeEach((t, done) => {
                customClient = new SMTPConnection({
                    port: PORT_NUMBER,
                    logger: false,
                    debug: false,
                    customAuth: {
                        mytest: client => {
                            client.sendCommand('HALLO1 HALLO', (err, response) => {
                                assert.ok(!err);
                                assert.strictEqual(response.status, 500);
                                client.sendCommand('HALLO2 HALLO', (err, response) => {
                                    assert.ok(!err);
                                    assert.strictEqual(response.status, 500);
                                    client.resolve();
                                });
                            });
                        }
                    }
                });

                customClient.connect(done);
            });

            afterEach((t, done) => {
                customClient.close();
                done();
            });

            it('should login', (t, done) => {
                assert.strictEqual(customClient.authenticated, false);
                customClient.login(
                    {
                        method: 'mytest',
                        user: 'testuser',
                        credentials: {
                            user: 'testuser',
                            pass: 'testpass'
                        }
                    },
                    err => {
                        assert.ok(!err);
                        assert.strictEqual(customClient.authenticated, true);
                        done();
                    }
                );
            });

            it('should login without pass', (t, done) => {
                assert.strictEqual(customClient.authenticated, false);
                customClient.login(
                    {
                        method: 'mytest',
                        apiUser: 'aaaa',
                        apiKey: 'testkey'
                    },
                    err => {
                        assert.ok(!err);
                        assert.strictEqual(customClient.authenticated, true);
                        done();
                    }
                );
            });
        });

        describe('Send without PIPELINING', () => {
            beforeEach((t, done) => {
                client.on('end', () => {
                    client = new SMTPConnection({
                        port: PORT_NUMBER,
                        logger: false,
                        debug: false
                    });
                    // disable PIPELINING
                    server.options.hidePIPELINING = true;
                    client.connect(() => {
                        client.login(
                            {
                                user: 'testuser',
                                credentials: {
                                    user: 'testuser',
                                    pass: 'testpass'
                                }
                            },
                            err => {
                                assert.ok(!err);
                                // enable PIPELINING
                                server.options.hidePIPELINING = false;
                                done();
                            }
                        );
                    });
                });
                client.close();
            });

            it('should send only to valid recipients without PIPELINING', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3@valid.recipient']
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test1@valid.recipient', 'test3@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            ehlo: ['8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        assert.strictEqual(info.rejectedErrors.length, 1);
                        done();
                    }
                );
            });
        });

        describe('Send messages', () => {
            beforeEach((t, done) => {
                client.login(
                    {
                        user: 'testuser',
                        credentials: {
                            user: 'testuser',
                            pass: 'testpass'
                        }
                    },
                    err => {
                        assert.ok(!err);
                        done();
                    }
                );
            });

            it('should send message', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test@valid.recipient'],
                            rejected: [],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('should send multiple messages', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test@valid.recipient'],
                            rejected: [],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        client.reset(err => {
                            assert.ok(!err);

                            client.send(
                                {
                                    from: 'test2@valid.sender',
                                    to: 'test2@valid.recipient'
                                },
                                'test2',
                                (err, info) => {
                                    assert.ok(!err);
                                    assert.deepStrictEqual(info, {
                                        accepted: ['test2@valid.recipient'],
                                        rejected: [],
                                        ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                                        envelopeTime: info.envelopeTime,
                                        messageTime: info.messageTime,
                                        messageSize: info.messageSize,
                                        response: '250 OK: message queued'
                                    });
                                    done();
                                }
                            );
                        });
                    }
                );
            });

            it('should send only to valid recipients', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3@valid.recipient']
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test1@valid.recipient', 'test3@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        assert.strictEqual(info.rejectedErrors.length, 1);
                        done();
                    }
                );
            });

            it('should reject all recipients', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']
                    },
                    'test',
                    (err, info) => {
                        assert.ok(err);
                        assert.ok(!info);
                        assert.deepStrictEqual(err.rejected, ['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']);
                        assert.strictEqual(err.rejectedErrors.length, 3);
                        done();
                    }
                );
            });

            it('should reject too large SIZE arguments', (t, done) => {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 1024 * 1024
                    },
                    'test',
                    (err, info) => {
                        assert.ok(err);
                        assert.ok(!info);
                        done();
                    }
                );
            });

            it('should reject too large message', (t, done) => {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 70 * 1024
                    },
                    'test',
                    (err, info) => {
                        assert.ok(err);
                        assert.ok(!info);
                        done();
                    }
                );
            });

            it('should declare SIZE', (t, done) => {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 10 * 1024
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test2@valid.recipient'],
                            rejected: [],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('lmtp should send only to valid recipients', (t, done) => {
                lmtpClient.send(
                    {
                        from: 'test@valid.sender',
                        to: [
                            'test1@valid.recipient',
                            'test2@invalid.recipient',
                            'test3@valid.recipient',
                            'test4@valid.recipient',
                            'test5@valid.recipient',
                            'test6@valid.recipient'
                        ]
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info.accepted, ['test3@valid.recipient', 'test5@valid.recipient']);
                        assert.deepStrictEqual(info.rejected, [
                            'test2@invalid.recipient',
                            'test1@valid.recipient',
                            'test4@valid.recipient',
                            'test6@valid.recipient'
                        ]);
                        assert.strictEqual(info.rejectedErrors.length, info.rejected.length);
                        done();
                    }
                );
            });

            it('should send using SMTPUTF8', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'test',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test1@valid.recipient', 'test3õ@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('should send using 8BITMIME', (t, done) => {
                client.send(
                    {
                        use8BitMime: true,
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'õõõõ',
                    (err, info) => {
                        assert.ok(!err);
                        assert.deepStrictEqual(info, {
                            accepted: ['test1@valid.recipient', 'test3õ@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            ehlo: ['PIPELINING', '8BITMIME', 'SMTPUTF8', 'AUTH PLAIN XOAUTH2', 'SIZE 102400'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('should receive error for 8-bit content without 8BITMIME declaration', (t, done) => {
                client.send(
                    {
                        use8BitMime: false,
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'õõõõ',
                    err => {
                        assert.strictEqual(/8 bit content not allowed/.test(err.message), true);
                        done();
                    }
                );
            });

            it('should return error for invalidly formatted recipients', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient', '"address\r\n with folding"@valid.recipient']
                    },
                    'test',
                    err => {
                        assert.strictEqual(/^Invalid recipient/.test(err.message), true);
                        done();
                    }
                );
            });

            it('should return error for no valid recipients', (t, done) => {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']
                    },
                    'test',
                    err => {
                        assert.ok(err);
                        done();
                    }
                );
            });

            it('should return error for invalid sender', (t, done) => {
                client.send(
                    {
                        from: 'test@invalid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    err => {
                        assert.ok(err);
                        done();
                    }
                );
            });

            it('should send message string', (t, done) => {
                let chunks = [],
                    message = new Array(1024).join('teretere, vana kere\n');

                server.on('data', (connection, chunk) => {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', (connection, callback) => {
                    let body = Buffer.concat(chunks);
                    assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    message,
                    err => {
                        assert.ok(!err);
                        done();
                    }
                );
            });

            it('should send message buffer', (t, done) => {
                let chunks = [],
                    message = Buffer.from(new Array(1024).join('teretere, vana kere\n'));

                server.on('data', (connection, chunk) => {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', (connection, callback) => {
                    let body = Buffer.concat(chunks);
                    assert.strictEqual(body.toString(), message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    message,
                    err => {
                        assert.ok(!err);
                        done();
                    }
                );
            });

            it('should send message stream', (t, done) => {
                let chunks = [],
                    fname = __dirname + '/../../LICENSE',
                    message = fs.readFileSync(fname, 'utf-8');

                server.on('data', (connection, chunk) => {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', (connection, callback) => {
                    let body = Buffer.concat(chunks);
                    assert.strictEqual(body.toString(), message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    fs.createReadStream(fname),
                    err => {
                        assert.ok(!err);
                        done();
                    }
                );
            });
        });
    });
});

function proxyConnect(port, host, destinationPort, destinationHost, callback) {
    let socket = net.connect(port, host, () => {
        socket.write('CONNECT ' + destinationHost + ':' + destinationPort + ' HTTP/1.1\r\n\r\n');

        let headers = '';
        let onSocketData = chunk => {
            let match;
            let remainder;

            headers += chunk.toString('binary');
            if ((match = headers.match(/\r\n\r\n/))) {
                socket.removeListener('data', onSocketData);
                remainder = headers.substr(match.index + match[0].length);
                headers = headers.substr(0, match.index);
                if (remainder) {
                    socket.unshift(Buffer.from(remainder, 'binary'));
                }
                // proxy connection is now established
                return callback(null, socket);
            }
        };
        socket.on('data', onSocketData);
    });

    socket.on('error', err => {
        assert.ok(!err);
    });
}
