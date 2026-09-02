/* eslint no-await-in-loop:0 */

import nodemailer from '../../src/nodemailer.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NodemailerError } from '../../src/errors.js';
import type { SESTransportOptions } from '../../src/ses-transport/index.js';
import { captureLogger } from '../smtp-transport/smtp-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    messageData: any;

    constructor(messageData: any) {
        this.messageData = messageData;
    }

    send() {
        return {
            messageData: this.messageData,
            MessageId: 'testtest'
        };
    }
}

const sesMock: SESTransportOptions['SES'] = {
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
        send(msgObj: any) {
            return new Promise(resolve => {
                setImmediate(() => resolve(msgObj.send()));
            });
        }
    },
    // Prevent tests from actually sending mail by mocking sendRawEmail
    SendEmailCommand
};

describe('SES Transport Tests', { timeout: 90 * 1000 }, () => {
    it('should normalize the addresses of a custom envelope', (t, done) => {
        let transport = nodemailer.createTransport({
            SES: sesMock
        });

        // the recipients of the SES command are the value that really reaches the API, and a
        // custom envelope used to arrive there unnormalized
        let sesMessage: any;
        t.mock.method(sesMock.sesClient, 'send', (command: any) => {
            sesMessage = command.messageData;
            return new Promise(resolve => setImmediate(() => resolve(command.send())));
        });

        transport.sendMail(
            {
                envelope: { from: 'a@evil.com@good.com', to: ['b@evil.com@good.com'] },
                from: 'a@evil.com@good.com',
                to: 'b@evil.com@good.com',
                subject: 'envelope',
                text: 'hello'
            },
            (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(sesMessage.Destination.ToAddresses, ['"b@evil.com"@good.com']);
                assert.deepStrictEqual(info.envelope, {
                    from: '"a@evil.com"@good.com',
                    to: ['"b@evil.com"@good.com']
                });
                t.mock.restoreAll();
                done();
            }
        );
    });

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
                            return new Promise<string>(resolve => {
                                setImmediate(() => {
                                    resolve('eu-west-1');
                                });
                            });
                        }
                    },
                    send(/* msg */) {
                        return new Promise((resolve, reject) => {
                            let error: NodemailerError = new Error('failure');
                            error.code = 'InvalidParameterValue';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                // Prevent tests from actually sending mail by mocking sendRawEmail
                SendEmailCommand
            }
        });

        transport.verify().then((info: any) => {
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

        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, (err: any) => {
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
                            let error: NodemailerError = new Error('Throttled');
                            error.code = 'Throttling';
                            setImmediate(() => reject(error));
                        });
                    }
                },
                SendEmailCommand
            }
        });

        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, (err: any) => {
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
            (err: any) => {
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
        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, (err: any) => {
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
        transport.sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' }, (err: any) => {
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
            (err: any) => {
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
        // The child loads the TypeScript entry through tsx, the same way the test runner does
        const entry = pathToFileURL(path.join(__dirname, '..', '..', 'src', 'nodemailer.ts')).href;
        const script = [
            'process.on("uncaughtException", () => {});',
            `const nm = (await import(${JSON.stringify(entry)})).default;`,
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

        // Bun runs TypeScript natively, so the tsx loader is only registered under Node
        const loaderArgs = process.versions.bun ? [] : ['--import', 'tsx'];
        const out = execFileSync(process.execPath, [...loaderArgs, '--input-type=module', '-e', script], { encoding: 'utf8' });
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
                            return new Promise<string>(resolve => {
                                setImmediate(() => {
                                    resolve('eu-west-1');
                                });
                            });
                        }
                    },
                    send(messageData: any) {
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

describe('SES Transport region and failure handling', () => {
    const message = { from: 'a@example.com', to: 'b@example.com', subject: 'test', text: 'test' };

    // a client that answers every command with the given MessageId and records the commands
    const client = (messageId: string, config?: { region(): Promise<string> }) => {
        const commands: any[] = [];
        const sesClient: SESTransportOptions['SES']['sesClient'] = {
            config,
            send(command: any) {
                commands.push(command);
                return new Promise(resolve => setImmediate(() => resolve({ MessageId: messageId })));
            }
        };
        return { commands, SES: { sesClient, SendEmailCommand } };
    };

    it('should fall back to the email region when the client has no region provider', (t, done) => {
        const transport = nodemailer.createTransport({ SES: client('abc').SES });

        transport.sendMail(message, (err, info) => {
            assert.ok(!err);
            assert.strictEqual(info.messageId, '<abc@email.amazonses.com>');
            assert.strictEqual(info.response, 'abc');
            done();
        });
    });

    it('should fall back to the email region when the region provider fails', (t, done) => {
        const transport = nodemailer.createTransport({
            SES: client('abc', { region: () => Promise.reject(new Error('no region')) }).SES
        });

        transport.sendMail(message, (err, info) => {
            assert.ok(!err);
            assert.strictEqual(info.messageId, '<abc@email.amazonses.com>');
            done();
        });
    });

    it('should keep a MessageId that already carries a domain', (t, done) => {
        const transport = nodemailer.createTransport({
            SES: client('abc@custom.example', { region: () => Promise.resolve('eu-west-1') }).SES
        });

        transport.sendMail(message, (err, info) => {
            assert.ok(!err);
            assert.strictEqual(info.messageId, '<abc@custom.example>');
            assert.strictEqual(info.response, 'abc@custom.example');
            done();
        });
    });

    it('should merge the ses fields of the message into the command', (t, done) => {
        const { commands, SES } = client('abc');
        const transport = nodemailer.createTransport({ SES });

        transport.sendMail(
            {
                ...message,
                from: 'Sender Name <a@example.com>',
                ses: { ConfigurationSetName: 'tracked', ListManagementOptions: { ContactListName: 'list' } }
            },
            (err, info) => {
                assert.ok(!err);
                assert.strictEqual(commands.length, 1);
                const input = commands[0].messageData;
                assert.strictEqual(input.ConfigurationSetName, 'tracked');
                assert.deepStrictEqual(input.ListManagementOptions, { ContactListName: 'list' });
                assert.strictEqual(input.FromEmailAddress, 'Sender Name <a@example.com>');
                assert.deepStrictEqual(input.Destination, { ToAddresses: ['b@example.com'] });
                assert.ok(Buffer.isBuffer(input.Content.Raw.Data));
                assert.strictEqual(input.Content.Raw.Data, info.raw);
                assert.ok(info.raw.toString().includes('\r\nSubject: test\r\n'));
                done();
            }
        );
    });

    it('should log the recipient list with an overflow marker', (t, done) => {
        const { lines, logger } = captureLogger();
        const transport = nodemailer.createTransport({ SES: client('abc').SES, logger });
        const to = ['r1@example.com', 'r2@example.com', 'r3@example.com', 'r4@example.com', 'r5@example.com'];

        transport.sendMail({ ...message, to }, (err, info) => {
            assert.ok(!err);
            assert.deepStrictEqual(info.envelope.to, to);
            const line = lines.find(line => line.entry.tnx === 'send' && line.level === 'info');
            assert.ok(line, 'no send log line');
            assert.ok(line.message.endsWith(' to <r1@example.com, r2@example.com, ...and 3 more>'), line.message);
            done();
        });
    });

    it('should add date and message-id to the dkim skipFields of the message', (t, done) => {
        const transport = nodemailer.createTransport({
            SES: client('abc').SES,
            dkim: { domainName: 'node.ee', keySelector: 'dkim', privateKey }
        });

        transport.sendMail({ ...message, _dkim: { skipFields: 'subject' } }, (err, info) => {
            assert.ok(!err);
            const raw = info.raw.toString();
            const match = raw.replace(/\r\n[ \t]+/g, ' ').match(/^DKIM-Signature:.* h=([^;]+);/m);
            assert.ok(match, 'no DKIM-Signature header in ' + raw);
            const fields = match[1].split(':');
            assert.ok(fields.includes('from'), match[1]);
            assert.ok(fields.includes('to'), match[1]);
            ['subject', 'date', 'message-id'].forEach(field => assert.ok(!fields.includes(field), match[1]));
            done();
        });
    });

    it('should report a message that can not be generated', (t, done) => {
        const { lines, logger } = captureLogger();
        const { commands, SES } = client('abc');
        const transport = nodemailer.createTransport({ SES, logger });

        transport.sendMail(
            { ...message, attachments: [{ filename: 'missing.txt', path: path.join(__dirname, 'does-not-exist.txt') }] },
            (err: any, info) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ENOENT');
                assert.ok(!info);
                assert.strictEqual(commands.length, 0);
                const line = lines.find(line => line.level === 'error');
                assert.ok(line, 'no error log line');
                assert.ok(/^Failed creating message for <[^>]+>\. ENOENT/.test(line.message), line.message);
                done();
            }
        );
    });

    it('should accept a MessageRejected response through the Code property when verifying', (t, done) => {
        const transport = nodemailer.createTransport({
            SES: {
                sesClient: {
                    send() {
                        const error: any = new Error('Email address is not verified');
                        error.Code = 'MessageRejected';
                        return Promise.reject(error);
                    }
                },
                SendEmailCommand
            }
        });

        transport.verify((err, success) => {
            assert.ok(!err);
            assert.strictEqual(success, true);
            done();
        });
    });

    it('should verify without a region provider', (t, done) => {
        const { commands, SES } = client('abc');
        const transport = nodemailer.createTransport({ SES });

        transport.verify((err, success) => {
            assert.ok(!err);
            assert.strictEqual(success, true);
            assert.strictEqual(commands.length, 1);
            assert.strictEqual(commands[0].messageData.FromEmailAddress, 'invalid@invalid');
            done();
        });
    });
});
