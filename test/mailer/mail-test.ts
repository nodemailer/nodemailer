import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import Mail from '../../src/mailer/index.js';
import type { GetSocketHandler } from '../../src/mailer/index.js';
import MailMessage from '../../src/mailer/mail-message.js';
import nodemailer from '../../src/nodemailer.js';
import type { SendMailOptions } from '../../src/nodemailer.js';
import { captureLogger } from '../smtp-transport/smtp-fixtures.js';

const __filename = fileURLToPath(import.meta.url);

// the same 768 bit test key the SES transport tests sign with
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

// a one pixel png and gif, the images the attachDataUrls tests embed
const pngDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const gifDataUri = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

// a transport plugin that emits events the way the SMTP transports do and records what it was
// handed
class StubTransport extends EventEmitter {
    name = 'Stub';
    version = '1.0.0';
    sent: MailMessage[] = [];
    error: Error | null = null;
    /** set by Mail when a proxy is configured */
    declare getSocket?: GetSocketHandler;

    send(mail: MailMessage, callback: (err: Error | null, info?: any) => void): void {
        this.sent.push(mail);
        if (this.error) {
            const err = this.error;
            setImmediate(() => callback(err));
            return;
        }
        setImmediate(() => callback(null, { envelope: mail.message!.getEnvelope(), messageId: mail.message!.messageId() }));
    }
}

const message = (): SendMailOptions => ({ from: 'sender@example.com', to: 'rcpt@example.com', subject: 'test', text: 'hello' });

// renders a message to its RFC822 form through the stream transport
const render = (options: { [key: string]: any }, data: SendMailOptions): Promise<string> =>
    new Promise((resolve, reject) => {
        const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, ...options });
        transporter.sendMail(data, (err, info) => (err ? reject(err) : resolve((info.message as Buffer).toString())));
    });

// the unfolded header lines of a rendered message
const headerLines = (raw: string): string[] =>
    raw
        .split('\r\n\r\n')[0]
        .replace(/\r\n[ \t]+/g, ' ')
        .split('\r\n');

const dkimHeader = (raw: string): string => {
    const line = headerLines(raw).find(line => line.startsWith('DKIM-Signature:'));
    assert.ok(line, 'no DKIM-Signature header in ' + raw);
    return line;
};

const signedFields = (dkim: string): string[] => {
    const match = dkim.match(/ h=([^;]+);/);
    assert.ok(match, 'no h= tag in ' + dkim);
    return match[1].split(':');
};

