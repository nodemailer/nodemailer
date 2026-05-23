'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const PassThrough = require('node:stream').PassThrough;
const SMTPTransport = require('../../lib/smtp-transport');

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
        const stream = new PassThrough();
        setImmediate(() => stream.end(this.rawMessage));
        return stream;
    }
    getHeader() {
        return 'teretere';
    }
}

// Server that advertises XOAUTH2, then forcibly destroys the socket on AUTH
// to fire connection 'end'/'error' before login()'s callback can run.
function startDropDuringAuthServer(callback) {
    const server = net.createServer(socket => {
        socket.setEncoding('utf8');
        let buf = '';
        let greeted = false;
        socket.write('220 mock.test ESMTP\r\n');
        socket.on('data', chunk => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\r\n')) !== -1) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                if (!greeted && /^EHLO/i.test(line)) {
                    greeted = true;
                    socket.write('250-mock.test\r\n250-AUTH XOAUTH2\r\n250 HELP\r\n');
                } else if (/^AUTH XOAUTH2/i.test(line)) {
                    // Drop the connection mid-AUTH without replying.
                    socket.destroy();
                    return;
                } else {
                    socket.write('250 OK\r\n');
                }
            }
        });
        socket.on('error', () => {});
    });
    server.listen(0, () => callback(server, server.address().port));
}

describe('SMTP Transport OAuth2 listener leak', { timeout: 10000 }, () => {
    it('cleans up per-call OAuth2 listeners when connection drops during AUTH', (t, done) => {
        startDropDuringAuthServer((server, port) => {
            const transport = new SMTPTransport({
                host: '127.0.0.1',
                port,
                ignoreTLS: true,
                logger: false
            });

            // Capture the per-call auth object getAuth() builds so we can
            // assert listener counts after send() returns.
            let capturedAuth;
            const originalGetAuth = transport.getAuth.bind(transport);
            transport.getAuth = function (authOpts) {
                const result = originalGetAuth(authOpts);
                if (result && result.type === 'OAUTH2') {
                    capturedAuth = result;
                }
                return result;
            };

            transport.send(
                {
                    data: {
                        auth: {
                            type: 'OAuth2',
                            user: 'user@example.com',
                            accessToken: 'leak-test-token'
                        }
                    },
                    message: new MockBuilder(
                        {
                            from: 'from@example.com',
                            to: 'to@example.com'
                        },
                        'irrelevant'
                    )
                },
                err => {
                    // Error is expected — the server drops the connection.
                    assert.ok(err);
                    assert.ok(capturedAuth, 'per-call OAuth2 instance should have been built');
                    assert.notStrictEqual(capturedAuth, transport.auth, 'per-call auth must differ from transport.auth');
                    assert.strictEqual(capturedAuth.oauth2.listenerCount('token'), 0, "'token' listener should have been removed");
                    assert.strictEqual(capturedAuth.oauth2.listenerCount('error'), 0, "'error' listener should have been removed");
                    server.close(() => done());
                }
            );
        });
    });
});
