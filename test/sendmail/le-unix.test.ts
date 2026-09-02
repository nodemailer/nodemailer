import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import LeUnix from '../../src/mime-node/le-unix.js';

describe('Sendmail Unix Newlines', () => {
    it('should rewrite all linebreaks (byte by byte)', (t, done) => {
        const source = 'tere tere\nteine rida\nkolmas rida\r\nneljas rida\r\nviies rida\n kuues rida';

        const chunks: Buffer[] = [];
        const out = new LeUnix();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\n'));
            done();
        });

        const data = Buffer.from(source);
        let pos = 0;
        const writeNextByte = () => {
            if (pos >= data.length) {
                return out.end();
            }
            out.write(Buffer.from([data[pos++]]));
            setImmediate(writeNextByte);
        };

        setImmediate(writeNextByte);
    });

    it('should rewrite all linebreaks (all at once)', (t, done) => {
        const source = 'tere tere\nteine rida\nkolmas rida\r\nneljas rida\r\nviies rida\n kuues rida';

        const chunks: Buffer[] = [];
        const out = new LeUnix();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\n'));
            done();
        });

        const data = Buffer.from(source);
        out.end(data);
    });
});