describe('Mail', () => {
    describe('transport events', () => {
        it('should re-emit a transport error and log it', (t, done) => {
            const transport = new StubTransport();
            const { lines, logger } = captureLogger();
            const mail = new Mail(transport, { logger });
            const boom = new Error('boom');

            mail.on('error', err => {
                assert.strictEqual(err, boom);
                const line = lines.find(line => line.level === 'error');
                assert.ok(line);
                assert.strictEqual(line.message, 'Transport Error: boom');
                assert.strictEqual(line.entry.err, boom);
                assert.strictEqual(line.entry.tnx, 'transport');
                done();
            });

            transport.emit('error', boom);
        });

        it('should log the legacy log event of a transport', () => {
            const transport = new StubTransport();
            const { lines, logger } = captureLogger();
            const mail = new Mail(transport, { logger });
            assert.strictEqual(mail.transporter, transport);

            transport.emit('log', { type: 'server', message: '220 ready' });

            const line = lines.find(line => line.message === 'server: 220 ready');
            assert.ok(line, 'log event was not logged');
            assert.strictEqual(line.level, 'debug');
            assert.strictEqual(line.entry.tnx, 'transport');
        });

        it('should re-emit idle and clear with their arguments', () => {
            const transport = new StubTransport();
            const mail = new Mail(transport);
            const events: any[][] = [];

            mail.on('idle', (...args) => events.push(['idle', ...args]));
            mail.on('clear', (...args) => events.push(['clear', ...args]));

            transport.emit('idle', 'first', 2);
            transport.emit('clear');

            assert.deepStrictEqual(events, [['idle', 'first', 2], ['clear']]);
        });

        it('should accept a transport that is not an event emitter', () => {
            const transport: any = {
                name: 'Plain',
                version: '1',
                send(mail: MailMessage, callback: (err: Error | null, info?: any) => void) {
                    callback(null, { envelope: mail.message!.getEnvelope(), messageId: mail.message!.messageId() });
                }
            };
            const mail = new Mail(transport);

            assert.strictEqual(transport.mailer, mail);
            assert.deepStrictEqual(mail.options, {});
            assert.deepStrictEqual(mail._defaults, {});
            assert.strictEqual(mail.dkim, false);
        });
    });

    describe('forwarded methods', () => {
        it('should forward close, isIdle and verify to the transport', (t, done) => {
            const calls: any[][] = [];
            const transport: any = {
                name: 'Stub',
                version: '1',
                send() {},
                close(...args: any[]) {
                    calls.push(['close', ...args]);
                    return 'closed';
                },
                isIdle() {
                    return true;
                },
                verify(callback: (err: Error | null, ok?: true) => void) {
                    callback(null, true);
                }
            };
            const mail = new Mail(transport);

            assert.strictEqual((mail.close as (...args: any[]) => any)('now'), 'closed');
            assert.strictEqual(mail.isIdle(), true);
            mail.verify((err, ok) => {
                assert.ok(!err);
                assert.strictEqual(ok, true);
                assert.deepStrictEqual(calls, [['close', 'now']]);
                done();
            });
        });

        it('should return false and warn when the transport does not implement a method', () => {
            const { lines, logger } = captureLogger();
            const mail = new Mail({ name: 'Stub', version: '1', send() {} }, { logger });

            assert.strictEqual(mail.close(), false);
            assert.strictEqual(mail.isIdle(), false);
            assert.strictEqual((mail.verify as () => any)(), false);

            const warnings = lines.filter(line => line.level === 'warn');
            assert.deepStrictEqual(
                warnings.map(line => line.message),
                [
                    'Non existing method close called for transport',
                    'Non existing method isIdle called for transport',
                    'Non existing method verify called for transport'
                ]
            );
            assert.deepStrictEqual(
                warnings.map(line => line.entry.methodName),
                ['close', 'isIdle', 'verify']
            );
        });

        it('should hand the proxy socket handler to the transport before verify', (t, done) => {
            const transport: any = {
                name: 'Stub',
                version: '1',
                send() {},
                verify(callback: (err: Error | null, value: string) => void) {
                    callback(null, typeof this.getSocket);
                }
            };
            const mail = new Mail(transport, { proxy: 'http://127.0.0.1:1' });

            assert.strictEqual(typeof mail.getSocket, 'function');
            assert.strictEqual(transport.getSocket, undefined);

            mail.verify((err, value) => {
                assert.ok(!err);
                assert.strictEqual(value, 'function');
                assert.strictEqual(mail.getSocket, false);
                done();
            });
        });

        it('should hand the proxy socket handler to the transport on the first send', (t, done) => {
            const transport = new StubTransport();
            const mail = new Mail(transport, { proxy: 'http://127.0.0.1:1' });
            const handler = mail.getSocket;

            assert.strictEqual(typeof handler, 'function');

            mail.sendMail(message(), err => {
                assert.ok(!err);
                assert.strictEqual(transport.getSocket, handler);
                assert.strictEqual(mail.getSocket, false);

                mail.sendMail(message(), err => {
                    assert.ok(!err);
                    // the second send leaves the handler where the first one put it
                    assert.strictEqual(transport.getSocket, handler);
                    assert.strictEqual(transport.sent.length, 2);
                    done();
                });
            });
        });
    });

    describe('plugins', () => {
        it('should run compile plugins before compiling and stream plugins after', async () => {
            const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
            const seen: { [key: string]: any } = {};

            transporter.use('compile', (mail, next) => {
                seen.compileMessage = mail.message;
                mail.data.subject = 'changed by plugin';
                next();
            });
            transporter.use('stream', (mail, next) => {
                seen.streamMessage = mail.message;
                mail.message!.setHeader('X-Stream-Plugin', 'yes');
                next();
            });

            const info = await transporter.sendMail(message());
            const raw = (info.message as Buffer).toString();

            assert.strictEqual(seen.compileMessage, null);
            assert.ok(seen.streamMessage);
            assert.ok(headerLines(raw).includes('Subject: changed by plugin'));
            assert.ok(headerLines(raw).includes('X-Stream-Plugin: yes'));
        });

        it('should run the user plugins of a step in registration order after the default ones', async () => {
            const order: string[] = [];
            const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, attachDataUrls: true });

            transporter.use('compile', (mail, next) => {
                // attachDataUrls is a default compile plugin, so its attachment is already there
                order.push('first:' + (mail.data.attachments || []).length);
                next();
            });
            transporter.use('compile', (mail, next) => {
                order.push('second');
                next();
            });

            await transporter.sendMail({ ...message(), html: '<img src="' + pngDataUri + '">' });

            assert.deepStrictEqual(order, ['first:1', 'second']);
        });

        it('should return itself from use() and keep plugins of a step it never runs on its own', async () => {
            let calls = 0;
            const transporter = nodemailer.createTransport({ jsonTransport: true });

            assert.strictEqual(
                transporter.use('custom', (mail, next) => {
                    calls++;
                    next();
                }),
                transporter
            );

            const info = await transporter.sendMail(message());
            assert.ok(info.messageId);
            assert.strictEqual(calls, 0);

            // the step is still there for a caller that runs it by hand
            transporter._processPlugins('custom', new MailMessage(transporter, {}), err => {
                assert.ok(!err);
            });
            assert.strictEqual(calls, 1);
        });

        it('should call back at once for a step without plugins', () => {
            const transporter = nodemailer.createTransport({ jsonTransport: true });
            let calls = 0;

            transporter._processPlugins('unknown', new MailMessage(transporter, {}), err => {
                assert.ok(!err);
                calls++;
            });
            transporter._processPlugins('stream', new MailMessage(transporter, {}), err => {
                assert.ok(!err);
                calls++;
            });

            assert.strictEqual(calls, 2);
        });

        it('should abort the send when a compile plugin fails', (t, done) => {
            const transport = new StubTransport();
            const { lines, logger } = captureLogger();
            const mail = new Mail(transport, { logger });
            const failure = new Error('compile failed');

            mail.use('compile', (m, next) => next(failure));

            mail.sendMail(message(), err => {
                assert.strictEqual(err, failure);
                assert.strictEqual(transport.sent.length, 0);
                const line = lines.find(line => line.level === 'error');
                assert.ok(line);
                assert.strictEqual(line.message, 'PluginCompile Error: compile failed');
                assert.strictEqual(line.entry.action, 'compile');
                done();
            });
        });

        it('should abort the send when a stream plugin fails', (t, done) => {
            const transport = new StubTransport();
            const { lines, logger } = captureLogger();
            const mail = new Mail(transport, { logger });
            const failure = new Error('stream failed');

            mail.use('stream', (m, next) => next(failure));

            mail.sendMail(message(), err => {
                assert.strictEqual(err, failure);
                assert.strictEqual(transport.sent.length, 0);
                const line = lines.find(line => line.level === 'error');
                assert.ok(line);
                assert.strictEqual(line.message, 'PluginStream Error: stream failed');
                assert.strictEqual(line.entry.action, 'stream');
                done();
            });
        });
    });

    describe('meta store', () => {
        it('should hand back what was set and nothing for an unknown key', () => {
            const mail = new Mail(new StubTransport());
            const socks = { createConnection() {} };

            assert.strictEqual(mail.get('proxy_socks_module'), undefined);
            assert.strictEqual(mail.set('proxy_socks_module', socks), mail.meta);
            assert.strictEqual(mail.get('proxy_socks_module'), socks);
        });
    });

    describe('sending', () => {
        it('should log a transport error and pass it on', (t, done) => {
            const transport = new StubTransport();
            const { lines, logger } = captureLogger();
            const mail = new Mail(transport, { logger });
            transport.error = new Error('mailbox full');

            mail.sendMail(message(), err => {
                assert.strictEqual(err, transport.error);
                const line = lines.find(line => line.level === 'error');
                assert.ok(line);
                assert.strictEqual(line.message, 'Send Error: mailbox full');
                assert.strictEqual(line.entry.tnx, 'transport');
                assert.strictEqual(line.entry.action, 'send');
                done();
            });
        });

        it('should name the transport in the version string', () => {
            const mail = new Mail(new StubTransport());
            const version = mail.getVersionString();

            assert.ok(version.startsWith('nodemailer ('), version);
            assert.ok(version.endsWith('; Stub/1.0.0)'), version);
        });
    });

    describe('DKIM', () => {
        const transportKey = { domainName: 'node.ee', keySelector: 'dkim', privateKey };

        it('should sign every message with the dkim options of the transport', async () => {
            const { lines, logger } = captureLogger();
            const raw = await render({ logger, dkim: transportKey }, message());
            const dkim = dkimHeader(raw);

            assert.ok(dkim.includes(' d=node.ee;'), dkim);
            assert.ok(dkim.includes(' s=dkim;'), dkim);
            assert.ok(signedFields(dkim).includes('subject'), dkim);

            const line = lines.find(line => line.entry.tnx === 'DKIM');
            assert.ok(line, 'no DKIM log line');
            assert.strictEqual(line.message, 'Signing outgoing message with 1 keys');
            assert.strictEqual(line.entry.dkimDomains, 'dkim.node.ee');
        });

        it('should prefer the dkim options of the message over the ones of the transport', async () => {
            const raw = await render(
                { dkim: transportKey },
                { ...message(), dkim: { domainName: 'other.ee', keySelector: 'msg', privateKey } }
            );
            const dkim = dkimHeader(raw);

            assert.ok(dkim.includes(' d=other.ee;'), dkim);
            assert.ok(dkim.includes(' s=msg;'), dkim);
            assert.ok(!dkim.includes('node.ee'), dkim);
        });

        it('should sign with the dkim options of the message when the transport has none', async () => {
            const raw = await render({}, { ...message(), dkim: transportKey });

            assert.ok(dkimHeader(raw).includes(' d=node.ee;'));
        });

        it('should apply the extra _dkim options of the message to the signature', async () => {
            const raw = await render({ dkim: transportKey }, { ...message(), _dkim: { skipFields: 'subject' } });
            const fields = signedFields(dkimHeader(raw));

            assert.ok(!fields.includes('subject'), fields.join(':'));
            assert.ok(fields.includes('from'), fields.join(':'));
            assert.ok(fields.includes('to'), fields.join(':'));
        });

        it('should not sign when neither the transport nor the message asks for it', async () => {
            const raw = await render({}, message());

            assert.ok(!headerLines(raw).some(line => line.startsWith('DKIM-Signature:')));
        });
    });

    describe('attachDataUrls', () => {
        const withImage = (extra?: SendMailOptions): SendMailOptions => ({
            ...message(),
            html: '<p>Hi</p><img alt="dot" src="' + pngDataUri + '">',
            ...extra
        });

        const embeddedCid = (raw: string): string => {
            const match = raw.match(/<img alt="dot" src="cid:([^"]+)">/);
            assert.ok(match, 'the html was not rewritten: ' + raw);
            return match[1];
        };

        it('should turn a data: image into an inline attachment when the transport enables it', async () => {
            const raw = await render({ attachDataUrls: true }, withImage());
            const cid = embeddedCid(raw);

            assert.ok(/^[0-9a-f]{20}@localhost$/.test(cid), cid);
            assert.ok(raw.includes('Content-ID: <' + cid + '>'), raw);
            assert.ok(raw.includes('Content-Type: image/png; name=image-1.png'), raw);
            assert.ok(raw.includes('Content-Disposition: inline; filename=image-1.png'), raw);
        });

        it('should turn a data: image into an inline attachment when the message enables it', async () => {
            const raw = await render({}, withImage({ attachDataUrls: true }));

            assert.ok(raw.includes('Content-ID: <' + embeddedCid(raw) + '>'), raw);
        });

        it('should leave a data: image alone when nothing enables it', async () => {
            const raw = await render({}, withImage());

            assert.ok(!raw.includes('Content-ID:'), raw);
            assert.ok(!raw.includes('cid:'), raw);
        });

        it('should number the images and keep an attachment given as a single object', async () => {
            const raw = await render(
                { attachDataUrls: true },
                {
                    ...message(),
                    html: '<img src="' + pngDataUri + '"><img src="' + gifDataUri + '">',
                    // a single attachment object instead of a list
                    attachments: { filename: 'one.txt', content: 'one' } as any
                }
            );

            assert.ok(raw.includes('Content-Type: image/png; name=image-1.png'), raw);
            assert.ok(raw.includes('Content-Type: image/gif; name=image-2.gif'), raw);
            assert.ok(raw.includes('Content-Disposition: attachment; filename=one.txt'), raw);
        });

        it('should read html given as a buffer', async () => {
            const raw = await render(
                { attachDataUrls: true },
                withImage({ html: Buffer.from('<img alt="dot" src="' + pngDataUri + '">') })
            );

            assert.ok(raw.includes('Content-ID: <' + embeddedCid(raw) + '>'), raw);
        });

        it('should fail the send when the html can not be resolved', (t, done) => {
            const transporter = nodemailer.createTransport({ streamTransport: true, attachDataUrls: true, disableFileAccess: true });

            transporter.sendMail({ ...message(), html: { path: __filename } }, (err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            });
        });
    });
});
