import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const built = path.join(__dirname, '..', '..', 'dist', 'cjs', 'addressparser', 'index.js');

// The heap a parse of a 400KB header may take, input and result included. The parser used to
// hold a token object for every operator and run of text, a copy of the token list, and an
// array for the tokens of every address on top, all alive until the whole header was done: a
// list of one letter names needed some 77MB, and a 1MB header, which mailparser allows per
// node, some 200MB. The limit leaves the parse twice the room it measures now
const HEAP_LIMIT_MB = 64;

function parseUnderHeapLimit(build: string): { status: number | null; stderr: string } {
    const script = `
        const addressparser = require(${JSON.stringify(built)});
        const input = ${build};
        const result = addressparser(input, { flatten: true });
        process.stdout.write(String(result.length));
    `;
    const child = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_LIMIT_MB}`, '-e', script], { encoding: 'utf-8' });
    return { status: child.status, stderr: (child.stderr || '').slice(-500) };
}

describe('addressparser heap use', () => {
    for (const [label, build] of [
        ['a list of one letter names', `'a,'.repeat(200000)`],
        ['a group of one letter names', `'g: ' + 'a,'.repeat(200000) + ';'`],
        ['a list of named addresses', `'John Example <john.example@example.com>, '.repeat(10000)`]
    ]) {
        it(`should parse a 400KB header of ${label} within ${HEAP_LIMIT_MB}MB of heap`, () => {
            const { status, stderr } = parseUnderHeapLimit(build);
            assert.strictEqual(status, 0, stderr);
        });
    }
});
