import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import RelaxedBody from '../../src/dkim/relaxed-body.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs a body through RelaxedBody in the given chunks and resolves with the hash
 * and the canonicalized body
 */
const hashChunks = (chunks: Buffer[]): Promise<{ hash: string; body: string }> =>
    new Promise((resolve, reject) => {
        const s = new RelaxedBody({ hashAlgo: 'sha256', debug: true });
        let result: { hash: string; body: string };
        s.on('hash', (hash: string, body: Buffer) => {
            result = { hash, body: body.toString('binary') };
        });
        s.on('error', reject);
        s.on('end', () => resolve(result));
        s.resume();
        for (const chunk of chunks) {
            s.write(chunk);
        }
        s.end();
    });

const hashOf = (body: string): string => crypto.createHash('sha256').update(Buffer.from(body, 'binary')).digest('base64');

/**
 * Line based reference of RFC 6376 section 3.4.4: the CR of a terminated line is part of
 * the line ending, a CR at the end of an unterminated last line is content
 */
const reference = (body: string): string => {
    const lines = body.split('\n');
    const last = lines.pop() as string;
    const canon = (line: string) => line.replace(/[ \t]+/g, ' ').replace(/ $/, '');
    const out = lines.map(line => canon(line.replace(/\r$/, '')));
    const tail = canon(last);
    if (tail) {
        out.push(tail);
    }
    while (out.length && out[out.length - 1] === '') {
        out.pop();
    }
    return out.length ? out.join('\r\n') + '\r\n' : '';
};

// small deterministic PRNG (Park-Miller minimal standard) so a failure is reproducible
const prng = (seed: number) => () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
};

