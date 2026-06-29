/* eslint no-await-in-loop:0 */

'use strict';

const nodemailer = require('../../lib/nodemailer');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

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

    it('should tag send errors with the ESES code', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        return new Promise((resolve, reject) => {
                            // AWS SDK v3 style error: a `name` but no `code` property
                            let error = new Error('Access denied');
                            error.name = 'AccessDeniedException';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                SendEmailCommand
            }
        });

        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, err => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ESES');
            assert.strictEqual(err.name, 'AccessDeniedException');
            done();
        });
    });

    it('should not overwrite an existing error code on send errors', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        return new Promise((resolve, reject) => {
                            let error = new Error('Throttled');
                            error.code = 'Throttling';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                SendEmailCommand
            }
        });

        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, err => {
            assert.ok(err);
            assert.strictEqual(err.code, 'Throttling');
            done();
        });
    });

    it('should reject verify with the ESES code for unexpected errors', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        return new Promise((resolve, reject) => {
                            let error = new Error('Access denied');
                            error.name = 'AccessDeniedException';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                SendEmailCommand
            }
        });

        transport.verify().then(
            () => done(new Error('verify should have failed')),
            err => {
                assert.strictEqual(err.code, 'ESES');
                assert.strictEqual(err.name, 'AccessDeniedException');
                done();
            }
        );
    });

    it('should surface a synchronous SendEmailCommand failure as a single error callback', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        return Promise.resolve({ MessageId: 'unused' });
                    }
                },
                SendEmailCommand: class {
                    constructor() {
                        throw new Error('ctor boom');
                    }
                }
            }
        });

        let calls = 0;
        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, err => {
            calls++;
            assert.ok(err);
            assert.strictEqual(err.message, 'ctor boom');
            assert.strictEqual(err.code, 'ESES');
            // a sync throw must not hang and must not invoke the callback twice
            setTimeout(() => {
                assert.strictEqual(calls, 1);
                done();
            }, 50);
        });
    });

    it('should surface a synchronous sesClient.send failure as a single error callback', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        throw new Error('send boom');
                    }
                },
                SendEmailCommand
            }
        });

        let calls = 0;
        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, err => {
            calls++;
            assert.ok(err);
            assert.strictEqual(err.message, 'send boom');
            setTimeout(() => {
                assert.strictEqual(calls, 1);
                done();
            }, 50);
        });
    });

    it('should not hang verify when SendEmailCommand throws synchronously', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    config: {
                        region() {
                            return Promise.resolve('eu-west-1');
                        }
                    },
                    send() {
                        return Promise.resolve({});
                    }
                },
                SendEmailCommand: class {
                    constructor() {
                        throw new Error('verify ctor boom');
                    }
                }
            }
        });

        transport.verify().then(
            () => done(new Error('verify should have rejected')),
            err => {
                assert.strictEqual(err.message, 'verify ctor boom');
                assert.strictEqual(err.code, 'ESES');
                done();
            }
        );
    });

    it('should not re-invoke the send callback when it throws (no recatch)', () => {
        // The callback runs detached (setImmediate) after the fix, so a throw from it surfaces
        // as an uncaught exception rather than being recaught by .catch() and used to call the
        // callback a second time. node:test fails a test on any uncaught exception, so this runs
        // in a child process that absorbs the throw and reports the invocation count.
        const entry = require.resolve('../../lib/nodemailer');
        const script = [
            "'use strict';",
            'process.on("uncaughtException", () => {});',
            `const nm = require(${JSON.stringify(entry)});`,
            'const transport = nm.createTransport({ logger: false, SES: {',
            '  sesClient: { config: { region() { return Promise.resolve("eu-west-1"); } },',
            '    send() { return new Promise(r => setImmediate(() => r({ MessageId: "x" }))); } },',
            '  SendEmailCommand: class { constructor(d) { this.d = d; } } } });',
            'let calls = 0, secondErr = false;',
            'transport.sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" }, err => {',
            '  calls++; if (calls >= 2 && err) { secondErr = true; }',
            '  if (calls === 1) { throw new Error("throw on first"); } });',
            'setTimeout(() => { process.stdout.write("RESULT:" + JSON.stringify({ calls, secondErr })); process.exit(0); }, 100);'
        ].join('\n');

        const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
        const m = out.match(/RESULT:(\{.*\})/);
        assert.ok(m, 'child did not emit a result: ' + out);
        const res = JSON.parse(m[1]);
        assert.strictEqual(res.calls, 1);
        assert.strictEqual(res.secondErr, false);
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
