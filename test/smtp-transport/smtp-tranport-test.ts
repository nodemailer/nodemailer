process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import SMTPTransport from '../../src/smtp-transport/index.js';
import { SMTPServer } from 'smtp-server';

const PORT_NUMBER = 8397;
class MockBuilder {
    envelope: { from: string; to: string };
    rawMessage: string;
    mid: string;

    constructor(envelope: { from: string; to: string }, message: string, messageId?: string) {
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
        let server: any, failingServer: any;

        beforeEach((t, done) => {
            server = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],

                onData(stream: any, session: any, callback: any) {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },

                onMailFrom(address: any, session: any, callback: any) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },

                onRcptTo(address: any, session: any, callback: any) {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            failingServer = new SMTPServer({
                disabledCommands: ['STARTTLS', 'AUTH'],

                onData(this: any, stream: any) {
                    stream.on('data', () => false);
                    stream.on('end', () => {
                        setTimeout(() => {
                            this.connections.forEach((socket: any) => socket._socket.destroy());
                        }, 150);
                    });
                },

                onMailFrom(address: any, session: any, callback: any) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },

                onRcptTo(address: any, session: any, callback: any) {
                    if (!/@valid.recipient/.test(address.address)) {
                        return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                    }
                    return callback(); // Accept the address
                },
                logger: false
            });

            server.listen(PORT_NUMBER, (err: any) => {
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
                } as any,
                (err: any) => {
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
                } as any,
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
                } as any,
                (err: any) => {
                    assert.strictEqual(err.code, 'EAUTH');
                    done();
                }
            );
        });

        it('Should send mail', (t, done) => {
            let client = new SMTPTransport('smtp:localhost:' + PORT_NUMBER + '?logger=false');
            let chunks: Buffer[] = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection: any, chunk: Buffer) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection: any, callback: any) => {
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
                } as any,
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });

        it('Should recover unexpeced close during transmission', (t, done) => {
            let client = new SMTPTransport('smtp:localhost:' + (PORT_NUMBER + 1) + '?logger=false');
            let chunks: Buffer[] = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection: any, chunk: Buffer) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection: any, callback: any) => {
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
                } as any,
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
        let server: any;

        beforeEach((t, done) => {
            server = new SMTPServer({
                authMethods: ['PLAIN', 'XOAUTH2'],
                disabledCommands: ['STARTTLS'],

                onData(stream: any, session: any, callback: any) {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },

                onAuth(auth: any, session: any, callback: any) {
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
                onMailFrom(address: any, session: any, callback: any) {
                    if (!/@valid.sender/.test(address.address)) {
                        return callback(new Error('Only user@valid.sender is allowed to send mail'));
                    }
                    return callback(); // Accept the address
                },
                onRcptTo(address: any, session: any, callback: any) {
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
            let chunks: Buffer[] = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection: any, chunk: Buffer) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection: any, callback: any) => {
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
                } as any,
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

            client.verify((err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ENOAUTH');
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
                    let errHandler = (err: Error) => {
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
            let chunks: Buffer[] = [],
                message = new Array(1024).join('teretere, vana kere\n');

            server.on('data', (connection: any, chunk: Buffer) => {
                chunks.push(chunk);
            });

            server.on('dataReady', (connection: any, callback: any) => {
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
                } as any,
                err => {
                    assert.ok(!err);
                    done();
                }
            );
        });
    });
});
