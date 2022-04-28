/* eslint no-unused-expressions:0, no-invalid-this:0, no-var: 0, prefer-arrow-callback: 0, object-shorthand: 0 */
/* globals afterEach, beforeEach, describe, it */

'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let fs = require('fs');
let chai = require('chai');
let expect = chai.expect;
let SMTPConnection = require('../../lib/smtp-connection');
let packageData = require('../../package.json');
let SMTPServer = require('smtp-server').SMTPServer;
let HttpConnectProxy = require('proxy-test-server');
let net = require('net');
let xoauth2Server = require('./xoauth2-mock-server');
let XOAuth2 = require('../../lib/xoauth2');
let sinon = require('sinon');

chai.config.includeStack = true;

let PORT_NUMBER = 8397;
let PROXY_PORT_NUMBER = 9999;
let LMTP_PORT_NUMBER = 8396;
let XOAUTH_PORT = 8497;

describe('SMTP-Connection Tests', function () {
    this.timeout(50 * 1000); // eslint-disable-line no-invalid-this

    describe('Version test', function () {
        it('Should expose version number', function () {
            let client = new SMTPConnection();
            expect(client.version).to.equal(packageData.version);
        });
    });

    describe('Connection tests', function () {
        let server, insecureServer, invalidServer, secureServer, httpProxy;

        beforeEach(function (done) {
            server = new SMTPServer({
                onAuth: function (auth, session, callback) {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                    callback(null, {
                        user: 123
                    });
                },
                onData: function (stream, session, callback) {
                    stream.on('data', function () {});
                    stream.on('end', callback);
                }
            });

            insecureServer = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],
                onData: function (stream, session, callback) {
                    let err = false;
                    stream.on('data', function (chunk) {
                        if (err || session.use8BitMime) {
                            return;
                        }
                        for (let i = 0, len = chunk.length; i < len; i++) {
                            if (chunk[i] >= 0x80) {
                                err = new Error('8 bit content not allowed');
                            }
                        }
                    });
                    stream.on('end', function () {
                        callback(err, false);
                    });
                },
                logger: false
            });

            invalidServer = net.createServer(function () {});

            secureServer = new SMTPServer({
                secure: true,
                onAuth: function (auth, session, callback) {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                    callback(null, {
                        user: 123
                    });
                },
                onData: function (stream, session, callback) {
                    stream.on('data', function () {});
                    stream.on('end', callback);
                },
                logger: false
            });

            httpProxy = new HttpConnectProxy();

            server.listen(PORT_NUMBER, function () {
                invalidServer.listen(PORT_NUMBER + 1, function () {
                    secureServer.listen(PORT_NUMBER + 2, function () {
                        insecureServer.listen(PORT_NUMBER + 3, function () {
                            httpProxy.listen(PROXY_PORT_NUMBER, done);
                        });
                    });
                });
            });
        });

        afterEach(function (done) {
            server.close(function () {
                invalidServer.close(function () {
                    secureServer.close(function () {
                        insecureServer.close(function () {
                            httpProxy.close(done);
                        });
                    });
                });
            });
        });

        it('should connect to unsecure server', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                ignoreTLS: true,
                logger: false
            });

            client.connect(function () {
                expect(client.secure).to.be.false;
                client.close();
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.on('end', done);
        });

        it('should connect to a server and upgrade with STARTTLS', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                logger: false
            });

            client.connect(function () {
                expect(client.secure).to.be.true;
                client.close();
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.on('end', done);
        });

        it('should connect to a server and upgrade with forced STARTTLS', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                requireTLS: true,
                transactionLog: true,
                logger: false
            });

            client.connect(function () {
                expect(client.secure).to.be.true;
                client.close();
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.on('end', done);
        });

        it('should connect to a server and try to upgrade STARTTLS', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                logger: false,
                requireTLS: true,
                opportunisticTLS: true
            });

            client.connect(function () {
                expect(client.secure).to.be.false;
                client.close();
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.on('end', done);
        });

        it('should try upgrade with STARTTLS where not advertised', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                requireTLS: true,
                logger: false
            });

            client.connect(function () {
                // should not run
                expect(false).to.be.true;
                client.close();
            });

            client.once('error', function (err) {
                expect(err).to.exist;
            });

            client.on('end', done);
        });

        it('should close connection after STARTTLS', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                logger: false
            });

            client.connect(function () {
                expect(client.secure).to.be.true;
                server.connections.forEach(function (conn) {
                    conn.close();
                });
            });

            client.on('error', function (err) {
                expect(err.message).to.equal('Connection closed unexpectedly');
            });

            client.on('end', done);
        });

        it('should connect to a secure server', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 2,
                secure: true,
                logger: false
            });

            client.connect(function () {
                expect(client.secure).to.be.true;
                client.close();
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.on('end', done);
        });

        it('should emit error for invalid port', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 10,
                logger: false
            });

            client.connect(function () {
                // should not run
                expect(false).to.be.true;
                client.close();
            });

            client.once('error', function (err) {
                expect(err).to.exist;
            });

            client.on('end', done);
        });

        it('should emit error for too large port', function (done) {
            let client = new SMTPConnection({
                port: 999999999,
                logger: false
            });

            client.connect(function () {
                // should not run
                expect(false).to.be.true;
                client.close();
            });

            client.once('error', function (err) {
                expect(err).to.exist;
            });

            client.on('end', done);
        });

        it('should emit inactivity timeout error', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER,
                socketTimeout: 100,
                logger: false
            });

            client.connect(function () {
                // do nothing
            });

            client.once('error', function (err) {
                expect(err).to.exist;
                expect(err.code).to.equal('ETIMEDOUT');
            });

            client.on('end', done);
        });

        it('should connect through proxy', function (done) {
            let runTest = function (socket) {
                let client = new SMTPConnection({
                    logger: false,
                    port: PORT_NUMBER,
                    connection: socket
                });

                client.connect(function () {
                    expect(client.secure).to.be.true;
                    client.login(
                        {
                            user: 'testuser',
                            credentials: {
                                user: 'testuser',
                                pass: 'testpass'
                            }
                        },
                        function (err) {
                            expect(err).to.not.exist;
                            expect(client.authenticated).to.be.true;
                            client.close();
                        }
                    );
                });

                client.on('error', function (err) {
                    expect(err).to.not.exist;
                });

                client.on('end', done);
            };

            proxyConnect(PROXY_PORT_NUMBER, '127.0.0.1', PORT_NUMBER, '127.0.0.1', function (err, socket) {
                expect(err).to.not.exist;
                runTest(socket);
            });
        });

        it('should connect through proxy to secure server', function (done) {
            let runTest = function (socket) {
                let client = new SMTPConnection({
                    logger: false,
                    port: PORT_NUMBER + 2,
                    secure: true,
                    connection: socket
                });

                client.connect(function () {
                    expect(client.secure).to.be.true;
                    client.login(
                        {
                            user: 'testuser',
                            credentials: {
                                user: 'testuser',
                                pass: 'testpass'
                            }
                        },
                        function (err) {
                            expect(err).to.not.exist;
                            expect(client.authenticated).to.be.true;
                            client.close();
                        }
                    );
                });

                client.on('error', function (err) {
                    expect(err).to.not.exist;
                });

                client.on('end', done);
            };

            proxyConnect(PROXY_PORT_NUMBER, '127.0.0.1', PORT_NUMBER + 2, '127.0.0.1', function (err, socket) {
                expect(err).to.not.exist;
                runTest(socket);
            });
        });

        it('should send to unsecure server', function (done) {
            let client = new SMTPConnection({
                port: PORT_NUMBER + 3,
                ignoreTLS: true,
                logger: false
            });

            client.on('error', function (err) {
                expect(err).to.not.exist;
            });

            client.connect(function () {
                expect(client.secure).to.be.false;

                let chunks = [],
                    fname = __dirname + '/../../LICENSE',
                    message = fs.readFileSync(fname, 'utf-8');

                server.on('data', function (connection, chunk) {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', function (connection, callback) {
                    let body = Buffer.concat(chunks);
                    expect(body.toString()).to.equal(message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    fs.createReadStream(fname),
                    function (err) {
                        expect(err).to.not.exist;
                        client.close();
                    }
                );
            });

            client.on('end', done);
        });
    });

    describe('Login tests', function () {
        this.timeout(10 * 1000);

        let server,
            lmtpServer,
            client,
            lmtpClient,
            testtoken = 'testtoken';

        beforeEach(function (done) {
            server = new SMTPServer({
                authMethods: ['PLAIN', 'XOAUTH2'],
                disabledCommands: ['STARTTLS'],

                size: 100 * 1024,

                onData: function (stream, session, callback) {
                    let err = false;
                    stream.on('data', function (chunk) {
                        if (err || session.use8BitMime) {
                            return;
                        }
                        for (let i = 0, len = chunk.length; i < len; i++) {
                            if (chunk[i] >= 0x80) {
                                err = new Error('8 bit content not allowed');
                            }
                        }
                    });
                    stream.on('end', function () {
                        callback(err, false);
                    });
                },

                onAuth: function (auth, session, callback) {
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
                        user: 123
                    });
                },
                onMailFrom: function (address, session, callback) {
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
                onRcptTo: function (address, session, callback) {
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

                onData: function (stream, session, callback) {
                    stream.on('data', function () {});
                    stream.on('end', function () {
                        let response = session.envelope.rcptTo.map(function (rcpt, i) {
                            if (i % 2) {
                                return '<' + rcpt.address + '> Accepted';
                            } else {
                                return new Error('<' + rcpt.address + '> Not accepted');
                            }
                        });
                        callback(null, response);
                    });
                },
                onMailFrom: function (address, session, callback) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },
                onRcptTo: function (address, session, callback) {
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

            server.listen(PORT_NUMBER, function () {
                lmtpServer.listen(LMTP_PORT_NUMBER, function () {
                    client.connect(function () {
                        lmtpClient.connect(done);
                    });
                });
            });
        });

        afterEach(function (done) {
            client.close();
            lmtpClient.close();
            server.close(function () {
                lmtpServer.close(done);
            });
        });

        it('should login', function (done) {
            expect(client.authenticated).to.be.false;
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser',
                        pass: 'testpass'
                    }
                },
                function (err) {
                    expect(err).to.not.exist;
                    expect(client.authenticated).to.be.true;
                    done();
                }
            );
        });

        it('should return error for invalid login', function (done) {
            expect(client.authenticated).to.be.false;
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser',
                        pass: 'invalid'
                    }
                },
                function (err) {
                    expect(err).to.exist;
                    expect(client.authenticated).to.be.false;
                    expect(err.code).to.equal('EAUTH');
                    expect(err.responseCode).to.equal(535);
                    done();
                }
            );
        });

        it('should return error for missing credentials', function (done) {
            expect(client.authenticated).to.be.false;
            client.login(
                {
                    user: 'testuser'
                },
                function (err) {
                    expect(err).to.exist;
                    expect(client.authenticated).to.be.false;
                    expect(err.message).to.match(/^Missing credentials/);
                    expect(err.code).to.equal('EAUTH');
                    expect(err.response).to.be.undefined;
                    done();
                }
            );
        });

        it('should return error for incomplete credentials', function (done) {
            expect(client.authenticated).to.be.false;
            client.login(
                {
                    user: 'testuser',
                    credentials: {
                        user: 'testuser'
                    }
                },
                function (err) {
                    expect(err).to.exist;
                    expect(client.authenticated).to.be.false;
                    expect(err.message).to.match(/^Missing credentials/);
                    expect(err.code).to.equal('EAUTH');
                    expect(err.response).to.be.undefined;
                    done();
                }
            );
        });

        describe('xoauth2 login', function () {
            this.timeout(10 * 1000);
            let x2server;

            beforeEach(function (done) {
                x2server = xoauth2Server({
                    port: XOAUTH_PORT,
                    onUpdate: function (username, accessToken) {
                        testtoken = accessToken;
                    }.bind(this)
                });

                x2server.addUser('testuser', 'refresh-token');

                x2server.start(done);
            });

            afterEach(function (done) {
                x2server.stop(done);
            });

            it('should login with xoauth2 string', function (done) {
                expect(client.authenticated).to.be.false;
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            accessToken: testtoken
                        })
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        expect(client.authenticated).to.be.true;
                        done();
                    }
                );
            });

            it('should return error for invalid xoauth2 string token', function (done) {
                expect(client.authenticated).to.be.false;
                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2: new XOAuth2({
                            user: 'testuser',
                            accessToken: 'invalid'
                        })
                    },
                    function (err) {
                        expect(err).to.exist;
                        expect(client.authenticated).to.be.false;
                        expect(err.code).to.equal('EAUTH');
                        done();
                    }
                );
            });

            it('should login with xoauth2 object', function (done) {
                expect(client.authenticated).to.be.false;
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
                    function (err) {
                        expect(err).to.not.exist;
                        expect(client.authenticated).to.be.true;
                        done();
                    }
                );
            });

            it('should fail with xoauth2 object', function (done) {
                expect(client.authenticated).to.be.false;
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
                    function (err) {
                        expect(err).to.exist;
                        expect(client.authenticated).to.be.false;
                        done();
                    }
                );
            });

            it('should fail with invalid xoauth2 response', function (done) {
                expect(client.authenticated).to.be.false;

                let oauth2 = new XOAuth2({
                    user: 'testuser',
                    clientId: '{Client ID}',
                    clientSecret: '{Client Secret}',
                    refreshToken: 'refrsesh-token',
                    accessToken: 'uuuuu',
                    accessUrl: 'http://localhost:' + XOAUTH_PORT
                });

                sinon.stub(oauth2, 'generateToken').yields(null, 'dXNlcj10ZXN0dXNlcgFhdXRoPUJlYXJlciB1dXV1dQEB');

                client.login(
                    {
                        type: 'oauth2',
                        user: 'testuser',
                        oauth2
                    },
                    function (err) {
                        expect(err).to.exist;
                        expect(client.authenticated).to.be.false;

                        oauth2.generateToken.restore();
                        done();
                    }
                );
            });
        });

        describe('custom login', function () {
            let customClient;
            beforeEach(function (done) {
                customClient = new SMTPConnection({
                    port: PORT_NUMBER,
                    logger: false,
                    debug: false,
                    customAuth: {
                        mytest: client => {
                            client.sendCommand('HALLO1 HALLO', (err, response) => {
                                expect(err).to.not.exist;
                                expect(response.status).to.equal(500);
                                client.sendCommand('HALLO2 HALLO', (err, response) => {
                                    expect(err).to.not.exist;
                                    expect(response.status).to.equal(500);
                                    client.resolve();
                                });
                            });
                        }
                    }
                });

                customClient.connect(done);
            });

            afterEach(function (done) {
                customClient.close();
                done();
            });

            it('should login', function (done) {
                expect(customClient.authenticated).to.be.false;
                customClient.login(
                    {
                        method: 'mytest',
                        user: 'testuser',
                        credentials: {
                            user: 'testuser',
                            pass: 'testpass'
                        }
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        expect(customClient.authenticated).to.be.true;
                        done();
                    }
                );
            });
        });

        describe('Send without PIPELINING', function () {
            beforeEach(function (done) {
                client.on('end', function () {
                    client = new SMTPConnection({
                        port: PORT_NUMBER,
                        logger: false,
                        debug: false
                    });
                    // disable PIPELINING
                    server.options.hidePIPELINING = true;
                    client.connect(function () {
                        client.login(
                            {
                                user: 'testuser',
                                credentials: {
                                    user: 'testuser',
                                    pass: 'testpass'
                                }
                            },
                            function (err) {
                                expect(err).to.not.exist;
                                // enable PIPELINING
                                server.options.hidePIPELINING = false;
                                done();
                            }
                        );
                    });
                });
                client.close();
            });

            it('should send only to valid recipients without PIPELINING', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3@valid.recipient']
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test1@valid.recipient', 'test3@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        expect(info.rejectedErrors.length).to.equal(1);
                        done();
                    }
                );
            });
        });

        describe('Send messages', function () {
            beforeEach(function (done) {
                client.login(
                    {
                        user: 'testuser',
                        credentials: {
                            user: 'testuser',
                            pass: 'testpass'
                        }
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        done();
                    }
                );
            });

            it('should send message', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test@valid.recipient'],
                            rejected: [],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('should send multiple messages', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test@valid.recipient'],
                            rejected: [],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        client.reset(function (err) {
                            expect(err).to.not.exist;

                            client.send(
                                {
                                    from: 'test2@valid.sender',
                                    to: 'test2@valid.recipient'
                                },
                                'test2',
                                function (err, info) {
                                    expect(err).to.not.exist;
                                    expect(info).to.deep.equal({
                                        accepted: ['test2@valid.recipient'],
                                        rejected: [],
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

            it('should send only to valid recipients', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3@valid.recipient']
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test1@valid.recipient', 'test3@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
                            rejectedErrors: info.rejectedErrors,
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        expect(info.rejectedErrors.length).to.equal(1);
                        done();
                    }
                );
            });

            it('should reject all recipients', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.exist;
                        expect(info).to.not.exist;
                        expect(err.rejected).to.deep.equal(['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']);
                        expect(err.rejectedErrors.length).to.equal(3);
                        done();
                    }
                );
            });

            it('should reject too large SIZE arguments', function (done) {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 1024 * 1024
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.exist;
                        expect(info).to.not.exist;
                        done();
                    }
                );
            });

            it('should reject too large message', function (done) {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 70 * 1024
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.exist;
                        expect(info).to.not.exist;
                        done();
                    }
                );
            });

            it('should declare SIZE', function (done) {
                client.send(
                    {
                        from: 'test2@valid.sender',
                        to: 'test2@valid.recipient',
                        size: 10 * 1024
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test2@valid.recipient'],
                            rejected: [],
                            envelopeTime: info.envelopeTime,
                            messageTime: info.messageTime,
                            messageSize: info.messageSize,
                            response: '250 OK: message queued'
                        });
                        done();
                    }
                );
            });

            it('lmtp should send only to valid recipients', function (done) {
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
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info.accepted).to.deep.equal(['test3@valid.recipient', 'test5@valid.recipient']);
                        expect(info.rejected).to.deep.equal([
                            'test2@invalid.recipient',
                            'test1@valid.recipient',
                            'test4@valid.recipient',
                            'test6@valid.recipient'
                        ]);
                        expect(info.rejectedErrors.length).to.equal(info.rejected.length);
                        done();
                    }
                );
            });

            it('should send using SMTPUTF8', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'test',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test1@valid.recipient', 'test3õ@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
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

            it('should send using 8BITMIME', function (done) {
                client.send(
                    {
                        use8BitMime: true,
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'õõõõ',
                    function (err, info) {
                        expect(err).to.not.exist;
                        expect(info).to.deep.equal({
                            accepted: ['test1@valid.recipient', 'test3õ@valid.recipient'],
                            rejected: ['test2@invalid.recipient'],
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

            it('should receive error for 8-bit content without 8BITMIME declaration', function (done) {
                client.send(
                    {
                        use8BitMime: false,
                        from: 'test@valid.sender',
                        to: ['test1@valid.recipient', 'test2@invalid.recipient', 'test3õ@valid.recipient']
                    },
                    'õõõõ',
                    function (err) {
                        expect(/8 bit content not allowed/.test(err.message)).to.be.true;
                        done();
                    }
                );
            });

            it('should return error for invalidly formatted recipients', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient', '"address\r\n with folding"@valid.recipient']
                    },
                    'test',
                    function (err) {
                        expect(/^Invalid recipient/.test(err.message)).to.be.true;
                        done();
                    }
                );
            });

            it('should return error for no valid recipients', function (done) {
                client.send(
                    {
                        from: 'test@valid.sender',
                        to: ['test1@invalid.recipient', 'test2@invalid.recipient', 'test3@invalid.recipient']
                    },
                    'test',
                    function (err) {
                        expect(err).to.exist;
                        done();
                    }
                );
            });

            it('should return error for invalid sender', function (done) {
                client.send(
                    {
                        from: 'test@invalid.sender',
                        to: 'test@valid.recipient'
                    },
                    'test',
                    function (err) {
                        expect(err).to.exist;
                        done();
                    }
                );
            });

            it('should send message string', function (done) {
                let chunks = [],
                    message = new Array(1024).join('teretere, vana kere\n');

                server.on('data', function (connection, chunk) {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', function (connection, callback) {
                    let body = Buffer.concat(chunks);
                    expect(body.toString()).to.equal(message.trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    message,
                    function (err) {
                        expect(err).to.not.exist;
                        done();
                    }
                );
            });

            it('should send message buffer', function (done) {
                let chunks = [],
                    message = Buffer.from(new Array(1024).join('teretere, vana kere\n'));

                server.on('data', function (connection, chunk) {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', function (connection, callback) {
                    let body = Buffer.concat(chunks);
                    expect(body.toString()).to.equal(message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    message,
                    function (err) {
                        expect(err).to.not.exist;
                        done();
                    }
                );
            });

            it('should send message stream', function (done) {
                let chunks = [],
                    fname = __dirname + '/../../LICENSE',
                    message = fs.readFileSync(fname, 'utf-8');

                server.on('data', function (connection, chunk) {
                    chunks.push(chunk);
                });

                server.removeAllListeners('dataReady');
                server.on('dataReady', function (connection, callback) {
                    let body = Buffer.concat(chunks);
                    expect(body.toString()).to.equal(message.toString().trim().replace(/\n/g, '\r\n'));
                    callback(null, 'ABC1');
                });

                client.send(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    fs.createReadStream(fname),
                    function (err) {
                        expect(err).to.not.exist;
                        done();
                    }
                );
            });
        });
    });
});

function proxyConnect(port, host, destinationPort, destinationHost, callback) {
    let socket = net.connect(port, host, function () {
        socket.write('CONNECT ' + destinationHost + ':' + destinationPort + ' HTTP/1.1\r\n\r\n');

        let headers = '';
        let onSocketData = function (chunk) {
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

    socket.on('error', function (err) {
        expect(err).to.not.exist;
    });
}
