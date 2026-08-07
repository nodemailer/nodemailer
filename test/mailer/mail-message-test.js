'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const MailMessage = require('../../lib/mailer/mail-message');

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
});
