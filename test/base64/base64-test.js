/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const libbase64 = require('libbase64');
const base64 = require('../../lib/base64');
const chai = require('chai');
const expect = chai.expect;
const crypto = require('crypto');
const fs = require('fs');

chai.config.includeStack = true;

describe('Base64 Tests', function () {
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

    describe('#encode', function () {
        it('shoud encode UTF-8 string to base64', function () {
            encodeFixtures.forEach(function (test) {
                expect(base64.encode(test[0])).to.equal(test[1]);
            });
        });

        it('shoud encode Buffer to base64', function () {
            expect(base64.encode(Buffer.from([0x00, 0x01, 0x02, 0x20, 0x03]))).to.equal('AAECIAM=');
        });
    });

    describe('#wrap', function () {
        it('should wrap long base64 encoded lines', function () {
            wrapFixtures.forEach(function (test) {
                expect(base64.wrap(test[0], 20)).to.equal(test[1]);
            });
        });
    });

    describe('base64 Streams', function () {
        it('should transform incoming bytes to base64', function (done) {
            let encoder = new base64.Encoder({
                lineLength: 9
            });

            let bytes = Buffer.from(streamFixture[0]),
                i = 0,
                buf = [],
                buflen = 0;

            encoder.on('data', function (chunk) {
                buf.push(chunk);
                buflen += chunk.length;
            });

            encoder.on('end', function (chunk) {
                if (chunk) {
                    buf.push(chunk);
                    buflen += chunk.length;
                }
                buf = Buffer.concat(buf, buflen);

                expect(buf.toString()).to.equal(streamFixture[1]);
                done();
            });

            let sendNextByte = function () {
                if (i >= bytes.length) {
                    return encoder.end();
                }

                let ord = bytes[i++];
                encoder.write(Buffer.from([ord]));
                setImmediate(sendNextByte);
            };

            sendNextByte();
        });

        it('should transform incoming bytes to base64 and back', function (done) {
            let decoder = new libbase64.Decoder();
            let encoder = new base64.Encoder();
            let file = fs.createReadStream(__dirname + '/fixtures/alice.txt');

            let fhash = crypto.createHash('md5');
            let dhash = crypto.createHash('md5');

            file.pipe(encoder).pipe(decoder);

            file.on('data', function (chunk) {
                fhash.update(chunk);
            });

            file.on('end', function () {
                fhash = fhash.digest('hex');
            });

            decoder.on('data', function (chunk) {
                dhash.update(chunk);
            });

            decoder.on('end', function () {
                dhash = dhash.digest('hex');
                expect(fhash).to.equal(dhash);
                done();
            });
        });
    });
});
