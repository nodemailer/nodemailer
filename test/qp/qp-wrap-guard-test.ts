import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import libqp from 'libqp';
import * as qp from '../../src/qp/index.js';

describe('Quoted-Printable wrap guards', () => {
    const inputs = [
        'a=C3=A9b=C3=A9c',
        '=C3=A9=C3=A9=C3=A9',
        'abc def ghi',
        'a\r\nb',
        '=',
        'ab=C',
        'abcd=C',
        'a'.repeat(78) + '=C',
        'a'.repeat(75) + '=',
        'abcdefghij'.repeat(10)
    ];

    it('terminates for every line length, including ones too short for a soft break', () => {
        for (const input of inputs) {
            for (const lineLength of [-5, 0, 1, 2, 3, 4, 5, 7, 76]) {
                const wrapped = qp.wrap(input, lineLength);
                // the input is unchanged apart from the soft breaks
                assert.strictEqual(wrapped.replace(/[=]\r\n/g, ''), input, `lineLength ${lineLength} for ${JSON.stringify(input)}`);
            }
        }
    });

    it('never splits an encoded byte across a soft break', () => {
        for (const input of inputs) {
            const expected = libqp.decode(input).toString('binary');
            for (const lineLength of [1, 2, 3, 4, 5]) {
                const decoded = libqp.decode(qp.wrap(input, lineLength)).toString('binary');
                assert.strictEqual(decoded, expected, `${JSON.stringify(input)} at lineLength ${lineLength}`);
            }
        }
    });
});
