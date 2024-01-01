'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const PassThrough = require('node:stream').PassThrough;
const SMTPPool = require('../../lib/smtp-pool');
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

describe('SMTP Pool Tests', () => {
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

                if (!/timeout/.test(address.address)) {
                    return callback(); // Accept the address
                }
            },
            logger: false
        })

        server.listen(PORT_NUMBER, done);
    });

    afterEach((t, done) => {
        server.close(() => {
            process.nextTick(() => done());
        });
    });

    it('Should expose version number', () => {
        let pool = new SMTPPool();
        assert.ok(pool.name);
        assert.ok(pool.version);
    });

    it('Should detect wellknown data', () => {
        let pool = new SMTPPool({
            service: 'google mail'
        });
        assert.strictEqual(pool.options.host, 'smtp.gmail.com');
        assert.strictEqual(pool.options.port, 465);
        assert.strictEqual(pool.options.secure, true);
    });

    it('should send mail', (t, done) => {
        let pool = new SMTPPool({
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            logger: false,
            debug: true
        });

        let message = new Array(1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        pool.send(
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
            (err) => {
                assert.ok(!err);
                pool.close();
                done();
            }
        );
    });

    it('should send multiple mails', (t, done) => {
        let pool = new SMTPPool('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?logger=false');
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                (err) => {
                    assert.ok(!err);
                    callback();
                }
            );
        }

        let total = 100;
        let returned = 0;
        let cb = () => {
            let sent = 0;

            if (++returned === total) {
                assert.ok(pool._connections.length > 1);
                pool._connections.forEach(conn => {
                    assert.ok(conn.messages > 1);
                    sent += conn.messages;
                });

                assert.strictEqual(sent, total);

                pool.close();
                return done();
            }
        };
        for (let i = 0; i < total; i++) {
            sendMessage(cb);
        }
    });

    it('should tolerate connection errors', (t, done) => {
        let pool = new SMTPPool({
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            logger: false
        });
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        let c = 0;

        function sendMessage(callback) {
            let isErr = c++ % 2; // fail 50% of messages
            pool.send(
                {
                    data: {},
                    message: new MockBuilder(
                        {
                            from: isErr ? 'test@invalid.sender' : 'test@valid.sender',
                            to: 'test@valid.recipient'
                        },
                        message
                    )
                },
                (err) => {
                    if (isErr) {
                        assert.ok(err);
                    } else {
                        assert.ok(!err);
                    }

                    callback();
                }
            );
        }

        let total = 100;
        let returned = 0;
        let cb = () => {
            if (++returned === total) {
                pool.close();
                return done();
            }
        };
        for (let i = 0; i < total; i++) {
            sendMessage(cb);
        }
    });

    it('should tolerate idle connections and re-assign messages to other connections', (t, done) => {
        let pool = new SMTPPool({
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            logger: false
        });

        let total = 20;
        let message = new Array(10 * 1024).join('teretere, vana kere\n');
        let sentMessages = 0;
        let killedConnections = false;

        server.onData = function (stream, session, callback) {
            let callCallback = true;

            stream.on('data', () => {
                // If we hit half the messages, simulate the server closing connections
                // that are open for long time
                if (!killedConnections && sentMessages === total / 2) {
                    killedConnections = true;
                    callCallback = false;
                    server.connections.forEach(connection => {
                        connection._socket.end();
                    });
                }
            });

            stream.on('end', () => {
                if (callCallback) {
                    sentMessages += 1;
                    return callback();
                }
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                (err) => {
                    if (err) {
                        assert.strictEqual(err.message, 'Connection closed unexpectedly');
                    }
                    callback();
                }
            );
        }

        // Send 10 messages in a row.. then wait a bit and send 10 more
        // When we wait a bit.. the server will kill the "idle" connections
        // so that we can ensure the pool will handle it properly
        let returned = 0;
        let cb = () => {
            returned++;

            if (returned === total) {
                pool.close();
                return done();
            } else if (returned === total / 2) {
                setTimeout(sendHalfBulk, 1500);
            }
        };

        function sendHalfBulk() {
            for (let i = 0; i < total / 2; i++) {
                sendMessage(cb);
            }
        }

        sendHalfBulk();
    });

    it('should call back with connection errors to senders having messages in flight', (t, done) => {
        let pool = new SMTPPool({
            maxConnections: 1,
            socketTimeout: 200,
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            logger: false
        });
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        pool.send(
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
            (err) => {
                assert.ok(!err);
            }
        );

        pool.send(
            {
                data: {},
                message: new MockBuilder(
                    {
                        from: 'test@valid.sender',
                        to: 'test+timeout@valid.recipient'
                    },
                    message
                )
            },
            (err) => {
                assert.ok(err);
                pool.close();
                done();
            }
        );
    });

    it('should not send more then allowed for one connection', (t, done) => {
        let pool = new SMTPPool('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?maxConnections=1&maxMessages=5&logger=false');
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                (err) => {
                    assert.ok(!err);
                    callback();
                }
            );
        }

        let total = 100;
        let returned = 0;
        let cb = () => {
            if (++returned === total) {
                assert.strictEqual(pool._connections.length, 1);
                assert.ok(pool._connections[0].messages < 6);
                pool.close();
                return done();
            }
        };
        for (let i = 0; i < total; i++) {
            sendMessage(cb);
        }
    });

    it('should send multiple mails with rate limit', (t, done) => {
        let pool = new SMTPPool({
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            maxConnections: 10,
            rateLimit: 200, // 200 messages in sec, so sending 5000 messages should take at least 24 seconds and probably under 25 sec
            logger: false
        });
        let message = 'teretere, vana kere\n';
        let startTime = Date.now();

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                (err) => {
                    assert.ok(!err);
                    callback();
                }
            );
        }

        let total = 5000;
        let returned = 0;
        let cb = () => {
            if (++returned === total) {
                let endTime = Date.now();
                assert.ok(endTime - startTime >= 24000);

                pool.close();
                return done();
            }
        };

        let i = 0;
        let send = () => {
            if (i++ >= total) {
                return;
            }
            sendMessage(cb);
            setImmediate(send);
        };

        send();
    });

    it('should return pending messages once closed', (t, done) => {
        let pool = new SMTPPool('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?maxConnections=1&logger=false');
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                (err) => {
                    assert.ok(err);
                    callback();
                }
            );
        }

        let total = 100;
        let returned = 0;
        let cb = () => {
            if (++returned === total) {
                return done();
            }
        };
        for (let i = 0; i < total; i++) {
            sendMessage(cb);
        }
        pool.close();
    });

    it('should emit idle for free slots in the pool', (t, done) => {
        let pool = new SMTPPool('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?logger=false');
        let message = new Array(10 * 1024).join('teretere, vana kere\n');

        server.onData = function (stream, session, callback) {
            let chunks = [];
            stream.on('data', chunk => {
                chunks.push(chunk);
            });
            stream.on('end', () => {
                let body = Buffer.concat(chunks);
                assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
                callback();
            });
        };

        function sendMessage(callback) {
            pool.send(
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
                callback
            );
        }

        let total = 100;
        let returned = 0;
        let cb = () => {
            if (++returned === total) {
                pool.close();
                return done();
            }
        };

        let i = 0;
        pool.on('idle', () => {
            setTimeout(() => {
                while (i < total && pool.isIdle()) {
                    i++;
                    sendMessage(cb);
                }
                if (i > 50) {
                    // kill all connections. We should still end up with the same amount of callbacks
                    setImmediate(() => {
                        for (let j = 5 - 1; j >= 0; j--) {
                            if (pool._connections[j] && pool._connections[j].connection) {
                                pool._connections[j].connection._socket.emit('error', new Error('TESTERROR'));
                            }
                        }
                    });
                }
            }, 1000);
        });
    });

    it('Should login and send mail using proxied socket', (t, done) => {
        let pool = new SMTPPool({
            url: 'smtp:testuser:testpass@www.example.com:1234',
            logger: false,
            getSocket(options, callback) {
                let socket = net.connect(PORT_NUMBER, 'localhost');
                let errHandler = (err) => {
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
            assert.strictEqual(body.toString(), message.trim().replace(/\n/g, '\r\n') + '\r\n');
            callback(null, true);
        });

        pool.send(
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
            (err) => {
                assert.ok(!err);
                pool.close();
                return done();
            }
        );
    });

    it('Should verify connection with success', (t, done) => {
        let client = new SMTPPool({
            url: 'smtp:testuser:testpass@localhost:' + PORT_NUMBER,
            logger: false
        });

        client.verify((err, success) => {
            assert.ok(!err);
            assert.strictEqual(success, true);
            client.close();
            done();
        });
    });

    it('Should not verify connection', (t, done) => {
        let client = new SMTPPool({
            url: 'smtp:testuser:testpass@localhost:999' + PORT_NUMBER,
            logger: false
        });

        client.verify((err) => {
            assert.ok(err);
            client.close();
            done();
        });
    });
});
