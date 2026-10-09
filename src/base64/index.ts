import { Transform, type TransformCallback } from 'node:stream';

/**
 * Encodes a Buffer into a base64 encoded string
 *
 * @param buffer Buffer to convert
 * @returns base64 encoded string
 */
export function encode(buffer: Buffer | string): string {
    if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer, 'utf-8');
    }

    return buffer.toString('base64');
}

/**
 * Turns a line length option into a whole number of characters, the default for anything unusable
 */
function normalizeLineLength(lineLength: unknown): number {
    const length = Math.floor(Number(lineLength));
    return Number.isFinite(length) && length >= 1 ? length : 76;
}

/**
 * Splits the bytes of `src` into lines of `lineLength` bytes, each followed by a line break. With
 * `final` set the last line, which may be shorter, gets no line break; otherwise only complete
 * lines are taken and the rest is left for the caller
 *
 * @param src Bytes to wrap
 * @param lineLength Line length
 * @param final Whether `src` ends the output
 * @returns The wrapped bytes and the number of trailing bytes not taken
 */
function wrapBuffer(src: Buffer, lineLength: number, final: boolean): { output: Buffer; rest: number } {
    const lines = Math.ceil(src.length / lineLength);
    // the last line waits for more data unless this is the end: whether it gets a line break
    // depends on whether anything follows it
    const complete = Math.max(lines - 1, 0);
    let rest = src.length - complete * lineLength;

    const output = Buffer.allocUnsafe(complete * (lineLength + 2) + (final ? rest : 0));
    let to = 0;
    for (let from = 0; from < complete * lineLength; from += lineLength) {
        src.copy(output, to, from, from + lineLength);
        to += lineLength;
        output[to++] = 0x0d;
        output[to++] = 0x0a;
    }
    if (final) {
        to += src.copy(output, to, complete * lineLength);
        rest = 0;
    }

    if (to !== output.length) {
        // never hand out bytes of the unfilled allocation
        throw new Error('Unexpected wrapped length');
    }

    return { output, rest };
}

/**
 * Adds soft line breaks to a base64 string
 *
 * @param str base64 encoded string that might need line wrapping
 * @param [lineLength=76] Maximum allowed length for a line
 * @returns Soft-wrapped base64 encoded string
 */
export function wrap(str: string, lineLength?: number | false): string {
    str = (str || '').toString();
    // a negative length would step backwards through the input and never finish
    lineLength = Math.max(Number(lineLength) || 76, 1);

    if (str.length <= lineLength) {
        return str;
    }

    const result: string[] = [];
    let pos = 0;
    const chunkLength = lineLength * 1024;
    const wrapRegex = new RegExp('.{' + lineLength + '}', 'g');
    while (pos < str.length) {
        const wrappedLines = str.substr(pos, chunkLength).replace(wrapRegex, '$&\r\n').trim();
        result.push(wrappedLines);
        pos += chunkLength;
    }

    return result.join('\r\n').trim();
}

/**
 * Options for the base64 encoder stream
 */
export interface EncoderOptions {
    /** Maximum length for lines, set to false to disable wrapping */
    lineLength?: number | false | undefined;
}

/**
 * Creates a transform stream for encoding data to base64 encoding
 *
 * The output is the same as `wrap(encode(input), lineLength)` no matter how the input is split
 * into chunks: every line but the last one ends with a line break, the last one does not
 *
 * @constructor
 * @param options Stream options
 * @param [options.lineLength=76] Maximum length for lines, set to false to disable wrapping
 */
export class Encoder extends Transform {
    options: EncoderOptions;
    inputBytes: number;
    outputBytes: number;
    /** Encoded characters of the line that is not complete yet @internal */
    _curLine: string;
    /** Input bytes that do not make up a complete base64 group yet @internal */
    _remainingBytes: Buffer | false;

    constructor(options?: EncoderOptions) {
        super();
        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = normalizeLineLength(this.options.lineLength);
        }

        this._curLine = '';
        this._remainingBytes = false;

        this.inputBytes = 0;
        this.outputBytes = 0;
    }

    /**
     * Emits the encoded characters `b64` that follow the current line, keeping what can not be
     * emitted yet as the new current line
     *
     * @internal
     */
    _emit(b64: string, final: boolean): void {
        const src = Buffer.from(this._curLine + b64, 'latin1');
        if (!src.length) {
            return;
        }

        let output: Buffer = src;
        if (this.options.lineLength) {
            const wrapped = wrapBuffer(src, this.options.lineLength, final);
            output = wrapped.output;
            this._curLine = wrapped.rest ? src.toString('latin1', src.length - wrapped.rest) : '';
        } else {
            this._curLine = '';
        }

        if (output.length) {
            this.outputBytes += output.length;
            this.push(output);
        }
    }

    /** @internal */
    override _transform(chunk: Buffer | string, encoding: BufferEncoding | 'buffer', done: TransformCallback): void {
        let buf = encoding !== 'buffer' ? Buffer.from(chunk as string, encoding) : (chunk as Buffer);

        if (!buf || !buf.length) {
            return done();
        }

        this.inputBytes += buf.length;

        if (this._remainingBytes) {
            buf = Buffer.concat([this._remainingBytes, buf], this._remainingBytes.length + buf.length);
            this._remainingBytes = false;
        }

        const extra = buf.length % 3;
        if (extra) {
            this._remainingBytes = buf.subarray(buf.length - extra);
            buf = buf.subarray(0, buf.length - extra);
        }

        this._emit(encode(buf), false);
        done();
    }

    /** @internal */
    override _flush(done: TransformCallback): void {
        this._emit(this._remainingBytes ? encode(this._remainingBytes) : '', true);
        this._remainingBytes = false;
        done();
    }
}
