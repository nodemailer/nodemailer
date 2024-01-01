'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const PassThrough = require('node:stream').PassThrough;
const SMTPTransport = require('../../lib/smtp-transport');
const SMTPServer = require('smtp-server').SMTPServer;

const PORT_NUMBER = 8397;
class MockBuilder {
    constructor(envelope, message, messageId) {
        this.envelope = envelope;
        this.rawMessage = message;
        this.mid = messageId || '<test>';
    }

    getEnvelope() {
        return this.envelope;
    }

    messageId() {
        return this.mid;
    }

    createReadStream() {
        let stream = new PassThrough();
        setImmediate(() => stream.end(this.rawMessage));
        return stream;
    }

    getHeader() {
        return 'teretere';
    }
}

describe('SMTP Transport Tests', { timeout: 10000 }, () => {
    describe('Anonymous sender tests', () => {
        let server, failingServer;

        beforeEach((t, done) => {
            server = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],

                onData(stream, session, callback) {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },

                onMailFrom(address, session, callback) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },

                onRcptTo(address, session, callback) {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            failingServer = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],

                onData(stream) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        setTimeout(() => {
                            this.connections.forEach(socket => socket._socket.destroy());
                        }, 150);
                    });
                },

                onMailFrom(address, session, callback) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },

                onRcptTo(address, session, callback) {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            server.listen(PORT_NUMBER, err => {
                if (err) {
                    return done(err);
                }
                failingServer.listen(PORT_NUMBER + 1, done);
            });
        });

        afterEach((t, done) => {
            server.close(() => failingServer.close(done));
        });

        it('Should expose version number', () => {
            let client = new SMTPTransport();
            assert.ok(client.name);
            assert.ok(client.version);
        });

        it('Should detect wellknown data', () => {
            let client = new SMTPTransport({
                service: 'google mail',
                logger: false
            });
            assert.strictEqual(client.options.host, 'smtp.gmail.com');
            assert.strictEqual(client.options.port, 465);
            assert.strictEqual(client.options.secure, true);
        });

        it('Should fail envelope', (t, done) => {
            let client = new SMTPTransport({
                port: PORT_NUMBER,
                logger: false
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@invalid.sender',
                            to: 'test@valid.recipient'
                        },
                        'test'
                    )
                },
                err => {
                    assert.strictEqual(err.code, 'EENVELOPE');
                    done();
                }
            );
        });

        it('Should not fail auth', (t, done) => {
            let client = new SMTPTransport({
                port: PORT_NUMBER,
                auth: {
                    user: 'zzz'
                },
                logger: false
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        'message'
                    )
                },
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });

        it('Should fail auth if forceAuth=true', (t, done) => {
            let client = new SMTPTransport({
                port: PORT_NUMBER,
                auth: {
                    user: 'zzz'
                },
                forceAuth: true,
                logger: false
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        'message'
                    )
                },
                err => {
                    assert.strictEqual(err.code, 'EAUTH');
                    done();
                }
            );
        });

        it('Should send mail', (t, done) => {
            let client = new SMTPTransport('smtp:localhost:' + PORT_NUMBER + '?logger=false');
            let chunks = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection, chunk) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection, callback) => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n'));
                callback(null, true);
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        message
                    )
                },
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });

        it('Should recover unexpeced close during transmission', (t, done) => {
            let client = new SMTPTransport('smtp:localhost:' + (PORT_NUMBER + 1) + '?logger=false');
            let chunks = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection, chunk) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection, callback) => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n'));
                callback(null, true);
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        message
                    )
                },
                err => {
                    assert.ok(err);
                    done();
                }
            );
        });

        it('Should verify connection without credentials with success', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp://localhost:' + PORT_NUMBER,
                forceAuth: true,
                logger: false
            });

            client.verify((err, success) => {
                assert.ok(!err);
                assert.strictEqual(success, true);
                done();
            });
        });
    });

    describe('Authenticated sender tests', () => {
        let server;

        beforeEach((t, done) => {
            server = new SMTPServer({
                authMethods: ['PLAIN', 'XOAUTH2'],
                disabledCommands: ['STARTTLS'],

                onData(stream, session, callback) {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },

                onAuth(auth, session, callback) {
                    if (auth.method !== 'XOAUTH2') {
                        if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                            return callback(new Error('Invalid username or password'));
                        }
                    } else if (auth.username !== 'testuser' || auth.accessToken !== 'testtoken') {
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
                onMailFrom(address, session, callback) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },
                onRcptTo(address, session, callback) {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            server.listen(PORT_NUMBER, done);
        });

        afterEach((t, done) => {
            server.close(done);
        });

        it('Should login and send mail', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp:testuser:testpass@localhost:' + PORT_NUMBER,
                logger: false
            });
            let chunks = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection, chunk) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection, callback) => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n'));
                callback(null, true);
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        message
                    )
                },
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });

        it('Should verify connection with success', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp:testuser:testpass@localhost:' + PORT_NUMBER,
                logger: false
            });

            client.verify((err, success) => {
                assert.ok(!err);
                assert.strictEqual(success, true);
                done();
            });
        });

        it('Should verify connection without credentials with success', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp://localhost:' + PORT_NUMBER,
                logger: false
            });

            client.verify((err, success) => {
                assert.ok(!err);
                assert.strictEqual(success, true);
                done();
            });
        });

        it('Should not verify connection without credentials', (t, done) => {
            let client = new SMTPTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                forceAuth: true,
                logger: false
            });

            client.verify(err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'NoAuth');
                done();
            });
        });

        it('Should not verify connection', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp:testuser:testpass@localhost:999' + PORT_NUMBER,
                logger: false
            });

            client.verify(err => {
                assert.ok(err);
                done();
            });
        });

        it('Should login and send mail using proxied socket', (t, done) => {
            let client = new SMTPTransport({
                url: 'smtp:testuser:testpass@www.example.com:1234',
                logger: false,
                getSocket(options, callback) {
                    let socket = net.connect(PORT_NUMBER, 'localhost');
                    let errHandler = err => {
                        callback(err);
                    };
                    socket.on('error', errHandler);
                    socket.on('connect', () => {
                        socket.removeListener('error', errHandler);
                        callback(null, {
                            connection: socket
                        });
                    });
                }
            });
            let chunks = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection, chunk) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection, callback) => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n'));
                callback(null, true);
            });

            client.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        message
                    )
                },
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });
    });
});
