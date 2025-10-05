/* eslint no-await-in-loop:0 */

'use strict';

const nodemailer = require('../../lib/nodemailer');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIBywIBAAJhANCx7ncKUfQ8wBUYmMqq6ky8rBB0NL8knBf3+uA7q/CSxpX6sQ8N
dFNtEeEd7gu7BWEM7+PkO1P0M78eZOvVmput8BP9R44ARpgHY4V0qSCdUt4rD32n
wfjlGbh8p5ua5wIDAQABAmAm+uUQpQPTu7kg95wqVqw2sxLsa9giT6M8MtxQH7Uo
1TF0eAO0TQ4KOxgY1S9OT5sGPVKnag258m3qX7o5imawcuyStb68DQgAUg6xv7Af
AqAEDfYN5HW6xK+X81jfOUECMQDr7XAS4PERATvgb1B3vRu5UEbuXcenHDYgdoyT
3qJFViTbep4qeaflF0uF9eFveMcCMQDic10rJ8fopGD7/a45O4VJb0+lRXVdqZxJ
QzAp+zVKWqDqPfX7L93SQLzOGhdd7OECMQDeQyD7WBkjSQNMy/GF7I1qxrscIxNN
VqGTcbu8Lti285Hjhx/sqhHHHGwU9vB7oM8CMQDKTS3Kw/s/xrot5O+kiZwFgr+w
cmDrj/7jJHb+ykFNb7GaEkiSYqzUjKkfpweBDYECMFJUyzuuFJAjq3BXmGJlyykQ
TweUw+zMVdSXjO+FCPcYNi6CP1t1KoESzGKBVoqA/g==
-----END RSA PRIVATE KEY-----`;

class SendEmailCommand {
    constructor(messageData) {
        this.messageData = messageData;
    }

    send() {
        return {
            messageData: this.messageData,
            MessageId: 'testtest'
        };
    }
}

const sesMock = {
    // mock client object
    sesClient: {
        config: {
            region() {
                return new Promise(resolve => {
                    setImmediate(() => {
                        resolve('eu-west-1');
                    });
                });
            }
        },
        send(msgObj) {
            return new Promise(resolve => {
                setImmediate(() => resolve(msgObj.send()));
            });
        }
    },
    // Prevent tests from actually sending mail by mocking sendRawEmail
    SendEmailCommand
};

describe('SES Transport Tests', { timeout: 90 * 1000 }, () => {
    it('should return MessageId', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: sesMock
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: {
                path: __dirname + '/../json-transport/fixtures/body.html'
            },
            text: 'hello world',
            attachments: [
                {
                    filename: 'image.png',
                    path: __dirname + '/../json-transport/fixtures/image.png'
                }
            ]
        };

        transport.sendMail(messageObject, (err, info) => {
            assert.ok(!err);
            assert.ok(info);
            const keys = Object.keys(info);
            assert.ok(['envelope', 'messageId', 'response', 'raw'].every(key => keys.includes(key)));
            assert.deepStrictEqual(info.envelope, {
                from: 'andris.reinman@gmail.com',
                to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
            });
            assert.strictEqual(info.messageId, '<testtest@eu-west-1.amazonses.com>');
            assert.strictEqual(info.response, 'testtest');
            done();
        });
    });

    it('should verify ses configuration', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                // mock client object
                sesClient: {
                    config: {
                        region() {
                            return new Promise(resolve => {
                                setImmediate(() => {
                                    resolve('eu-west-1');
                                });
                            });
                        }
                    },
                    send(/* msg */) {
                        return new Promise((resolve, reject) => {
                            let error = new Error('failure');
                            error.code = 'InvalidParameterValue';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                // Prevent tests from actually sending mail by mocking sendRawEmail
                SendEmailCommand
            }
        });

        transport.verify().then(info => {
            assert.ok(info);
            assert.strictEqual(info, true);
            done();
        });
    });

    it('should sign message with DKIM, using AWS SES JavaScript SDK v2', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                // mock client object
                sesClient: {
                    config: {
                        region() {
                            return new Promise(resolve => {
                                setImmediate(() => {
                                    resolve('eu-west-1');
                                });
                            });
                        }
                    },
                    send(messageData) {
                        assert.ok(
                            messageData.messageData.Content.Raw.Data.toString().includes('h=from:subject:to:cc:mime-version:content-type;')
                        );
                        return new Promise(resolve => {
                            setImmediate(() => resolve(messageData.send()));
                        });
                    }
                },
                // Prevent tests from actually sending mail by mocking sendRawEmail
                SendEmailCommand
            },

            dkim: {
                domainName: 'node.ee',
                keySelector: 'dkim',
                privateKey
            }
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: {
                path: __dirname + '/../json-transport/fixtures/body.html'
            },
            text: 'hello world',
            attachments: [
                {
                    filename: 'image.png',
                    path: __dirname + '/../json-transport/fixtures/image.png'
                }
            ]
        };

        transport.sendMail(messageObject, (err, info) => {
            assert.ok(!err);
            assert.ok(info);
            const keys = Object.keys(info);
            assert.ok(['envelope', 'messageId', 'response', 'raw'].every(key => keys.includes(key)));
            assert.deepStrictEqual(info.envelope, {
                from: 'andris.reinman@gmail.com',
                to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
            });
            assert.strictEqual(info.messageId, '<testtest@eu-west-1.amazonses.com>');
            assert.strictEqual(info.response, 'testtest');
            done();
        });
    });
});
