import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as base64 from '../../src/base64/index.js';

describe('Base64 wrap guards', () => {
    it('terminates for a negative or zero line length and keeps the content', () => {
        const input = base64.encode('tere tere vana kere'.repeat(20));
        for (const lineLength of [-10, -1, 0, 1, 2, 76]) {
            const wrapped = base64.wrap(input, lineLength);
            assert.strictEqual(wrapped.replace(/\r\n/g, ''), input, `lineLength ${lineLength}`);
        }
        assert.strictEqual(base64.wrap(input, 0), base64.wrap(input, 76));
    });
});
