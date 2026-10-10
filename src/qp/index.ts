import { Transform, type TransformCallback } from 'node:stream';

/**
 * Encodes a Buffer into a Quoted-Printable encoded string
 *
 * @param buffer Buffer to convert
 * @returns Quoted-Printable encoded string
 */
// the shortest line wrap() can make progress with: a complete =XX sequence and the soft break
const MIN_LINE_LENGTH = 4;

// usable characters that do not need encoding
// https://tools.ietf.org/html/rfc2045#section-6.7
const QP_RANGES = [
    [0x09], // <TAB>
    [0x0a], // <LF>
    [0x0d], // <CR>
    [0x20, 0x3c], // <SP>!"#$%&'()*+,-./0123456789:;
    [0x3e, 0x7e] // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
];

// 1 for every byte value that is written as is, see QP_RANGES
const QP_LITERAL = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    QP_LITERAL[i] = checkRanges(i, QP_RANGES) ? 1 : 0;
}

const HEX_DIGITS = Buffer.from('0123456789ABCDEF', 'latin1');

const isWhitespace = (c: number | undefined): boolean => c === 0x20 || c === 0x09;

export function encode(buffer: Buffer | string): string {
    return encodeBytes(typeof buffer === 'string' ? Buffer.from(buffer, 'utf-8') : buffer);
}

/**
 * Encodes bytes that may be followed by more input
 *
 * @param buffer Bytes to encode
 * @param [next] The byte that follows the buffer, whitespace before it is kept literal unless it
 *        is a line break. Without it the buffer ends the input and its trailing whitespace is encoded
 * @param [binary] Keep only CRLF pairs literal. A lone CR or LF is data, not a line break, and
 *        anything that rewrites line endings on the way would change it
 * @param [previous] The byte before the buffer, for a buffer that starts with LF
 * @returns Quoted-Printable encoded string
 */
function encodeBytes(buffer: Buffer, next?: number, binary?: boolean, previous?: number): string {
    const len = buffer.length;
    // every byte takes three characters at most
    const output = Buffer.allocUnsafe(len * 3);
    let pos = 0;

    for (let i = 0; i < len; i++) {
        const ord = buffer[i];
        const following = i + 1 < len ? buffer[i + 1] : next;
        const lineBreakByte =
            binary && (ord === 0x0d || ord === 0x0a)
                ? ord === 0x0d
                    ? following === 0x0a
                    : (i > 0 ? buffer[i - 1] : previous) === 0x0d
                : true;
        // if the char is in allowed range, then keep as is, unless it is a WS in the end of a line
        if (
            QP_LITERAL[ord] &&
            lineBreakByte &&
            !(isWhitespace(ord) && (following === undefined || following === 0x0a || following === 0x0d))
        ) {
            output[pos++] = ord;
            continue;
        }
        output[pos++] = 0x3d; // =
        output[pos++] = HEX_DIGITS[Math.floor(ord / 16)];
        output[pos++] = HEX_DIGITS[ord % 16];
    }

    return output.toString('latin1', 0, pos);
}

/**
 * Adds soft line breaks to a Quoted-Printable string
 *
 * @param str Quoted-Printable encoded string that might need line wrapping
 * @param [lineLength=76] Maximum allowed length for a line
 * @returns Soft-wrapped Quoted-Printable encoded string
 */
export function wrap(str: string, lineLength?: number): string {
    str = (str || '').toString();
    // a line has to hold a complete =XX sequence plus the soft break, shorter lengths
    // (or a negative one) would loop without consuming input
    lineLength = Math.max(Number(lineLength) || 76, MIN_LINE_LENGTH);

    if (str.length <= lineLength) {
        return str;
    }

    let pos = 0;
    const len = str.length;
    let match: RegExpMatchArray | null, code: number, line: string;
    const lineMargin = Math.floor(lineLength / 3);
    let result = '';

    // insert soft linebreaks where needed
    while (pos < len) {
        line = str.substr(pos, lineLength);
        if ((match = line.match(/\r\n/))) {
            line = line.substr(0, (match.index as number) + match[0].length);
            result += line;
            pos += line.length;
            continue;
        }

        if (line.substr(-1) === '\n') {
            result += line;
            pos += line.length;
            continue;
        }

        if ((match = line.substr(-lineMargin).match(/\n.*?$/))) {
            // truncate to nearest line break
            line = line.substr(0, line.length - (match[0].length - 1));
            result += line;
            pos += line.length;
            continue;
        }

        if (line.length > lineLength - lineMargin && (match = line.substr(-lineMargin).match(/[ \t.,!?][^ \t.,!?]*$/))) {
            // truncate to nearest space
            line = line.substr(0, line.length - (match[0].length - 1));
        } else if (line.match(/[=][\da-f]{0,2}$/i)) {
            // push incomplete encoding sequences to the next line
            if ((match = line.match(/[=][\da-f]{0,1}$/i))) {
                line = line.substr(0, line.length - match[0].length);
            }

            // ensure that utf-8 sequences are not split
            while (
                line.length > 3 &&
                line.length < len - pos &&
                !line.match(/^(?:=[\da-f]{2}){1,4}$/i) &&
                (match = line.match(/[=][\da-f]{2}$/gi))
            ) {
                code = parseInt(match[0].substr(1, 2), 16);
                if (code < 128) {
                    break;
                }

                line = line.substr(0, line.length - 3);

                if (code >= 0xc0) {
                    break;
                }
            }
        }

        if (!line.length) {
            // the trimming above emptied the line, which only happens for an incomplete
            // escape at the very end of the input. Take it as is rather than loop on it
            line = str.substr(pos, lineLength);
        }

        if (pos + line.length < len && line.substr(-1) !== '\n') {
            if (line.length === lineLength && line.match(/[=][\da-f]{2}$/i)) {
                line = line.substr(0, line.length - 3);
            } else if (line.length === lineLength) {
                line = line.substr(0, line.length - 1);
            }
            pos += line.length;
            line += '=\r\n';
        } else {
            pos += line.length;
        }

        result += line;
    }

    return result;
}

