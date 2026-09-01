'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const MailMessage = require('../../lib/mailer/mail-message');
const nodemailer = require('../../lib/nodemailer');

describe('MailMessage Tests', () => {
    describe('constructor', () => {
        it('should copy message data', () => {
            const mailer = { options: {}, _defaults: {} };
            const message = new MailMessage(mailer, {
                from: 'sender@example.com',
                to: 'rcpt@example.com'
            });

            assert.strictEqual(message.data.from, 'sender@example.com');
            assert.strictEqual(message.data.to, 'rcpt@example.com');
        });

        it('should not mutate the prototype chain of message data', () => {
            const mailer = { options: {}, _defaults: {} };
            // an own "__proto__" key (e.g. from JSON.parse) must not become the prototype of data
            const message = new MailMessage(mailer, JSON.parse('{"__proto__":{"from":"attacker@example.com"}}'));

            assert.strictEqual(Object.getPrototypeOf(message.data), Object.prototype);
            assert.strictEqual(message.data.from, undefined);
        });

        it('should still apply transporter defaults for unset keys', () => {
            const mailer = {
                options: {},
                _defaults: {
                    from: 'default@example.com'
                }
            };
            const message = new MailMessage(mailer, JSON.parse('{"__proto__":{"from":"attacker@example.com"}}'));

            assert.strictEqual(message.data.from, 'default@example.com');
        });

        it('should not let an own __proto__ key of the defaults mutate the prototype chain', () => {
            // _defaults is caller supplied too, it is the second argument of createTransport
            // and is commonly read out of a config file with JSON.parse
            const mailer = { options: {}, _defaults: JSON.parse('{"__proto__":{"from":"attacker@example.com"}}') };
            const message = new MailMessage(mailer, { to: 'rcpt@example.com' });

            assert.strictEqual(Object.getPrototypeOf(message.data), Object.prototype);
            assert.strictEqual(message.data.from, undefined);
            assert.strictEqual({}.from, undefined);
        });

        it('should apply a default that shares a name with an Object member', () => {
            // "key in this.data" also matched every member of Object.prototype, so a default
            // named toString or constructor was dropped with no error
            const mailer = { options: {}, _defaults: { from: 'default@example.com', constructor: 'x', toString: 'y' } };
            const message = new MailMessage(mailer, {});

            assert.strictEqual(message.data.from, 'default@example.com');
            assert.strictEqual(message.data.constructor, 'x');
            assert.strictEqual(message.data.toString, 'y');
        });

        it('should not let an own __proto__ key of an attachment reach the resolved node', (t, done) => {
            const mailer = { options: {}, _defaults: {} };
            const message = new MailMessage(mailer, {
                attachments: [JSON.parse('{"filename":"f.txt","content":"x","cid":"a","__proto__":{"path":"/etc/passwd"}}')]
            });

            message.resolveAll((err, data) => {
                assert.ok(!err);
                const node = data.attachments[0];
                assert.strictEqual(Object.getPrototypeOf(node), Object.prototype);
                assert.strictEqual(node.path, undefined);
                // the caller's own keys still come across
                assert.strictEqual(node.filename, 'f.txt');
                assert.strictEqual(node.cid, 'a');
                // a key shared with an Object.prototype member stays out of the node, it
                // would only break the first thing that stringifies it
                assert.strictEqual(typeof node.toString, 'function');
                done();
            });
        });

        it('should not let message data be overridden by a default', () => {
            const mailer = { options: {}, _defaults: { from: 'default@example.com', headers: { 'x-a': '1', 'x-b': '2' } } };
            const message = new MailMessage(mailer, { from: 'set@example.com', headers: { 'x-a': 'own' } });

            assert.strictEqual(message.data.from, 'set@example.com');
            assert.deepStrictEqual(message.data.headers, { 'x-a': 'own', 'x-b': '2' });
        });
    });

    describe('resolveContent', () => {
        // the transporter level access policy lives on the message, not on the call
        const sandboxed = data => new MailMessage({ options: { disableFileAccess: true, disableUrlAccess: true }, _defaults: {} }, data);
        const open = data => new MailMessage({ options: {}, _defaults: {} }, data);

        it('should reject a file path for the legacy callback signature', (t, done) => {
            const message = sandboxed({ html: { path: __filename } });

            message.resolveContent(message.data, 'html', err => {
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            });
        });

        it('should reject an url for the legacy callback signature', (t, done) => {
            const message = sandboxed({ attachments: [{ filename: 'x.bin', href: 'http://127.0.0.1:1/poc' }] });

            message.resolveContent(message.data.attachments, 0, err => {
                assert.strictEqual(err.code, 'EURLACCESS');
                done();
            });
        });

        it('should apply the policy for the full (data, key, options, callback) signature', (t, done) => {
            // a path that looks like an url resolves through the url branch, so the merged
            // disableUrlAccess has to reach it from an explicit options object too
            const message = sandboxed({ html: { path: 'http://127.0.0.1:1/poc' } });

            message.resolveContent(message.data, 'html', {}, err => {
                assert.strictEqual(err.code, 'EURLACCESS');
                done();
            });
        });

        it('should reject a file path for the promise signature', async () => {
            const message = sandboxed({ html: { path: __filename } });

            await assert.rejects(message.resolveContent(message.data, 'html'), { code: 'EFILEACCESS' });
        });

        it('should let explicit options tighten the policy', async () => {
            const message = open({ html: { path: __filename } });

            await assert.rejects(message.resolveContent(message.data, 'html', { disableFileAccess: true }), { code: 'EFILEACCESS' });
        });

        it('should not let explicit options reopen the policy', async () => {
            const message = sandboxed({ html: { path: __filename } });

            await assert.rejects(message.resolveContent(message.data, 'html', { disableFileAccess: false, disableUrlAccess: false }), {
                code: 'EFILEACCESS'
            });
        });

        it('should resolve a file path when the policy allows it', (t, done) => {
            const message = open({ html: { path: __filename } });

            message.resolveContent(message.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.ok(value.toString().includes('should resolve a file path when the policy allows it'));
                done();
            });
        });

        it('should resolve inline content while the policy is set', (t, done) => {
            const message = sandboxed({ html: 'hello' });

            message.resolveContent(message.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.strictEqual(value, 'hello');
                done();
            });
        });

        it('should apply the policy to a compile plugin resolving during sendMail', (t, done) => {
            // how the bypass was reached in practice, a plugin resolving message content
            // on a transporter that closed file access
            const transporter = nodemailer.createTransport({ streamTransport: true, disableFileAccess: true });

            let pluginErr;
            transporter.use('compile', (mail, next) => {
                mail.resolveContent(mail.data, 'html', err => {
                    pluginErr = err;
                    next();
                });
            });

            transporter.sendMail({ from: 'a@example.com', to: 'b@example.com', text: 'hello', html: { path: __filename } }, () => {
                assert.strictEqual(pluginErr.code, 'EFILEACCESS');
                done();
            });
        });
    });
});
