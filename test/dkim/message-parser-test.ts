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
});
