'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LeUnix = require('../../lib/mime-node/le-unix');

describe('Sendmail Unix Newlines', () => {
    it('should rewrite all linebreaks (byte by byte)', (t, done) => {
        let source = 'tere tere\nteine rida\nkolmas rida\r\nneljas rida\r\nviies rida\n kuues rida';

        let chunks = [];
        let out = new LeUnix();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\n'));
            done();
        });

        let data = Buffer.from(source);
        let pos = 0;
        let writeNextByte = () => {
            if (pos >= data.length) {
                return out.end();
            }
            out.write(Buffer.from([data[pos++]]));
            setImmediate(writeNextByte);
        };

        setImmediate(writeNextByte);
    });

    it('should rewrite all linebreaks (all at once)', (t, done) => {
        let source = 'tere tere\nteine rida\nkolmas rida\r\nneljas rida\r\nviies rida\n kuues rida';

        let chunks = [];
        let out = new LeUnix();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\n'));
            done();
        });

        let data = Buffer.from(source);
        out.end(data);
    });
});
