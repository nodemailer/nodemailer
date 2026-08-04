'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('../../lib/nodemailer');

// Regression tests for GHSA-268h-hp4c-crq3: CRLF in a `list.*.comment` field
// must not be emitted as a real header boundary in the generated message.
describe('List-* header comment CRLF injection', () => {
    const send = data => {
        const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
        return new Promise((resolve, reject) => {
            transport.sendMail(data, (err, info) => (err ? reject(err) : resolve(info.message.toString('utf8'))));
        });
    };

    const listKeys = ['help', 'unsubscribe', 'subscribe', 'post', 'owner', 'archive', 'id'];

    listKeys.forEach(key => {
        it('should not allow header injection via list.' + key + '.comment', async () => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list ' + key,
                list: {
                    [key]: {
                        url: key === 'id' ? 'example.test' : 'https://example.test/' + key,
                        comment: 'comment\r\nX-Injected-' + key + ': yes'
                    }
                },
                text: 'body'
            });

            // the injected marker must not appear at the start of its own header line
            assert.ok(!new RegExp('\\r\\nX-Injected-' + key + ': yes').test(raw), 'CRLF injected a standalone header for list.' + key);
            // and the (sanitized) comment text is still carried inside the List-* header
            assert.ok(new RegExp('^List-' + key + ':', 'im').test(raw));
        });
    });

    // Regression tests: the scheme-stripping regex used the invalid quantifier `{,2}`
    // (literal in JavaScript), so List-ID kept the `http://` prefix added by
    // _formatListUrl and violated the RFC 2919 `<domain>` form.
    describe('List-ID formatting', () => {
        it('should format a bare domain as <domain>', async () => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list id',
                list: { id: 'mylist.example.test' },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-ID:/i.test(l));
            assert.ok(line);
            assert.ok(line.includes('<mylist.example.test>'), 'expected bare domain form, got: ' + line);
            assert.ok(!line.includes('http://'), 'scheme prefix must be stripped: ' + line);
        });

        it('should strip the scheme from an url form and keep the comment', async () => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list id',
                list: { id: { url: 'https://mylist.example.test', comment: 'My List' } },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-ID:/i.test(l));
            assert.ok(line);
            assert.ok(line.includes('"My List" <mylist.example.test>'), 'expected comment + bare domain, got: ' + line);
        });
    });

    // A comment is inserted into a quoted-string (List-ID) or an RFC 5322 comment
    // (every other List-* header), so the specials of the surrounding construct have
    // to be emitted as quoted-pairs. Stripping CR/LF alone is not enough: without the
    // escaping the comment ends early, never ends, or is read back as different text.
    describe('List-* header comment escaping', () => {
        const listIdValue = async comment => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list id',
                list: { id: { url: 'mylist.example.test', comment } },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-ID:/i.test(l));
            assert.ok(line, 'no List-ID header');
            return line;
        };

        it('should escape a quote in a List-ID comment', async () => {
            // an unescaped quote ends the quoted-string early, so everything after it,
            // including the <domain>, is no longer where the grammar expects it
            assert.strictEqual(await listIdValue('a"b'), 'List-ID: "a\\"b" <mylist.example.test>');
        });

        it('should escape a trailing backslash in a List-ID comment', async () => {
            // a raw trailing backslash escapes the closing quote, so the quoted-string
            // runs on and swallows the <domain> that identifies the list
            assert.strictEqual(await listIdValue('x\\'), 'List-ID: "x\\\\" <mylist.example.test>');
        });

        it('should escape a backslash inside a List-ID comment', async () => {
            // an unescaped backslash is a quoted-pair, so the receiver reads back "ab"
            assert.strictEqual(await listIdValue('a\\b'), 'List-ID: "a\\\\b" <mylist.example.test>');
        });

        const listUrlValue = async comment => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list unsubscribe',
                list: { unsubscribe: { url: 'https://example.test/u', comment } },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-Unsubscribe:/i.test(l));
            assert.ok(line, 'no List-Unsubscribe header');
            return line;
        };

        it('should escape a closing parenthesis in a List-* comment', async () => {
            // an unescaped ")" closes the comment early and leaves the remainder as junk
            assert.strictEqual(await listUrlValue('a)b'), 'List-Unsubscribe: <https://example.test/u> (a\\)b)');
        });

        it('should escape an opening parenthesis in a List-* comment', async () => {
            // comments nest, so an unpaired "(" opens one that is never closed
            assert.strictEqual(await listUrlValue('a(b'), 'List-Unsubscribe: <https://example.test/u> (a\\(b)');
        });

        it('should escape a trailing backslash in a List-* comment', async () => {
            assert.strictEqual(await listUrlValue('x\\'), 'List-Unsubscribe: <https://example.test/u> (x\\\\)');
        });

        it('should not let a comment swallow a following url in the same header', async () => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list unsubscribe',
                // both entries share one header, joined with ", "
                list: { unsubscribe: [[{ url: 'https://example.test/u', comment: 'x\\' }, { url: 'mailto:u@example.test' }]] },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-Unsubscribe:/i.test(l));
            // the trailing backslash used to escape the ")", leaving an unterminated
            // comment that consumed the mailto: entry
            assert.strictEqual(line, 'List-Unsubscribe: <https://example.test/u> (x\\\\), <mailto:u@example.test>');
        });

        it('should not escape anything in a non-plaintext comment', async () => {
            // a non-ascii comment becomes an encoded word, which has no specials to escape
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list unsubscribe',
                list: { unsubscribe: { url: 'https://example.test/u', comment: 'ünsubscribe' } },
                text: 'body'
            });

            const line = raw.split('\r\n').find(l => /^List-Unsubscribe:/i.test(l));
            assert.strictEqual(line, 'List-Unsubscribe: <https://example.test/u> (=?UTF-8?Q?=C3=BCnsubscribe?=)');
        });

        it('should encode a DEL in a List-* comment', async () => {
            // DEL is neither qtext nor ctext, so escaping can not save it and it has to
            // become an encoded word the same way a non-ascii comment does
            assert.strictEqual(await listIdValue('a\x7fb'), 'List-ID: =?UTF-8?Q?a=7Fb?= <mylist.example.test>');
            assert.strictEqual(await listUrlValue('a\x7fb'), 'List-Unsubscribe: <https://example.test/u> (=?UTF-8?Q?a=7Fb?=)');
        });
    });

    it('should keep a benign comment intact in the List-* header', async () => {
        const raw = await send({
            from: 'sender@example.test',
            to: 'recipient@example.test',
            subject: 'benign',
            list: { unsubscribe: { url: 'https://example.test/u', comment: 'Unsubscribe here' } },
            text: 'body'
        });

        const line = raw.split('\r\n').find(l => /^List-Unsubscribe:/.test(l));
        assert.ok(line);
        assert.ok(line.includes('(Unsubscribe here)'));
    });
});