/**
 * Helper function to check if a number is inside provided ranges
 *
 * @param nr Number to check for
 * @param ranges An Array of allowed values
 * @returns True if the value was found inside allowed ranges, false otherwise
 */
function checkRanges(nr: number, ranges: number[][]): boolean {
    for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        if (!range.length) {
            continue;
        }
        if (range.length === 1 && nr === range[0]) {
            return true;
        }
        if (range.length === 2 && nr >= range[0] && nr <= range[1]) {
            return true;
        }
    }
    return false;
}

/**
 * Options for the Quoted-Printable encoder stream
 */
export interface QPEncoderOptions {
    /** Maximum length for lines, set to false to disable wrapping */
    lineLength?: number | false | undefined;
    /** The input is binary data: a CR or LF that is not part of a CRLF pair is encoded */
    binary?: boolean | undefined;
}

/** The name @types/nodemailer used for QPEncoderOptions */
export type EncoderOptions = QPEncoderOptions;

// Input is encoded and wrapped this many bytes at a time. wrap() works on strings, and a large
// chunk handed over at once, such as a whole Buffer attachment, would be held several times over
// as intermediate strings
const ENCODE_SLICE_SIZE = 64 * 1024;

/**
 * Creates a transform stream for encoding data to Quoted-Printable encoding
 *
 * @constructor
 * @param options Stream options
 * @param [options.lineLength=76] Maximum length for lines, set to false to disable wrapping
 */
export class Encoder extends Transform {
    options: QPEncoderOptions;
    inputBytes: number;
    outputBytes: number;
    /** @internal */
    _curLine: string;
    /** Whitespace from the end of the input so far, see _transform @internal */
    _remainingBytes: Buffer | false;
    /** The last byte encoded so far, a slice that starts with LF needs it @internal */
    _lastByte: number | undefined;

    constructor(options?: QPEncoderOptions) {
        super();

        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = this.options.lineLength || 76;
        }

        this._curLine = '';
        this._remainingBytes = false;
        this._lastByte = undefined;

        this.inputBytes = 0;
        this.outputBytes = 0;
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

        // Whitespace is encoded when it ends a line, and the end of the input counts as one. Hold
        // back the whitespace a chunk ends with until it is known what follows it, so the output
        // does not depend on where the input was split
        let end = buf.length;
        // a binary CR can only be written once it is known whether LF follows
        while (end > 0 && (isWhitespace(buf[end - 1]) || (this.options.binary && buf[end - 1] === 0x0d))) {
            end--;
        }
        if (buf.length - end <= ENCODE_SLICE_SIZE) {
            this._remainingBytes = end < buf.length ? Buffer.from(buf.subarray(end)) : false;
            buf = buf.subarray(0, end);
        }

        this._encodeSlices(buf);
        done();
    }

    /** @internal */
    override _flush(done: TransformCallback): void {
        if (this._remainingBytes) {
            this._encodeSlices(this._remainingBytes);
            this._remainingBytes = false;
        }
        if (this._curLine) {
            this.outputBytes += this._curLine.length;
            this.push(this._curLine, 'ascii');
            this._curLine = '';
        }
        done();
    }

    /**
     * Encodes the input in slices of ENCODE_SLICE_SIZE bytes. Each slice is told the byte that
     * follows it, so a slice that ends in whitespace is encoded as if it was not split
     *
     * @internal
     */
    _encodeSlices(buf: Buffer): void {
        for (let start = 0; start < buf.length; start += ENCODE_SLICE_SIZE) {
            const end = Math.min(start + ENCODE_SLICE_SIZE, buf.length);
            this._encodeSlice(buf.subarray(start, end), end < buf.length ? buf[end] : undefined);
            this._lastByte = buf[end - 1];
        }
    }

    /** @internal */
    _encodeSlice(buf: Buffer, next: number | undefined): void {
        let qp: string;

        if (this.options.lineLength) {
            qp = wrap(this._curLine + encodeBytes(buf, next, this.options.binary, this._lastByte), this.options.lineLength);
            // the last line is kept until it is known whether it needs a soft break
            const lastLF = qp.lastIndexOf('\n');
            this._curLine = qp.substring(lastLF + 1);
            qp = qp.substring(0, lastLF + 1);

            if (qp) {
                this.outputBytes += qp.length;
                this.push(qp, 'ascii');
            }
        } else {
            qp = encodeBytes(buf, next, this.options.binary, this._lastByte);
            this.outputBytes += qp.length;
            this.push(qp, 'ascii');
        }
    }
}
