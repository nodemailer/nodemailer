'use strict';

/**
 * RFC 8689 REQUIRETLS Tests
 *
 * Tests for the SMTP REQUIRETLS extension support in nodemailer.
 * https://www.rfc-editor.org/rfc/rfc8689.html
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const SMTPConnection = require('../../lib/smtp-connection');
const SMTPServer = require('smtp-server').SMTPServer;

const PORT_NUMBER = 8497;

describe('RFC 8689 REQUIRETLS Tests', () => {
    describe('REQUIRETLS Extension Detection', () => {
        let serverWithRequireTLS, serverWithoutRequireTLS;

        before((t, done) => {
            // Server that advertises REQUIRETLS
            serverWithRequireTLS = new SMTPServer({
                secure: true,
                hideREQUIRETLS: false, // Advertise REQUIRETLS
                authOptional: true,
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },
                logger: false
            });

            // Server that does NOT advertise REQUIRETLS
            serverWithoutRequireTLS = new SMTPServer({
                secure: true,
                hideREQUIRETLS: true, // Do not advertise REQUIRETLS (default)
                authOptional: true,
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },
                logger: false
            });

            serverWithRequireTLS.listen(PORT_NUMBER, () => {
                serverWithoutRequireTLS.listen(PORT_NUMBER + 1, done);
            });
        });

        after((t, done) => {
            serverWithRequireTLS.close(() => {
                serverWithoutRequireTLS.close(done);
            });
        });

        it('should detect REQUIRETLS support in EHLO response', (t, done) => {
            const client = new SMTPConnection({
                port: PORT_NUMBER,
                secure: true,
                logger: false
            });

            client.connect(() => {
                assert.ok(
                    client._supportedExtensions.includes('REQUIRETLS'),
                    'REQUIRETLS should be in supported extensions'
                );
                client.close();
            });

            client.on('error', err => {
                assert.fail('Should not error: ' + err.message);
            });

            client.on('end', done);
        });

        it('should not detect REQUIRETLS when server does not advertise it', (t, done) => {
            const client = new SMTPConnection({
                port: PORT_NUMBER + 1,
                secure: true,
                logger: false
            });

            client.connect(() => {
                assert.ok(
                    !client._supportedExtensions.includes('REQUIRETLS'),
                    'REQUIRETLS should NOT be in supported extensions'
                );
                client.close();
            });

            client.on('error', err => {
                assert.fail('Should not error: ' + err.message);
            });

            client.on('end', done);
        });
    });

    describe('REQUIRETLS MAIL FROM Parameter', () => {
        let server;
        let lastMailFromArgs = null;
        let lastEnvelopeRequireTLS = null;

        before((t, done) => {
            server = new SMTPServer({
                secure: true,
                hideREQUIRETLS: false,
                authOptional: true,
                onMailFrom: (address, session, callback) => {
                    lastMailFromArgs = address.args;
                    lastEnvelopeRequireTLS = session.envelope.requireTLS;
                    callback();
                },
                onRcptTo: (address, session, callback) => {
                    callback();
                },
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },
                logger: false
            });

            server.listen(PORT_NUMBER + 2, done);
        });

        after((t, done) => {
            server.close(done);
        });

        it('should send REQUIRETLS parameter when envelope.requireTLS is true', (t, done) => {
            lastMailFromArgs = null;
            lastEnvelopeRequireTLS = null;

            const client = new SMTPConnection({
                port: PORT_NUMBER + 2,
                secure: true,
                logger: false
            });

            client.connect(() => {
                client.send(
                    {
                        from: 'sender@example.com',
                        to: ['recipient@example.com'],
                        requireTLS: true
                    },
                    'Subject: Test\r\n\r\nTest message',
                    (err, info) => {
                        assert.ok(!err, 'Should not error');
                        assert.strictEqual(lastMailFromArgs.REQUIRETLS, true, 'REQUIRETLS should be in MAIL FROM args');
                        assert.strictEqual(lastEnvelopeRequireTLS, true, 'session.envelope.requireTLS should be true');
                        client.close();
                    }
                );
            });

            client.on('error', err => {
                assert.fail('Should not error: ' + err.message);
            });

            client.on('end', done);
        });

        it('should NOT send REQUIRETLS parameter when envelope.requireTLS is false/undefined', (t, done) => {
            lastMailFromArgs = null;
            lastEnvelopeRequireTLS = null;

            const client = new SMTPConnection({
                port: PORT_NUMBER + 2,
                secure: true,
                logger: false
            });

            client.connect(() => {
                client.send(
                    {
                        from: 'sender@example.com',
                        to: ['recipient@example.com']
                        // No requireTLS
                    },
                    'Subject: Test\r\n\r\nTest message',
                    (err, info) => {
                        assert.ok(!err, 'Should not error');
                        assert.strictEqual(lastMailFromArgs.REQUIRETLS, undefined, 'REQUIRETLS should NOT be in MAIL FROM args');
                        assert.strictEqual(lastEnvelopeRequireTLS, false, 'session.envelope.requireTLS should be false');
                        client.close();
                    }
                );
            });

            client.on('error', err => {
                assert.fail('Should not error: ' + err.message);
            });

            client.on('end', done);
        });
    });

    describe('REQUIRETLS with DSN parameters', () => {
        let server;
        let lastMailFromArgs = null;

        before((t, done) => {
            server = new SMTPServer({
                secure: true,
                hideREQUIRETLS: false,
                authOptional: true,
                onMailFrom: (address, session, callback) => {
                    lastMailFromArgs = address.args;
                    callback();
                },
                onRcptTo: (address, session, callback) => {
                    callback();
                },
                onData: (stream, session, callback) => {
                    stream.on('data', () => {});
                    stream.on('end', callback);
                },
                logger: false
            });

            server.listen(PORT_NUMBER + 4, done);
        });

        after((t, done) => {
            server.close(done);
        });

        it('should send REQUIRETLS along with DSN parameters', (t, done) => {
            lastMailFromArgs = null;

            const client = new SMTPConnection({
                port: PORT_NUMBER + 4,
                secure: true,
                logger: false
            });

            client.connect(() => {
                client.send(
                    {
                        from: 'sender@example.com',
                        to: ['recipient@example.com'],
                        requireTLS: true,
                        dsn: {
                            ret: 'HDRS',
                            envid: 'test-envelope-id'
                        }
                    },
                    'Subject: Test\r\n\r\nTest message',
                    (err, info) => {
                        assert.ok(!err, 'Should not error');
                        assert.strictEqual(lastMailFromArgs.REQUIRETLS, true, 'REQUIRETLS should be present');
                        // Note: DSN params may or may not be present depending on server config
                        client.close();
                    }
                );
            });

            client.on('error', err => {
                assert.fail('Should not error: ' + err.message);
            });

            client.on('end', done);
        });
    });
});
