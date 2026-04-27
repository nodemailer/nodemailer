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

    let wrapFixtures = [
        ['dGVyZSwgdGVyZSwgdmFuYSBrZXJlLCBrdWlkYXMgc3VsIGzDpGhlYj8=', 'dGVyZSwgdGVyZSwgdmFu\r\nYSBrZXJlLCBrdWlkYXMg\r\nc3VsIGzDpGhlYj8=']
    ];

    let exactMultipleBase64 = 'A'.repeat(152);

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

        it('should not emit a trailing CRLF when input is an exact multiple of lineLength', () => {
            const wrapped = base64.wrap(exactMultipleBase64, 76);
            assert.strictEqual(wrapped, 'A'.repeat(76) + '\r\n' + 'A'.repeat(76));
        });

        it('should preserve content and never emit trailing whitespace across single- and cross-chunk inputs', () => {
            // lineLength=8 -> chunkLength = 8 * 1024 = 8192. Sweep covers:
            // sub-lineLength, single-chunk exact/non-exact, single-chunk boundary,
            // cross-chunk boundary, and 2x-cross-chunk exact-multiple.
            const lineLength = 8;
            const sizes = [1, 7, 8, 9, 15, 16, 17, 8191, 8192, 8193, 16383, 16384, 16385];

            sizes.forEach(n => {
                const input = 'A'.repeat(n);
                const wrapped = base64.wrap(input, lineLength);

                assert.ok(!/[\r\n]$/.test(wrapped), `size ${n}: output ends in CR/LF`);
                assert.strictEqual(wrapped.split('\r\n').join(''), input, `size ${n}: content not preserved`);
                wrapped.split('\r\n').forEach(line => {
                    assert.ok(line.length <= lineLength, `size ${n}: line ${line.length} > ${lineLength}`);
                });
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

            // 5 bytes -> 8 base64 chars, below lineLength -> no wrapping expected.
            const input = Buffer.from('12345');
            let output = Buffer.alloc(0);

            encoder.on('data', chunk => {
                output = Buffer.concat([output, chunk]);
            });

            encoder.on('end', () => {
                assert.strictEqual(output.toString(), 'MTIzNDU=');
                done();
            });

            encoder.write(input);
            encoder.end();
        });

        it('should not emit a trailing CRLF when stream output is an exact multiple of lineLength', (t, done) => {
            // 114 bytes -> 152 base64 chars = 2 * lineLength(76).
            const encoder = new base64.Encoder({ lineLength: 76 });
            const input = Buffer.alloc(114, 0x61);
            let output = Buffer.alloc(0);

            encoder.on('data', chunk => {
                output = Buffer.concat([output, chunk]);
            });

            encoder.on('end', () => {
                const result = output.toString();
                assert.ok(!result.endsWith('\r\n'), 'base64 stream output must not end with CRLF');
                assert.strictEqual(result, 'YWFh'.repeat(19) + '\r\n' + 'YWFh'.repeat(19));
                done();
            });

            encoder.end(input);
        });

        it('should not emit a trailing CRLF when two writes combine to an exact multiple of lineLength', (t, done) => {
            // After write 1: encode(57 bytes)=76 b64 chars, all stashed in _curLine, nothing pushed.
            // After write 2: _curLine + encode(57)=152 chars (2 * 76) -> exercises the
            // last-LF split path with a CRLF-terminated wrap result, plus a non-empty _curLine
            // at flush time.
            const encoder = new base64.Encoder({ lineLength: 76 });
            const half = Buffer.alloc(57, 0x61);
            let output = Buffer.alloc(0);

            encoder.on('data', chunk => {
                output = Buffer.concat([output, chunk]);
            });

            encoder.on('end', () => {
                const result = output.toString();
                assert.ok(!result.endsWith('\r\n'), 'base64 stream output must not end with CRLF');
                assert.strictEqual(result, 'YWFh'.repeat(19) + '\r\n' + 'YWFh'.repeat(19));
                done();
            });

            encoder.write(half);
            encoder.end(half);
        });
    });
});
