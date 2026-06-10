'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('../../lib/nodemailer');
const SMTPServer = require('smtp-server').SMTPServer;

// Regression tests: the transport-level auth object is resolved in the SMTPTransport
// constructor, before Mail assigns `transporter.mailer`, so a provision callback
// registered with `transporter.set('oauth2_provision_cb', ...)` was never picked up
// for non-pooled sendMail() calls without a per-message `auth` value.
describe('SMTP transport OAuth2 provision callback', { timeout: 10000 }, () => {
    let server;

    beforeEach((t, done) => {
        server = new SMTPServer({
            authMethods: ['XOAUTH2'],
            disabledCommands: ['STARTTLS'],

            onData(stream, session, callback) {
                stream.on('data', () => {});
                stream.on('end', callback);
            },

            onAuth(auth, session, callback) {
                if (auth.method !== 'XOAUTH2' || auth.username !== 'user@example.com' || auth.accessToken !== 'provisioned-token') {
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
            logger: false
        });

        server.listen(0, done);
    });

    afterEach((t, done) => {
        server.close(done);
    });

    it('should use oauth2_provision_cb for non-pooled sendMail without per-message auth', (t, done) => {
        let provisionCount = 0;

        const transporter = nodemailer.createTransport({
            host: 'localhost',
            port: server.server.address().port,
            ignoreTLS: true,
            auth: {
                type: 'OAuth2',
                user: 'user@example.com'
            },
            logger: false
        });

        transporter.set('oauth2_provision_cb', (user, renew, callback) => {
            provisionCount++;
            assert.strictEqual(user, 'user@example.com');
            callback(null, 'provisioned-token');
        });

        const mailData = {
            from: 'sender@example.com',
            to: 'recipient@example.com',
            subject: 'test',
            text: 'test'
        };

        transporter.sendMail(mailData, err => {
            try {
                assert.ok(!err, err && err.message);
                assert.strictEqual(provisionCount, 1);
            } catch (E) {
                return done(E);
            }

            // a second message must reuse the cached access token instead of provisioning again
            transporter.sendMail(mailData, err => {
                try {
                    assert.ok(!err, err && err.message);
                    assert.strictEqual(provisionCount, 1);
                } catch (E) {
                    return done(E);
                }
                done();
            });
        });
    });

    it('should fail with EAUTH when no provision callback is registered', (t, done) => {
        const transporter = nodemailer.createTransport({
            host: 'localhost',
            port: server.server.address().port,
            ignoreTLS: true,
            auth: {
                type: 'OAuth2',
                user: 'user@example.com'
            },
            logger: false
        });

        transporter.sendMail(
            {
                from: 'sender@example.com',
                to: 'recipient@example.com',
                subject: 'test',
                text: 'test'
            },
            err => {
                try {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EAUTH');
                } catch (E) {
                    return done(E);
                }
                done();
            }
        );
    });
});
