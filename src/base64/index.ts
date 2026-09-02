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
 * Adds soft line breaks to a base64 string
 *
 * @param str base64 encoded string that might need line wrapping
 * @param [lineLength=76] Maximum allowed length for a line
 * @returns Soft-wrapped base64 encoded string
 */
export function wrap(str: string, lineLength?: number | false): string {
    str = (str || '').toString();
    lineLength = lineLength || 76;

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
    lineLength?: number | false;
}

/**
 * Creates a transform stream for encoding data to base64 encoding
 *
 * @constructor
 * @param options Stream options
 * @param [options.lineLength=76] Maximum length for lines, set to false to disable wrapping
 */
export class Encoder extends Transform {
    options: EncoderOptions;
    inputBytes: number;
    outputBytes: number;
    _curLine: string;
    _remainingBytes: Buffer | false;

    constructor(options?: EncoderOptions) {
        super();
        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = this.options.lineLength || 76;
        }

        this._curLine = '';
        this._remainingBytes = false;

        this.inputBytes = 0;
        this.outputBytes = 0;
    }

    override _transform(chunk: Buffer | string, encoding: BufferEncoding | 'buffer', done: TransformCallback): void {
        let buf = encoding !== 'buffer' ? Buffer.from(chunk as string, encoding) : (chunk as Buffer);

        if (!buf || !buf.length) {
            setImmediate(done);
            return;
        }

        this.inputBytes += buf.length;

        if (this._remainingBytes && this._remainingBytes.length) {
            buf = Buffer.concat([this._remainingBytes, buf], this._remainingBytes.length + buf.length);
            this._remainingBytes = false;
        }

        if (buf.length % 3) {
            this._remainingBytes = buf.slice(buf.length - (buf.length % 3));
            buf = buf.slice(0, buf.length - (buf.length % 3));
        } else {
            this._remainingBytes = false;
        }

        let b64 = this._curLine + encode(buf);

        if (this.options.lineLength) {
            b64 = wrap(b64, this.options.lineLength);

            // remove last line as it is still most probably incomplete
            const lastLF = b64.lastIndexOf('\n');
            if (lastLF < 0) {
                this._curLine = b64;
                b64 = '';
            } else if (lastLF === b64.length - 1) {
                this._curLine = '';
            } else {
                this._curLine = b64.substring(lastLF + 1);
                b64 = b64.substring(0, lastLF + 1);
            }
        }

        if (b64) {
            this.outputBytes += b64.length;
            this.push(Buffer.from(b64, 'ascii'));
        }

        setImmediate(done);
    }

    override _flush(done: TransformCallback): void {
        if (this._remainingBytes && this._remainingBytes.length) {
            this._curLine += encode(this._remainingBytes);
        }

        if (this._curLine) {
            this._curLine = wrap(this._curLine, this.options.lineLength);
            this.outputBytes += this._curLine.length;
            this.push(Buffer.from(this._curLine, 'ascii'));
            this._curLine = '';
        }
        done();
    }
}
