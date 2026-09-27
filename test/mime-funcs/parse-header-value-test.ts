import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mimeFuncs from '../../src/mime-funcs/index.js';

describe('parseHeaderValue value', () => {
    it('is always a string, also for empty and parameter-only input', () => {
        for (const input of ['', ' ', ';', 'x;', ';a=b', 'a=b', 'text/plain; charset=utf-8', '"quoted;value"; a=b']) {
            const parsed = mimeFuncs.parseHeaderValue(input);
            assert.strictEqual(typeof parsed.value, 'string', JSON.stringify(input));
        }
        assert.strictEqual(mimeFuncs.parseHeaderValue('').value, '');
        assert.strictEqual(mimeFuncs.parseHeaderValue(';a=b').value, '');
        assert.deepStrictEqual(mimeFuncs.parseHeaderValue(';a=b').params, { a: 'b' });
    });
});
