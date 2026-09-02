import { Transform, type TransformCallback } from 'node:stream';

/**
 * Encodes a Buffer into a Quoted-Printable encoded string
 *
 * @param buffer Buffer to convert
 * @returns Quoted-Printable encoded string
 */
// usable characters that do not need encoding
// https://tools.ietf.org/html/rfc2045#section-6.7
const QP_RANGES = [
    [0x09], // <TAB>
    [0x0a], // <LF>
    [0x0d], // <CR>
    [0x20, 0x3c], // <SP>!"#$%&'()*+,-./0123456789:;
    [0x3e, 0x7e] // >?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}
];

export function encode(buffer: Buffer | string): string {
    if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer, 'utf-8');
    }

    let result = '';
    let ord: number;

    for (let i = 0, len = buffer.length; i < len; i++) {
        ord = buffer[i];
        // if the char is in allowed range, then keep as is, unless it is a WS in the end of a line
        if (
            checkRanges(ord, QP_RANGES) &&
            !((ord === 0x20 || ord === 0x09) && (i === len - 1 || buffer[i + 1] === 0x0a || buffer[i + 1] === 0x0d))
        ) {
            result += String.fromCharCode(ord);
            continue;
        }
        result += '=' + (ord < 0x10 ? '0' : '') + ord.toString(16).toUpperCase();
    }

    return result;
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
    lineLength = lineLength || 76;

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
    lineLength?: number | false;
}

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
    _curLine: string;

    constructor(options?: QPEncoderOptions) {
        super();

        this.options = options || {};

        if (this.options.lineLength !== false) {
            this.options.lineLength = this.options.lineLength || 76;
        }

        this._curLine = '';

        this.inputBytes = 0;
        this.outputBytes = 0;
    }

    override _transform(chunk: Buffer | string, encoding: BufferEncoding | 'buffer', done: TransformCallback): void {
        let qp: string;

        if (encoding !== 'buffer') {
            chunk = Buffer.from(chunk as string, encoding);
        }

        if (!chunk || !chunk.length) {
            return done();
        }

        this.inputBytes += chunk.length;

        if (this.options.lineLength) {
            qp = this._curLine + encode(chunk);
            qp = wrap(qp, this.options.lineLength);
            qp = qp.replace(/(^|\n)([^\n]*)$/, (match, lineBreak, lastLine) => {
                this._curLine = lastLine;
                return lineBreak;
            });

            if (qp) {
                this.outputBytes += qp.length;
                this.push(qp);
            }
        } else {
            qp = encode(chunk);
            this.outputBytes += qp.length;
            this.push(qp, 'ascii');
        }

        done();
    }

    override _flush(done: TransformCallback): void {
        if (this._curLine) {
            this.outputBytes += this._curLine.length;
            this.push(this._curLine, 'ascii');
        }
        done();
    }
}
