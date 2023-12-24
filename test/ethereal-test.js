'use strict';

const nodemailer = require('../lib/nodemailer');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Ethereal Tests', { timeout: 50 * 1000 }, () => {
    it('should create an account and send a message', (t, done) => {
        // Generate SMTP service account from ethereal.email
        nodemailer.createTestAccount((err, account) => {
            assert.ok(!err);
            assert.ok(account.user);

            let transporter = nodemailer.createTransport({
                host: account.smtp.host,
                port: account.smtp.port,
                secure: account.smtp.secure,
                auth: {
                    user: account.user,
                    pass: account.pass
                }
            });

            // Message object
            let message = {
                from: 'Pangalink <no-reply@pangalink.net>',
                to: 'Andris Reinman <andris.reinman@gmail.com>',
                subject: 'Ethereal unit test message',
                text: 'Hello world',
                html: '<p>Hello world</p>'
            };

            transporter.sendMail(message, (err, info) => {
                assert.ok(!err);
                assert.ok(nodemailer.getTestMessageUrl(info).includes('ethereal'));
                done();
            });
        });
    });

    it('should cache a created test account', (t, done) => {
        nodemailer.createTestAccount((err, account) => {
            assert.ok(!err);
            nodemailer.createTestAccount((err, account2) => {
                assert.ok(!err);
                assert.strictEqual(account2, account);
                done();
            });
        });
    });

    it('should cache a created test account when using promises', (t, done) => {
        nodemailer.createTestAccount().then(account => {
            nodemailer.createTestAccount().then(account2 => {
                assert.strictEqual(account2, account);
                done();
            });
        });
    });
});
