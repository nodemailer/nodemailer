/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const nodemailer = require('../lib/nodemailer');
const chai = require('chai');
const expect = chai.expect;
chai.config.includeStack = true;

describe('Ethereal Tests', function () {
    this.timeout(50 * 1000); // eslint-disable-line no-invalid-this
    it('should create an account and send a message', function (done) {
        // Generate SMTP service account from ethereal.email
        nodemailer.createTestAccount((err, account) => {
            expect(err).to.not.exist;
            expect(account.user).to.exist;

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
                expect(err).to.not.exist;
                expect(nodemailer.getTestMessageUrl(info)).to.include('ethereal');
                done();
            });
        });
    });

    it('should cache a created test account', function (done) {
        nodemailer.createTestAccount((err, account) => {
            expect(err).to.not.exist;
            nodemailer.createTestAccount((err, account2) => {
                expect(err).to.not.exist;
                expect(account2).to.equal(account);
                done();
            });
        });
    });

    it('should cache a created test account when using promises', function (done) {
        nodemailer.createTestAccount().then(account => {
            nodemailer.createTestAccount().then(account2 => {
                expect(account2).to.equal(account);
                done();
            });
        });
    });
});
