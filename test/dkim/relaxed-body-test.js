/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

let fs = require('fs');
let RelaxedBody = require('../../lib/dkim/relaxed-body');

chai.config.includeStack = true;

describe('DKIM RelaxedBody Tests', function () {
    it('Should calculate body hash byte by byte', function (done) {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message) => {
            expect(err).to.not.exist;

            message = message.replace(/\r?\n/g, '\r\n');
            message = message.split('\r\n\r\n');
            message.shift();
            message = message.join('\r\n\r\n');

            message = Buffer.from(message);

            let s = new RelaxedBody({
                hashAlgo: 'sha256',
                debug: true
            });

            s.on('hash', hash => {
                expect(hash).to.equal('D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
                done();
            });

            let pos = 0;
            let stream = () => {
                if (pos >= message.length) {
                    return s.end();
                }
                let ord = Buffer.from([message[pos++]]);
                s.write(ord);
                setImmediate(stream);
            };
            setImmediate(stream);
        });
    });

    it('Should calculate body hash all at once', function (done) {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message) => {
            expect(err).to.not.exist;

            message = message.replace(/\r?\n/g, '\r\n');
            message = message.split('\r\n\r\n');
            message.shift();
            message = message.join('\r\n\r\n');

            message = Buffer.from(message);

            let s = new RelaxedBody({
                hashAlgo: 'sha256',
                debug: true
            });

            s.on('hash', hash => {
                expect(hash).to.equal('D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
                done();
            });

            setImmediate(() => s.end(message));
        });
    });
});
