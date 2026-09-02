import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MailMessage from '../../src/mailer/mail-message.js';
import MailComposer from '../../src/mail-composer/index.js';
import nodemailer from '../../src/nodemailer.js';
import type { SendMailOptions } from '../../src/nodemailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MailMessage Tests', () => {
    describe('constructor', () => {
        it('should copy message data', () => {
            const mailer: any = { options: {}, _defaults: {} };
            const message = new MailMessage(mailer, {
                from: 'sender@example.com',
                to: 'rcpt@example.com'
            });

            assert.strictEqual(message.data.from, 'sender@example.com');
            assert.strictEqual(message.data.to, 'rcpt@example.com');
        });

        it('should not mutate the prototype chain of message data', () => {
            const mailer: any = { options: {}, _defaults: {} };
            // an own "__proto__" key (e.g. from JSON.parse) must not become the prototype of data
            const message = new MailMessage(mailer, JSON.parse('{"__proto__":{"from":"attacker@example.com"}}'));

            assert.strictEqual(Object.getPrototypeOf(message.data), Object.prototype);
            assert.strictEqual(message.data.from, undefined);
        });

        it('should still apply transporter defaults for unset keys', () => {
            const mailer: any = {
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
            const mailer: any = { options: {}, _defaults: JSON.parse('{"__proto__":{"from":"attacker@example.com"}}') };
            const message = new MailMessage(mailer, { to: 'rcpt@example.com' });

            assert.strictEqual(Object.getPrototypeOf(message.data), Object.prototype);
            assert.strictEqual(message.data.from, undefined);
            assert.strictEqual(({} as any).from, undefined);
        });

        it('should apply a default that shares a name with an Object member', () => {
            // "key in this.data" also matched every member of Object.prototype, so a default
            // named toString or constructor was dropped with no error
            const mailer: any = { options: {}, _defaults: { from: 'default@example.com', constructor: 'x', toString: 'y' } };
            const message = new MailMessage(mailer, {});

            assert.strictEqual(message.data.from, 'default@example.com');
            assert.strictEqual(message.data.constructor, 'x');
            assert.strictEqual(message.data.toString, 'y');
        });

        it('should not let an own __proto__ key of an attachment reach the resolved node', (t, done) => {
            const mailer: any = { options: {}, _defaults: {} };
            const message = new MailMessage(mailer, {
                attachments: [JSON.parse('{"filename":"f.txt","content":"x","cid":"a","__proto__":{"path":"/etc/passwd"}}')]
            });

            message.resolveAll((err, data) => {
                assert.ok(!err);
                const node: any = data.attachments![0];
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
            const mailer: any = { options: {}, _defaults: { from: 'default@example.com', headers: { 'x-a': '1', 'x-b': '2' } } };
            const message = new MailMessage(mailer, { from: 'set@example.com', headers: { 'x-a': 'own' } });

            assert.strictEqual(message.data.from, 'set@example.com');
            assert.deepStrictEqual(message.data.headers, { 'x-a': 'own', 'x-b': '2' });
        });

        it('should not let message data reopen an access flag set in the defaults', () => {
            // `defaults` is the only channel a transporter plugin has for the sandbox, and the
            // defaults copy leaves a key alone when the message already set one
            const mailer: any = { options: {}, _defaults: { disableFileAccess: true, disableUrlAccess: true } };
            const message = new MailMessage(mailer, { disableFileAccess: false, disableUrlAccess: false });

            assert.strictEqual(message.data.disableFileAccess, true);
            assert.strictEqual(message.data.disableUrlAccess, true);
        });

        it('should still let message data set an access flag the configuration does not name', () => {
            const mailer: any = { options: {}, _defaults: {} };
            const message = new MailMessage(mailer, { disableFileAccess: true });

            assert.strictEqual(message.data.disableFileAccess, true);
        });

        it('should not let a falsy default cancel an access flag the message set', () => {
            // `defaults` built programmatically, e.g. { disableFileAccess: !!cfg.sandbox }, must
            // not switch off a message that tightened for its own untrusted content
            const mailer: any = { options: {}, _defaults: { disableFileAccess: false, disableUrlAccess: undefined } };
            const message = new MailMessage(mailer, { disableFileAccess: true, disableUrlAccess: true });

            assert.strictEqual(message.data.disableFileAccess, true);
            assert.strictEqual(message.data.disableUrlAccess, true);
        });

        it('should let transporter options override an access flag from the defaults', () => {
            const mailer: any = { options: { disableFileAccess: false }, _defaults: { disableFileAccess: true } };
            const message = new MailMessage(mailer, {});

            assert.strictEqual(message.data.disableFileAccess, false);
        });
    });

    describe('resolveContent', () => {
        // the transporter level access policy lives on the message, not on the call
        const sandboxed = (data: any) =>
            new MailMessage({ options: { disableFileAccess: true, disableUrlAccess: true }, _defaults: {} } as any, data);
        const open = (data: any) => new MailMessage({ options: {}, _defaults: {} } as any, data);

        it('should reject a file path for the legacy callback signature', (t, done) => {
            const message = sandboxed({ html: { path: __filename } });

            message.resolveContent(message.data, 'html', (err: any) => {
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            });
        });

        it('should reject an url for the legacy callback signature', (t, done) => {
            const message = sandboxed({ attachments: [{ filename: 'x.bin', href: 'http://127.0.0.1:1/poc' }] });

            message.resolveContent(message.data.attachments!, 0, (err: any) => {
                assert.strictEqual(err.code, 'EURLACCESS');
                done();
            });
        });

        it('should apply the policy for the full (data, key, options, callback) signature', (t, done) => {
            // a path that looks like an url resolves through the url branch, so the merged
            // disableUrlAccess has to reach it from an explicit options object too
            const message = sandboxed({ html: { path: 'http://127.0.0.1:1/poc' } });

            message.resolveContent(message.data, 'html', {}, (err: any) => {
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

        it('should keep the sandbox when the policy came from the transporter defaults', (t, done) => {
            // createTransport leaves `options` undefined for a transporter plugin, so a policy
            // set through its second argument has to survive hostile message data
            const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true }, { disableFileAccess: true });
            const hostile = JSON.parse('{"from":"a@example.com","to":"b@example.com","text":"hi","disableFileAccess":false}');
            hostile.attachments = [{ filename: 'x', path: __filename }];

            transporter.sendMail(hostile, (err: any) => {
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            });
        });

        it('should apply the policy to a compile plugin resolving during sendMail', (t, done) => {
            // how the bypass was reached in practice, a plugin resolving message content
            // on a transporter that closed file access
            const transporter = nodemailer.createTransport({ streamTransport: true, disableFileAccess: true });

            let pluginErr: any;
            transporter.use('compile', (mail: any, next: any) => {
                mail.resolveContent(mail.data, 'html', (err: any) => {
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

describe('MailMessage content handling', () => {
    const mailer: any = { options: {}, _defaults: {} };
    const fixtures = path.join(__dirname, '..', 'json-transport', 'fixtures');

    // a message with its MIME tree compiled, the state normalize() runs in
    const compiled = (data: any): MailMessage => {
        const message = new MailMessage(mailer, data);
        message.message = new MailComposer(message.data).compile();
        return message;
    };

    // renders a message through the stream transport
    const render = (data: SendMailOptions): Promise<string> =>
        new Promise((resolve, reject) => {
            const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
            transporter.sendMail(data, (err, info) => (err ? reject(err) : resolve((info.message as Buffer).toString())));
        });

    const headerLines = (raw: string): string[] =>
        raw
            .split('\r\n\r\n')[0]
            .replace(/\r\n[ \t]+/g, ' ')
            .split('\r\n');

    // header keys are compared without case, the message title-cases them
    const hasHeader = (lines: string[], expected: string): boolean => lines.some(line => line.toLowerCase() === expected.toLowerCase());

    describe('resolveAll', () => {
        it('should parse the address fields of the message data', (t, done) => {
            const message = new MailMessage(mailer, {
                from: 'Sender <a@example.com>, second@example.com',
                to: 'b@example.com, C <c@example.com>',
                cc: '',
                sender: ['s1@example.com', 's2@example.com'] as any
            });

            message.resolveAll((err, data) => {
                assert.ok(!err);
                // from and sender are single addresses, the first one wins
                assert.deepStrictEqual(data.from, { address: 'a@example.com', name: 'Sender' });
                assert.deepStrictEqual(data.sender, { address: 's1@example.com', name: '' });
                assert.deepStrictEqual(data.to, [
                    { address: 'b@example.com', name: '' },
                    { address: 'c@example.com', name: 'C' }
                ]);
                // an address field that was set but holds nothing is cleared, an unset one is left alone
                assert.strictEqual(data.cc, null);
                assert.ok(!('bcc' in data));
                assert.ok(!('replyTo' in data));
                done();
            });
        });

        it('should read the addresses from the compiled message when there is one', (t, done) => {
            const message = compiled({
                from: 'Compiled <x@example.com>',
                to: 'y@example.com',
                replyTo: 'Reply <r@example.com>'
            });
            // the message data is not consulted once the headers exist
            message.data.from = 'ignored@example.com';

            message.resolveAll((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.from, { address: 'x@example.com', name: 'Compiled' });
                assert.deepStrictEqual(data.to, [{ address: 'y@example.com', name: '' }]);
                assert.deepStrictEqual(data.replyTo, [{ address: 'r@example.com', name: 'Reply' }]);
                done();
            });
        });

        it('should resolve the alternatives into content nodes', (t, done) => {
            const message = new MailMessage(mailer, {
                alternatives: [
                    { contentType: 'text/x-custom', content: 'alt' },
                    { contentType: 'text/x-other', content: Buffer.from('buf') }
                ]
            });

            message.resolveAll((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.alternatives![0], { content: 'alt', contentType: 'text/x-custom' });
                assert.strictEqual(data.alternatives![1].contentType, 'text/x-other');
                assert.ok(Buffer.isBuffer(data.alternatives![1].content));
                assert.strictEqual((data.alternatives![1].content as Buffer).toString(), 'buf');
                done();
            });
        });

        it('should derive the file name and content type of the attachments', (t, done) => {
            const message = new MailMessage(mailer, {
                attachments: [
                    { content: 'plain', contentType: 'text/plain' },
                    { path: path.join(fixtures, 'image.png') },
                    { content: 'raw' },
                    { filename: 'named', content: 'x' },
                    // the content is used as it is, the href only names the file
                    { href: 'http://127.0.0.1:1/dir/report.pdf?download=1', content: 'inline' }
                ]
            });

            message.resolveAll((err, data) => {
                assert.ok(!err);
                const attachments = data.attachments!;
                assert.strictEqual(attachments[0].filename, 'attachment-1.txt');
                assert.strictEqual(attachments[0].contentType, 'text/plain');
                assert.strictEqual(attachments[1].filename, 'image.png');
                assert.strictEqual(attachments[1].contentType, 'image/png');
                assert.ok(Buffer.isBuffer(attachments[1].content));
                assert.strictEqual(attachments[2].filename, 'attachment-3.bin');
                assert.strictEqual(attachments[2].contentType, 'application/octet-stream');
                assert.strictEqual(attachments[3].filename, 'named');
                assert.strictEqual(attachments[3].contentType, 'application/octet-stream');
                assert.strictEqual(attachments[4].filename, 'report.pdf');
                assert.strictEqual(attachments[4].contentType, 'application/pdf');
                assert.strictEqual(attachments[4].content, 'inline');
                done();
            });
        });

        it('should pass a content error on', (t, done) => {
            const message = new MailMessage(mailer, { html: { path: path.join(fixtures, 'does-not-exist.html') } });

            message.resolveAll((err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ENOENT');
                done();
            });
        });
    });

    describe('normalize', () => {
        it('should add the envelope and the message id and flatten the content fields', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                html: Buffer.from('<p>hi</p>'),
                text: 'plain',
                watchHtml: { content: 'watch' },
                amp: { content: Buffer.from('<html amp4email>') }
            });

            message.normalize((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.envelope, { from: 'a@example.com', to: ['b@example.com'] });
                assert.strictEqual(data.messageId, message.message!.messageId());
                assert.ok(/^<[^@]+@example\.com>$/.test(data.messageId as string));
                assert.strictEqual(data.html, '<p>hi</p>');
                assert.strictEqual(data.text, 'plain');
                assert.strictEqual(data.watchHtml, 'watch');
                assert.strictEqual(data.amp, '<html amp4email>');
                done();
            });
        });

        it('should encode binary content of the ical event, alternatives and attachments as base64', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                icalEvent: { content: Buffer.from('BEGIN:VCALENDAR') },
                alternatives: [
                    { contentType: 'text/x-custom', content: Buffer.from('alt') },
                    { contentType: 'text/x-text', content: 'kept' }
                ],
                attachments: [
                    { filename: 'a.txt', content: Buffer.from('att') },
                    { filename: 'b.txt', content: 'kept' }
                ]
            });

            message.normalize((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.icalEvent, { content: 'QkVHSU46VkNBTEVOREFS', encoding: 'base64' });
                assert.deepStrictEqual(data.alternatives![0], { content: 'YWx0', contentType: 'text/x-custom', encoding: 'base64' });
                assert.deepStrictEqual(data.alternatives![1], { content: 'kept', contentType: 'text/x-text' });
                assert.deepStrictEqual(data.attachments![0], {
                    content: 'YXR0',
                    filename: 'a.txt',
                    contentType: 'text/plain',
                    encoding: 'base64'
                });
                assert.deepStrictEqual(data.attachments![1], { content: 'kept', filename: 'b.txt', contentType: 'text/plain' });
                done();
            });
        });

        it('should flatten the headers to strings', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                headers: {
                    'x-plain': 'value',
                    'x-list': ['first', 'second'],
                    'x-prepared': { prepared: true, value: 'prepared value' },
                    'x-empty': '',
                    references: '<a@example.com> b@example.com'
                }
            });

            message.normalize((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.normalizedHeaders, {
                    'x-plain': 'value',
                    'x-list': 'first',
                    'x-prepared': 'prepared value',
                    references: '<a@example.com> <b@example.com>'
                });
                done();
            });
        });

        it('should skip a __proto__ header key', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                headers: JSON.parse('{"__proto__": {"x-injected": "yes"}, "x-plain": "value"}')
            });

            message.normalize((err, data) => {
                assert.ok(!err);
                assert.deepStrictEqual(data.normalizedHeaders, { 'x-plain': 'value' });
                assert.strictEqual(Object.getPrototypeOf(data.normalizedHeaders), Object.prototype);
                done();
            });
        });

        it('should add the list headers, references and in-reply-to', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                list: {
                    unsubscribe: 'unsub@example.com',
                    help: ['https://example.com/help', 'ftp://example.com/help.txt'],
                    id: { url: 'list.example.com', comment: 'The List' }
                },
                references: ['<r1@example.com>', 'r2@example.com'],
                inReplyTo: 'parent@example.com'
            });

            message.normalize((err, data) => {
                assert.ok(!err);
                assert.strictEqual(data.normalizedHeaders!['list-unsubscribe'], '<mailto:unsub@example.com>');
                assert.strictEqual(data.normalizedHeaders!['list-help'], '<https://example.com/help>, <ftp://example.com/help.txt>');
                assert.strictEqual(data.normalizedHeaders!['list-id'], '"The List" <list.example.com>');
                assert.strictEqual(data.normalizedHeaders!.references, '<r1@example.com> <r2@example.com>');
                assert.strictEqual(data.normalizedHeaders!['in-reply-to'], '<parent@example.com>');
                done();
            });
        });

        it('should pass a content error on', (t, done) => {
            const message = compiled({
                from: 'a@example.com',
                to: 'b@example.com',
                text: { path: path.join(fixtures, 'does-not-exist.txt') }
            });

            message.normalize((err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ENOENT');
                done();
            });
        });
    });

    describe('generated headers', () => {
        const base: SendMailOptions = { from: 'a@example.com', to: 'b@example.com', subject: 'headers', text: 'hi' };

        it('should add the priority headers of a high priority message', async () => {
            const lines = headerLines(await render({ ...base, priority: 'high' }));

            assert.ok(lines.includes('X-Priority: 1 (Highest)'), lines.join('\n'));
            // the header key goes out title-cased by the message
            assert.ok(hasHeader(lines, 'X-MSMail-Priority: High'), lines.join('\n'));
            assert.ok(lines.includes('Importance: High'), lines.join('\n'));
        });

        it('should add the priority headers of a low priority message', async () => {
            const lines = headerLines(await render({ ...base, priority: 'LOW' }));

            assert.ok(lines.includes('X-Priority: 5 (Lowest)'), lines.join('\n'));
            assert.ok(hasHeader(lines, 'X-MSMail-Priority: Low'), lines.join('\n'));
            assert.ok(lines.includes('Importance: Low'), lines.join('\n'));
        });

        it('should not add priority headers for a normal priority', async () => {
            const lines = headerLines(await render({ ...base, priority: 'normal' }));

            assert.ok(!lines.some(line => /^(X-Priority|X-MSMail-Priority|Importance):/.test(line)), lines.join('\n'));
        });

        it('should add the X-Mailer header from xMailer', async () => {
            const lines = headerLines(await render({ ...base, xMailer: 'Test Mailer 1.0' }));

            assert.ok(lines.includes('X-Mailer: Test Mailer 1.0'), lines.join('\n'));
        });
    });

    describe('_formatListUrl', () => {
        it('should wrap urls and addresses in angle brackets', () => {
            const message = new MailMessage(mailer, {});

            assert.strictEqual(message._formatListUrl('https://example.com/u'), '<https://example.com/u>');
            assert.strictEqual(message._formatListUrl('mailto:u@example.com'), '<mailto:u@example.com>');
            assert.strictEqual(message._formatListUrl('ftp://example.com/x'), '<ftp://example.com/x>');
            assert.strictEqual(message._formatListUrl('u@example.com'), '<mailto:u@example.com>');
            assert.strictEqual(message._formatListUrl('example.com/u'), '<http://example.com/u>');
            assert.strictEqual(message._formatListUrl(' <https://example.com/u> '), '<https://example.com/u>');
        });
    });
});
