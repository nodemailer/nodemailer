/**
 * DataStream turns a message into the byte stream sent after the DATA command:
 * every line break becomes CRLF, lines starting with a dot get a second dot
 * (RFC 5321 section 4.5.2) and the stream ends with the terminating dot line.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TransformOptions } from 'node:stream';
import DataStream from '../../src/smtp-connection/data-stream.js';

interface EncodedResult {
    output: Buffer;
    stream: DataStream;
}

/**
 * Writes the chunks to a fresh DataStream, one write per chunk, and collects the output
 */
function encode(chunks: Array<string | Buffer>, options?: TransformOptions): Promise<EncodedResult> {
    return new Promise((resolve, reject) => {
        const stream = new DataStream(options);
        const parts: Buffer[] = [];

        stream.on('data', chunk => parts.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve({ output: Buffer.concat(parts), stream }));

        for (const chunk of chunks) {
            stream.write(chunk);
        }
        stream.end();
    });
}

describe('DataStream', () => {
    describe('Termination', () => {
        it('ends a message that already ends with CRLF with a single dot line', async () => {
            const { output } = await encode(['Subject: test\r\n\r\nhello\r\n']);
            assert.strictEqual(output.toString(), 'Subject: test\r\n\r\nhello\r\n.\r\n');
        });

        it('adds the missing line break before the terminating dot', async () => {
            const { output } = await encode(['hello']);
            assert.strictEqual(output.toString(), 'hello\r\n.\r\n');
        });

        it('completes a trailing bare CR before terminating', async () => {
            const { output } = await encode(['hello\r']);
            assert.strictEqual(output.toString(), 'hello\r\n.\r\n');
        });

        it('terminates an empty message with a bare dot line', async () => {
            const { output } = await encode([]);
            assert.strictEqual(output.toString(), '\r\n.\r\n');
        });
    });

    describe('Line breaks', () => {
        it('converts bare LF line breaks to CRLF', async () => {
            const { output } = await encode(['line 1\nline 2\n\nline 4']);
            assert.strictEqual(output.toString(), 'line 1\r\nline 2\r\n\r\nline 4\r\n.\r\n');
        });

        it('keeps existing CRLF pairs as they are', async () => {
            const { output } = await encode(['line 1\r\nline 2\r\n']);
            assert.strictEqual(output.toString(), 'line 1\r\nline 2\r\n.\r\n');
        });

        it('does not double a CRLF pair that is split across chunks', async () => {
            const { output } = await encode(['line 1\r', '\nline 2']);
            assert.strictEqual(output.toString(), 'line 1\r\nline 2\r\n.\r\n');
        });

        it('converts an LF at the start of a chunk when the previous chunk did not end with CR', async () => {
            const { output } = await encode(['line 1', '\nline 2']);
            assert.strictEqual(output.toString(), 'line 1\r\nline 2\r\n.\r\n');
        });

        it('leaves a lone CR inside a line alone', async () => {
            const { output } = await encode(['a\rb\r\n']);
            assert.strictEqual(output.toString(), 'a\rb\r\n.\r\n');
        });
    });

    describe('Dot stuffing', () => {
        it('doubles a dot at the start of a line', async () => {
            const { output } = await encode(['first\r\n.second\r\n..third\r\n']);
            assert.strictEqual(output.toString(), 'first\r\n..second\r\n...third\r\n.\r\n');
        });

        it('doubles a dot at the very start of the message', async () => {
            const { output } = await encode(['.hidden']);
            assert.strictEqual(output.toString(), '..hidden\r\n.\r\n');
        });

        it('escapes a line that consists of a single dot', async () => {
            const { output } = await encode(['before\n.\nafter']);
            assert.strictEqual(output.toString(), 'before\r\n..\r\nafter\r\n.\r\n');
        });

        it('doubles a dot at the start of a chunk that follows a line break', async () => {
            const { output } = await encode(['first\n', '.second']);
            assert.strictEqual(output.toString(), 'first\r\n..second\r\n.\r\n');
        });

        it('does not touch a dot at the start of a chunk in the middle of a line', async () => {
            const { output } = await encode(['first', '.second']);
            assert.strictEqual(output.toString(), 'first.second\r\n.\r\n');
        });

        it('does not touch dots inside a line', async () => {
            const { output } = await encode(['a.b.c\r\n']);
            assert.strictEqual(output.toString(), 'a.b.c\r\n.\r\n');
        });

        it('does not escape a dot that follows a lone CR', async () => {
            // only LF ends a line, so "\r." is still the same line
            const { output } = await encode(['first\r.second']);
            assert.strictEqual(output.toString(), 'first\r.second\r\n.\r\n');
        });
    });

    describe('Input handling', () => {
        it('ignores empty chunks', async () => {
            const { output, stream } = await encode([Buffer.alloc(0), 'hello', Buffer.alloc(0)]);
            assert.strictEqual(output.toString(), 'hello\r\n.\r\n');
            assert.strictEqual(stream.inByteCount, 5);
        });

        it('accepts string chunks when decodeStrings is disabled', async () => {
            const { output } = await encode(['first\n.second'], { decodeStrings: false });
            assert.strictEqual(output.toString(), 'first\r\n..second\r\n.\r\n');
        });

        it('passes 8-bit content through unchanged', async () => {
            const input = Buffer.from([0xc3, 0xb6, 0x0a, 0x2e, 0xff]);
            const { output } = await encode([input]);
            assert.deepStrictEqual([...output], [0xc3, 0xb6, 0x0d, 0x0a, 0x2e, 0x2e, 0xff, 0x0d, 0x0a, 0x2e, 0x0d, 0x0a]);
        });

        it('tracks the input and output byte counts', async () => {
            const { output, stream } = await encode(['a\n', '.b']);
            assert.strictEqual(output.toString(), 'a\r\n..b\r\n.\r\n');
            assert.strictEqual(stream.inByteCount, 4);
            assert.strictEqual(stream.outByteCount, output.length);
            assert.strictEqual(stream.outByteCount, 11);
        });

        it('counts unmodified chunks as well', async () => {
            const { output, stream } = await encode(['plain\r\n']);
            assert.strictEqual(stream.inByteCount, 7);
            assert.strictEqual(stream.outByteCount, output.length);
            assert.strictEqual(stream.outByteCount, 10);
        });
    });
});
