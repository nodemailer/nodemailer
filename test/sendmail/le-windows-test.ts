import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import LeWindows from '../../src/mime-node/le-windows.js';

describe('Sendmail Windows Newlines', () => {
    it('should rewrite all linebreaks (byte by byte)', (t, done) => {
        const source = 'tere tere\nteine rida\nkolmas rida\r\nneljas rida\r\nviies rida\n kuues rida';

        const chunks: Buffer[] = [];
        const out = new LeWindows();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\r\n'));
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
        const out = new LeWindows();
        out.on('data', chunk => chunks.push(chunk));
        out.on('end', () => {
            assert.strictEqual(Buffer.concat(chunks).toString(), source.replace(/\r?\n/g, '\r\n'));
            done();
        });

        const data = Buffer.from(source);
        out.end(data);
    });
});
