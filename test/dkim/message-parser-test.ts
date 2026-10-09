import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

//let http = require('http');
import MessageParser from '../../src/dkim/message-parser.js';

describe('DKIM MessageParser Tests', () => {
    it('should extract header and body', (t, done) => {
        const parser = new MessageParser();
        const message = `From: saatja aadress
To: Saaja aadress
Subject: pealkiri
  mitmel
  real
Message-Id: test

tere tere
teine rida
`;

        const chunks: Buffer[] = [];
        let headers = false;
        let end = false;

        parser.on('data', chunk => {
            chunks.push(chunk);
        });

        parser.on('end', () => {
            end = true;
            const body = Buffer.concat(chunks).toString();
            assert.strictEqual(body, 'tere tere\nteine rida\n');
            if (headers) {
                return done();
            }
        });

        parser.on('headers', data => {
            assert.deepStrictEqual(data, [
                // fix auto format
                {
                    key: 'from',
                    line: 'From: saatja aadress'
                },
                {
                    key: 'to',
                    line: 'To: Saaja aadress'
                },
                {
                    key: 'subject',
                    line: 'Subject: pealkiri\n  mitmel\n  real'
                },
                {
                    key: 'message-id',
                    line: 'Message-Id: test'
                }
            ]);
            headers = true;
            if (end) {
                return done();
            }
        });

        parser.end(Buffer.from(message));
    });
});

