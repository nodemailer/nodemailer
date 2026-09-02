import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import RelaxedBody from '../../src/dkim/relaxed-body.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
});
