import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import libqp from 'libqp';
import * as qp from '../../src/qp/index.js';
import { seededRandom, transformInChunks } from '../helpers/chunking.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Quoted-Printable Tests', () => {
    const encodeFixtures = [
        ['abcd= ÕÄÖÜ', 'abcd=3D =C3=95=C3=84=C3=96=C3=9C'],
        ['foo bar  ', 'foo bar =20'],
        ['foo bar\t\t', 'foo bar\t=09'],
        ['foo \r\nbar', 'foo=20\r\nbar']
    ];

    const wrapFixtures = [
        ['tere, tere, vana kere, kuidas sul l=C3=A4heb?', 'tere, tere, vana =\r\nkere, kuidas sul =\r\nl=C3=A4heb?'],
        [
            '=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4=C3=A4',
            '=C3=A4=C3=A4=\r\n=C3=A4=C3=A4=\r\n=C3=A4=C3=A4=\r\n=C3=A4=C3=A4=\r\n=C3=A4=C3=A4'
        ],
        ['1234567890123456789=C3=A40', '1234567890123456789=\r\n=C3=A40'],
        ['123456789012345678  90', '123456789012345678 =\r\n 90']
    ];

    const streamFixture = [
        '123456789012345678  90\r\nõäöüõäöüõäöüõäöüõäöüõäöüõäöüõäöü another line === ',
        // written one byte at a time, the output is the same as encoding the input at once: the
        // spaces inside a line stay literal, only the one ending the input is encoded
        '12345678=\r\n90123456=\r\n78  90\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC=\r\n=C3=B5=\r\n=C3=A4=\r\n=C3=B6=\r\n=C3=BC =\r\nanother =\r\nline =3D=\r\n=3D=3D=20'
    ];

    describe('#encode', () => {
        it('shoud encode UTF-8 string to QP', () => {
            encodeFixtures.forEach(test => {
                assert.strictEqual(qp.encode(test[0]), test[1]);
            });
        });

        it('shoud encode Buffer to QP', () => {
            assert.strictEqual(qp.encode(Buffer.from([0x00, 0x01, 0x02, 0x20, 0x03])), '=00=01=02 =03');
        });
    });

    describe('#wrap', () => {
        it('should wrap long QP encoded lines', () => {
            wrapFixtures.forEach(test => {
                assert.strictEqual(qp.wrap(test[0], 20), test[1]);
            });
        });

        it('should wrap line ending with <CR>', () => {
            assert.strictEqual(qp.wrap('alfa palfa kalfa ralfa\r', 10), 'alfa palf=\r\na kalfa =\r\nralfa\r');
        });
    });

    describe('QP Streams', () => {
        it('should transform incoming bytes to QP', (t, done) => {
            const encoder = new qp.Encoder({
                lineLength: 9
            });

            const bytes = Buffer.from(streamFixture[0]);
            let i = 0,
                buf: any = [],
                buflen = 0;

            encoder.on('data', chunk => {
                buf.push(chunk);
                buflen += chunk.length;
            });

            encoder.on('end', (chunk: any) => {
                if (chunk) {
                    buf.push(chunk);
                    buflen += chunk.length;
                }
                buf = Buffer.concat(buf, buflen);

                assert.strictEqual(buf.toString(), streamFixture[1]);
                done();
            });

            const sendNextByte = () => {
                if (i >= bytes.length) {
                    return encoder.end();
                }

                const ord = bytes[i++];
                encoder.write(Buffer.from([ord]));
                setImmediate(sendNextByte);
            };

            sendNextByte();
        });

        it('should transform incoming bytes to QP and back', (t, done) => {
            const decoder = new libqp.Decoder();
            const encoder = new qp.Encoder();
            const file = fs.createReadStream(__dirname + '/fixtures/alice.txt');

            let fhash: any = crypto.createHash('md5');
            let dhash: any = crypto.createHash('md5');

            file.pipe(encoder).pipe(decoder);

            file.on('data', chunk => {
                fhash.update(chunk);
            });

            file.on('end', () => {
                fhash = fhash.digest('hex');
            });

            decoder.on('data', (chunk: any) => {
                dhash.update(chunk);
            });

            decoder.on('end', () => {
                dhash = dhash.digest('hex');
                assert.strictEqual(fhash, dhash);
                done();
            });
        });

        it('should skip an empty chunk', (t, done) => {
            const encoder = new qp.Encoder();
            let output = '';

            encoder.on('data', chunk => {
                output += chunk.toString();
            });

            encoder.on('end', () => {
                assert.strictEqual(output, 'abc');
                assert.strictEqual(encoder.inputBytes, 3);
                assert.strictEqual(encoder.outputBytes, 3);
                done();
            });

            encoder.write(Buffer.alloc(0));
            encoder.write(Buffer.from('abc'));
            encoder.end();
        });

        it('should not wrap lines when lineLength is false', (t, done) => {
            const encoder = new qp.Encoder({ lineLength: false });
            const input = 'õ'.repeat(40);
            let output = '';

            encoder.on('data', chunk => {
                output += chunk.toString();
            });

            encoder.on('end', () => {
                // 40 two byte characters encode to 240 chars, well past the default 76 char line
                assert.strictEqual(output, '=C3=B5'.repeat(40));
                assert.strictEqual(output, qp.encode(input));
                assert.strictEqual(encoder.inputBytes, 80);
                assert.strictEqual(encoder.outputBytes, 240);
                done();
            });

            encoder.end(Buffer.from(input));
        });
    });

    describe('Encoder chunking', () => {
        // text with literal and encoded bytes, runs of whitespace and both kinds of line breaks
        const pieces = ['a', 'b', 'tere', ' ', ' ', '\t', '=', '.', '\r\n', '\n', '\r', 'õ', '€', '😀', '\x00', '\xff'];

        it('round trips and keeps every line within the limit however the input is split', async () => {
            for (let seed = 1; seed <= 200; seed++) {
                const random = seededRandom(seed);
                const parts: Buffer[] = [];
                for (let i = random(400); i > 0; i--) {
                    parts.push(Buffer.from(pieces[random(pieces.length)], pieces[random(pieces.length)] === '\xff' ? 'latin1' : 'utf8'));
                }
                const input = Buffer.concat(parts);
                const lineLength = ([false, 4, 9, 20, 76] as const)[seed % 5];

                const output = // eslint-disable-next-line no-await-in-loop
                    (await transformInChunks(new qp.Encoder({ lineLength }), input, () => 1 + random(lineLength ? 40 : 6))).toString();

                assert.ok(libqp.decode(output).equals(input), `seed ${seed}: does not decode to the input`);
                // whitespace that ends a line or the input would be dropped by a decoder
                assert.ok(!/[ \t](?:\r?\n|\r|$)/.test(output), `seed ${seed}: unencoded whitespace at the end of a line`);
                if (lineLength) {
                    for (const line of output.split(/\r?\n|\r/)) {
                        assert.ok(line.length <= lineLength, `seed ${seed}: line longer than ${lineLength}: ${JSON.stringify(line)}`);
                    }
                }
            }
        });

        it('keeps whitespace inside a line literal when a chunk ends with it', async () => {
            const output = await transformInChunks(new qp.Encoder(), Buffer.from('tere  vana kere'), () => 1);
            assert.strictEqual(output.toString(), 'tere  vana kere');
        });

        it('encodes a large chunk in slices', async () => {
            // a whole Buffer attachment arrives as one chunk, encoding it at once held the input
            // several times over as intermediate strings
            const encoder = new qp.Encoder();
            const pushed: number[] = [];
            encoder.on('data', chunk => pushed.push(chunk.length));
            const input = Buffer.alloc(1024 * 1024, 'tere vana kere õ ');
            const ended = new Promise(resolve => encoder.on('end', resolve));
            encoder.end(input);
            await ended;

            assert.ok(pushed.length > 10, `${pushed.length} pushes`);
            assert.ok(Math.max(...pushed) < 512 * 1024, `largest push ${Math.max(...pushed)} bytes`);
        });
    });

    describe('Binary encoding', () => {
        it('writes a CR or LF outside of a CRLF pair encoded, however the input is split', async () => {
            for (let seed = 1; seed <= 100; seed++) {
                const random = seededRandom(seed);
                // binary data rich in CR, LF and CRLF
                const input = Buffer.alloc(200 + random(800));
                for (let i = 0; i < input.length; i++) {
                    input[i] = [0x0d, 0x0a, 0x20, 0x41, random(256)][random(5)];
                }

                // eslint-disable-next-line no-await-in-loop
                const output = (await transformInChunks(new qp.Encoder({ binary: true }), input, () => 1 + random(40))).toString('latin1');

                assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(output), `seed ${seed}: a lone CR or LF was written as is`);
                assert.ok(libqp.decode(output).equals(input), `seed ${seed}: does not decode to the input`);
                // line endings rewritten on the way, the way a newline transform does, change nothing
                assert.ok(
                    libqp.decode(output.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')).equals(input),
                    `seed ${seed}: changed by a line ending rewrite`
                );
            }
        });

        it('keeps text line breaks literal outside of binary mode', () => {
            assert.strictEqual(qp.encode('a\nb\r\nc'), 'a\nb\r\nc');
        });
    });
});