describe('DKIM MessageParser edge cases', () => {
    /**
     * Feeds the chunks to a parser and resolves with the headers and the body it produced
     */
    const parse = (chunks: (Buffer | string)[]): Promise<{ headers: any; body: Buffer; rawHeaders: Buffer | false }> =>
        new Promise((resolve, reject) => {
            const parser = new MessageParser();
            const body: Buffer[] = [];
            let headers: any = null;
            parser.on('headers', data => {
                headers = data;
            });
            parser.on('data', chunk => body.push(chunk));
            parser.on('error', reject);
            parser.on('end', () => resolve({ headers, body: Buffer.concat(body), rawHeaders: parser.rawHeaders }));
            for (const chunk of chunks) {
                parser.write(chunk);
            }
            parser.end();
        });

    it('should keep a body of a single byte', async () => {
        const result = await parse(['Subject: x\r\n\r\nA']);
        assert.deepStrictEqual(result.headers, [{ key: 'subject', line: 'Subject: x' }]);
        assert.strictEqual(result.body.toString(), 'A');
    });

    it('should treat a message without an empty line as headers only', async () => {
        const result = await parse(['From: a@example.com\r\nSubject: x']);
        assert.deepStrictEqual(result.headers, [
            { key: 'from', line: 'From: a@example.com' },
            { key: 'subject', line: 'Subject: x' }
        ]);
        assert.strictEqual(result.body.length, 0);
        assert.strictEqual((result.rawHeaders as Buffer).toString(), 'From: a@example.com\r\nSubject: x');
    });

    it('should find the header separator across chunk boundaries', async () => {
        const message = 'From: a@example.com\r\nSubject: x\r\n\r\nbody line\r\n';
        for (let size = 1; size < message.length; size++) {
            const chunks: string[] = [];
            for (let pos = 0; pos < message.length; pos += size) {
                chunks.push(message.slice(pos, pos + size));
            }
            // eslint-disable-next-line no-await-in-loop
            const result = await parse(chunks);
            assert.deepStrictEqual(
                result.headers,
                [
                    { key: 'from', line: 'From: a@example.com' },
                    { key: 'subject', line: 'Subject: x' }
                ],
                'chunk size ' + size
            );
            assert.strictEqual(result.body.toString(), 'body line\r\n', 'chunk size ' + size);
            assert.strictEqual((result.rawHeaders as Buffer).toString(), 'From: a@example.com\r\nSubject: x\r\n\r\n', 'chunk size ' + size);
        }
    });

    it('should accept LF line endings', async () => {
        const result = await parse(['Subject: x\nTo: b@example.com\n\nbody\n']);
        assert.deepStrictEqual(result.headers, [
            { key: 'subject', line: 'Subject: x' },
            { key: 'to', line: 'To: b@example.com' }
        ]);
        assert.strictEqual(result.body.toString(), 'body\n');
    });

    it('should keep header bytes as they are', async () => {
        // a raw 8-bit header is not valid UTF-8, the bytes must reach the signer untouched
        const result = await parse([Buffer.from('Subject: j\xf5geva\r\n\r\n', 'binary')]);
        assert.deepStrictEqual(result.headers, [{ key: 'subject', line: 'Subject: j\xf5geva' }]);
        assert.deepStrictEqual(Buffer.from(result.headers[0].line, 'binary'), Buffer.from('Subject: j\xf5geva', 'binary'));
    });

    it('should lowercase and trim the header key', async () => {
        const result = await parse(['X-Custom : value\r\n\r\n']);
        assert.deepStrictEqual(result.headers, [{ key: 'x-custom', line: 'X-Custom : value' }]);
    });

    it('should keep the whitespace inside a header key', async () => {
        // only the surrounding SP and HTAB come off, the run between the two atoms is part
        // of the name the signature covers
        const result = await parse(['\tX \t Custom : value\r\n\r\n']);
        assert.deepStrictEqual(result.headers, [{ key: 'x \t custom', line: '\tX \t Custom : value' }]);
    });

    it('should unfold a run of continuation lines into a single header', async () => {
        const result = await parse(['To: a@example.com,\r\n b@example.com,\r\n\tc@example.com\r\nSubject: x\r\n\r\n']);
        assert.deepStrictEqual(result.headers, [
            { key: 'to', line: 'To: a@example.com,\n b@example.com,\n\tc@example.com' },
            { key: 'subject', line: 'Subject: x' }
        ]);
    });

    it('should keep a leading continuation line on its own', async () => {
        // there is no preceding header to fold it into, so it stays a line of its own
        const result = await parse([' orphan\r\nSubject: x\r\n\r\n']);
        assert.deepStrictEqual(result.headers, [
            { key: '', line: ' orphan' },
            { key: 'subject', line: 'Subject: x' }
        ]);
    });

    // Unfolding merged each continuation line into the preceding one and then re-tested the
    // anchored /^[ \t]/ against the merged line, which re-flattens a string that grows with
    // every continuation line. A header folded into many lines, most naturally a large
    // recipient list, made signing quadratic: 100k continuation lines took ~8.8s of blocked
    // event loop (GHSA-39m8-27wv-hr27). The budget is far above the linear cost (~20ms) and
    // far below the quadratic one, so it only trips if the unfold regresses.
    it('should unfold a deeply folded header in linear time', async () => {
        const count = 100000;
        const message =
            'From: a@example.com\r\nTo: x@example.com,\r\n' + ' cont-0000@example.com,\r\n'.repeat(count) + 'Subject: x\r\n\r\nbody';

        const started = Date.now();
        const result = await parse([Buffer.from(message, 'binary')]);
        const elapsed = Date.now() - started;

        assert.strictEqual(result.headers.length, 3);
        assert.strictEqual(result.headers[1].key, 'to');
        // the whole folded run collapsed into the single To line
        assert.strictEqual(result.headers[1].line.split('\n').length, count + 1);
        assert.strictEqual(result.body.toString(), 'body');
        assert.ok(elapsed < 5000, `unfolding ${count} continuation lines took ${elapsed}ms`);
    });

    // Trimming the field name with /^[ \t]+|[ \t]+$/g retries the trailing branch at every
    // offset of a blank run that is followed by other text, so a field name carrying one
    // between two atoms was quadratic: 128 KiB of spaces took ~6.7s of blocked event loop.
    // The budget is far above the linear cost (~1ms) and far below the quadratic one.
    it('should trim a field name holding a long blank run in linear time', async () => {
        const run = ' '.repeat(256 * 1024);
        const message = `From: a@example.com\r\nA${run}B: value\r\n\r\nbody`;

        const started = Date.now();
        const result = await parse([Buffer.from(message, 'binary')]);
        const elapsed = Date.now() - started;

        assert.strictEqual(result.headers.length, 2);
        assert.strictEqual(result.headers[1].key, `a${run}b`);
        assert.ok(elapsed < 5000, `trimming a field name around a ${run.length} byte blank run took ${elapsed}ms`);
    });

    it('processes every written chunk synchronously', () => {
        // waiting a macrotask per chunk made a message arriving in small chunks crawl
        const parser = new MessageParser();
        parser.resume();
        parser.write(Buffer.from('Subject: x\r\n\r\nfirst'));
        parser.write(Buffer.from(' second'));
        parser.write(Buffer.from(' third'));
        assert.strictEqual(parser.bodySize, 'first second third'.length);
    });
});
