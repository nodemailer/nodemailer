'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

let fs = require('fs');
let RelaxedBody = require('../../lib/dkim/relaxed-body');

describe('DKIM RelaxedBody Tests', () => {
    it('Should calculate body hash byte by byte', (t, done) => {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message) => {
            assert.ok(!err);

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
                assert.strictEqual(hash, 'D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
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

    it('Should calculate body hash all at once', (t, done) => {
        fs.readFile(__dirname + '/fixtures/message1.eml', 'utf-8', (err, message) => {
            assert.ok(!err);

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
                assert.strictEqual(hash, 'D2H5TEwtUgM2u8Ew0gG6vnt/Na6L+Zep7apmSmfy8IQ=');
                done();
            });

            setImmediate(() => s.end(message));
        });
    });
});