describe('DKIM RelaxedBody Tests', () => {
    it('Should calculate body hash byte by byte', (t, done) => {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message: any) => {
            assert.ok(!err);

            message = message.replace(/\r?\n/g, '\r\n');
            message = message.split('\r\n\r\n');
            message.shift();
            message = message.join('\r\n\r\n');

            message = Buffer.from(message);

            const s = new RelaxedBody({
                hashAlgo: 'sha256',
                debug: true
            });

            s.on('hash', hash => {
                assert.strictEqual(hash, 'D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
                done();
            });

            let pos = 0;
            const stream = () => {
                if (pos >= message.length) {
                    return s.end();
                }
                const ord = Buffer.from([message[pos++]]);
                s.write(ord);
                setImmediate(stream);
            };
            setImmediate(stream);
        });
    });

    it('Should calculate body hash all at once', (t, done) => {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message: any) => {
            assert.ok(!err);

            message = message.replace(/\r?\n/g, '\r\n');
            message = message.split('\r\n\r\n');
            message.shift();
            message = message.join('\r\n\r\n');

            message = Buffer.from(message);

            const s = new RelaxedBody({
                hashAlgo: 'sha256',
                debug: true
            });

            s.on('hash', hash => {
                assert.strictEqual(hash, 'D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
                done();
            });

            setImmediate(() => s.end(message));
        });
    });

    it('should pass the original body through unchanged', (t, done) => {
        const s = new RelaxedBody();
        const chunks: Buffer[] = [];
        s.on('data', chunk => chunks.push(chunk));
        s.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), 'a  b \t\r\n\r\n  \r\n');
            done();
        });
        s.end('a  b \t\r\n\r\n  \r\n');
    });

    describe('canonicalization', () => {
        // each case is [description, body, canonicalized body]
        const cases: [string, string, string][] = [
            ['empty body', '', ''],
            ['single empty line', '\r\n', ''],
            ['only empty lines', '\r\n\r\n\r\n', ''],
            ['only bare LF empty lines', '\n\n\n', ''],
            ['only whitespace', '  \t ', ''],
            ['whitespace only lines', ' \r\n\t\r\n', ''],
            ['body without a final line break gets one', 'abc', 'abc\r\n'],
            ['final line break is kept', 'abc\r\n', 'abc\r\n'],
            ['trailing empty lines are dropped', 'abc\r\n\r\n\r\n', 'abc\r\n'],
            ['trailing whitespace only lines are dropped', 'abc\r\n  \r\n\t\r\n', 'abc\r\n'],
            ['trailing whitespace on the last line', 'abc  \t', 'abc\r\n'],
            ['trailing whitespace on a line', 'abc \t\r\ndef', 'abc\r\ndef\r\n'],
            ['bare LF becomes CRLF', 'abc\ndef\n', 'abc\r\ndef\r\n'],
            ['leading bare LF', '\nabc', '\r\nabc\r\n'],
            ['runs of whitespace become a single space', 'a \t b  c\td', 'a b c d\r\n'],
            ['leading whitespace is kept as a single space', ' \t abc', ' abc\r\n'],
            ['empty lines between content are kept', 'a\r\n\r\n \r\nb', 'a\r\n\r\n\r\nb\r\n'],
            ['CR that is not part of a line ending is content', 'a\rb\r\n', 'a\rb\r\n'],
            ['CR at the end of the body is content', 'abc\r', 'abc\r\r\n'],
            ['CR before the line ending CR is content', 'abc\r\r\n', 'abc\r\r\n'],
            ['whitespace before a content CR is kept as a space', 'ab \rc', 'ab \rc\r\n'],
            ['non-ASCII bytes are kept', 'j\xc3\xb5geva\r\n', 'j\xc3\xb5geva\r\n']
        ];

        for (const [name, body, expected] of cases) {
            it(name, async () => {
                const result = await hashChunks([Buffer.from(body, 'binary')]);
                assert.strictEqual(result.body, expected);
                assert.strictEqual(result.hash, hashOf(expected));
            });
        }

        it('should not depend on chunk boundaries', async () => {
            const body = 'a \r\n\r\n  \r\nb\t\tc \n\r\nd\r\n \r\n';
            const expected = 'a\r\n\r\n\r\nb c\r\n\r\nd\r\n';
            const bytes = Buffer.from(body, 'binary');

            const whole = await hashChunks([bytes]);
            assert.strictEqual(whole.body, expected);

            for (let size = 1; size < bytes.length; size++) {
                const chunks: Buffer[] = [];
                for (let pos = 0; pos < bytes.length; pos += size) {
                    chunks.push(bytes.subarray(pos, pos + size));
                }
                // eslint-disable-next-line no-await-in-loop
                const result = await hashChunks(chunks);
                assert.strictEqual(result.body, expected, 'chunk size ' + size);
            }
        });

        it('should match the line based reference for generated bodies', async () => {
            const random = prng(20260902);
            const pick = (n: number) => Math.floor(random() * n);
            const alphabet = ['a', 'b', ' ', ' ', '\t', '\r\n', '\r\n', '\n', '\r'];

            for (let i = 0; i < 1500; i++) {
                let body = '';
                const len = pick(24);
                for (let j = 0; j < len; j++) {
                    body += alphabet[pick(alphabet.length)];
                }
                const bytes = Buffer.from(body, 'binary');
                const chunks: Buffer[] = [];
                for (let pos = 0; pos < bytes.length;) {
                    const size = 1 + pick(5);
                    chunks.push(bytes.subarray(pos, pos + size));
                    pos += size;
                }

                const expected = reference(body);
                // eslint-disable-next-line no-await-in-loop
                const result = await hashChunks(chunks);
                assert.strictEqual(result.body, expected, 'body ' + JSON.stringify(body));
            }
        });

        it('should hash a line larger than the highWaterMark', async () => {
            const line = 'x'.repeat(200 * 1024);
            const result = await hashChunks(Array(5).fill(Buffer.from(line)));
            assert.strictEqual(result.hash, hashOf(line.repeat(5) + '\r\n'));
        });
    });
});
