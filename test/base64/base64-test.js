'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const libbase64 = require('libbase64');
const base64 = require('../../lib/base64');
const crypto = require('crypto');
const fs = require('fs');

describe('Base64 Tests', () => {
    let encodeFixtures = [
        ['abcd= ÕÄÖÜ', 'YWJjZD0gw5XDhMOWw5w='],
        ['foo bar  ', 'Zm9vIGJhciAg'],
        ['foo bar\t\t', 'Zm9vIGJhcgkJ'],
        ['foo \r\nbar', 'Zm9vIA0KYmFy']
    ];

    let wrapFixtures = [['dGVyZSwgdGVyZSwgdmFuYSBrZXJlLCBrdWlkYXMgc3VsIGzDpGhlYj8=', 'dGVyZSwgdGVyZSwgdmFu\r\nYSBrZXJlLCBrdWlkYXMg\r\nc3VsIGzDpGhlYj8=']];

    let streamFixture = [
        '123456789012345678  90\r\nõäöüõäöüõäöüõäöüõäöüõäöüõäöüõäöü another line === ',
        'MTIzNDU2N\r\nzg5MDEyMz\r\nQ1Njc4ICA\r\n5MA0Kw7XD\r\npMO2w7zDt\r\ncOkw7bDvM\r\nO1w6TDtsO\r\n8w7XDpMO2\r\nw7zDtcOkw\r\n7bDvMO1w6\r\nTDtsO8w7X\r\nDpMO2w7zD\r\ntcOkw7bDv\r\nCBhbm90aG\r\nVyIGxpbmU\r\ngPT09IA=='
    ];

    describe('#encode', () => {
        it('shoud encode UTF-8 string to base64', () => {
            encodeFixtures.forEach(test => {
                assert.strictEqual(base64.encode(test[0]), test[1]);
            });
        });

        it('shoud encode Buffer to base64', () => {
            assert.strictEqual(base64.encode(Buffer.from([0x00, 0x01, 0x02, 0x20, 0x03])), 'AAECIAM=');
        });
    });

    describe('#wrap', () => {
        it('should wrap long base64 encoded lines', () => {
            wrapFixtures.forEach(test => {
                assert.strictEqual(base64.wrap(test[0], 20), test[1]);
            });
        });
    });

    describe('base64 Streams', () => {
        it('should transform incoming bytes to base64', (t, done) => {
            let encoder = new base64.Encoder({
                lineLength: 9
            });

            let bytes = Buffer.from(streamFixture[0]),
                i = 0,
                buf = [],
                buflen = 0;

            encoder.on('data', chunk => {
                buf.push(chunk);
                buflen += chunk.length;
            });

            encoder.on('end', chunk => {
                if (chunk) {
                    buf.push(chunk);
                    buflen += chunk.length;
                }
                buf = Buffer.concat(buf, buflen);

                assert.strictEqual(buf.toString(), streamFixture[1]);
                done();
            });

            let sendNextByte = () => {
                if (i >= bytes.length) {
                    return encoder.end();
                }

                let ord = bytes[i++];
                encoder.write(Buffer.from([ord]));
                setImmediate(sendNextByte);
            };

            sendNextByte();
        });

        it('should transform incoming bytes to base64 and back', (t, done) => {
            let decoder = new libbase64.Decoder();
            let encoder = new base64.Encoder();
            let file = fs.createReadStream(__dirname + '/fixtures/alice.txt');

            let fhash = crypto.createHash('md5');
            let dhash = crypto.createHash('md5');

            file.pipe(encoder).pipe(decoder);

            file.on('data', chunk => {
                fhash.update(chunk);
            });

            file.on('end', () => {
                fhash = fhash.digest('hex');
            });

            decoder.on('data', chunk => {
                dhash.update(chunk);
            });

            decoder.on('end', () => {
                dhash = dhash.digest('hex');
                assert.strictEqual(fhash, dhash);
                done();
            });
        });

        it('should flush incomplete trailing base64 chunks correctly', (t, done) => {
            const encoder = new base64.Encoder({ lineLength: 10 });

            // Prepare a buffer of 5 bytes, which encodes to 8 base64 characters.
            // This length is below the specified lineLength (10), so no wrapping should occur.
            const input = Buffer.from('12345');
            let output = Buffer.alloc(0);

            encoder.on('data', chunk => {
                // Accumulate the data chunks emitted by the base64 encoder stream.
                output = Buffer.concat([output, chunk]);
            });

            encoder.on('end', () => {
                const result = output.toString();

                /**
                 * The string "12345" encoded in base64 is "MTIzNDU=".
                 * Since the output length (8 characters) is less than the lineLength (10),
                 * the encoder should not insert any line breaks.
                 *
                 * This test verifies that any incomplete trailing base64 data
                 * held internally in `_curLine` is correctly flushed and emitted
                 * when the stream ends, preventing silent data loss.
                 */
                assert.strictEqual(result, 'MTIzNDU=');
                done();
            });

            encoder.write(input);
            encoder.end(); // triggers the _flush method
        });
        it('should handle large payload efficiently', (t, done) => {
            const encoder = new base64.Encoder({ lineLength: 76 });
            const largeData = crypto.randomBytes(370 * 1024 * 1024); // 370 MB

            const start = Date.now();
            encoder.write(largeData);
            encoder.end();

            let outputSize = 0;
            encoder.on('data', chunk => {
                outputSize += chunk.length;
            });

            encoder.on('end', () => {
                const duration = Date.now() - start;
                console.log(`Encoded 100MB in ${duration}ms`);

                const base64Size = Math.ceil(largeData.length / 3) * 4;
                const numberOfLines = Math.ceil(base64Size / 76);
                const expectedSize = base64Size + (numberOfLines - 1) * 2;

                assert.strictEqual(outputSize, expectedSize);
                done();
            });
        });
    });
});
