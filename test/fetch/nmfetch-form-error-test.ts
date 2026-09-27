import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nmfetch from '../../src/fetch/index.js';

describe('nmfetch form body errors', () => {
    it('reports a form value that can not be encoded through the error event of the returned stream', (t, done) => {
        // an unpaired surrogate makes encodeURIComponent throw, nothing is ever connected to
        const res = nmfetch('http://127.0.0.1:1/', { body: { text: '\ud800' } });
        assert.ok(res, 'the stream is handed back');
        res.on('error', err => {
            assert.strictEqual((err as NodeJS.ErrnoException).code, 'EFETCH');
            // the message of the URIError differs between runtimes, the name does not
            assert.strictEqual(err.name, 'URIError');
            done();
        });
    });
});
