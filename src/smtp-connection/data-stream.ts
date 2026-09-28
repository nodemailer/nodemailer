import { Transform, type TransformCallback, type TransformOptions } from 'node:stream';

// bytes inserted into the output, shared as they are only ever copied by Buffer.concat
const INSERT_LF = Buffer.from('\n');
const INSERT_LF_DOT = Buffer.from('\n.');
const INSERT_CR = Buffer.from('\r');
const INSERT_DOT = Buffer.from('.');

/**
 * Escapes dots in the beginning of lines. Ends the stream with <CR><LF>.<CR><LF>
 * Also makes sure that only <CR><LF> sequences are used for linebreaks, bare CR and bare LF
 * are both turned into <CR><LF>
 *
 * @param options Stream options
 */
export default class DataStream extends Transform {
    options: TransformOptions;
    inByteCount: number;
    outByteCount: number;
    lastByte: number | false;

    constructor(options?: TransformOptions) {
        super(options);
        this.options = options || {};

        this.inByteCount = 0;
        this.outByteCount = 0;
        this.lastByte = false;
    }

    /**
     * Escapes dots
     * @internal
     */
    override _transform(chunk: Buffer | string, encoding: BufferEncoding, done: TransformCallback): void {
        const chunks: Buffer[] = [];
        let chunklen = 0;
        let i: number,
            len: number,
            lastPos = 0;
        let buf: Buffer;

        if (!chunk || !chunk.length) {
            return done();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk);
        }

        this.inByteCount += chunk.length;

        for (i = 0, len = chunk.length; i < len; i++) {
            const byte = chunk[i];
            const prev = i ? chunk[i - 1] : this.lastByte;
            let insert: Buffer | false = false;

            if (prev === 0x0d && byte !== 0x0a) {
                // a bare CR becomes CRLF. A receiver that treats a lone CR as a line end would
                // otherwise see "\r.\r" as the end of the data (SMTP smuggling), so a dot
                // following it is stuffed like at the start of any other line
                insert = byte === 0x2e ? INSERT_LF_DOT : INSERT_LF;
            } else if (byte === 0x0a && prev !== 0x0d) {
                // a bare LF becomes CRLF
                insert = INSERT_CR;
            } else if (byte === 0x2e && (prev === 0x0a || prev === false)) {
                // a dot at the start of a line
                insert = INSERT_DOT;
            }

            if (insert) {
                if (i > lastPos) {
                    buf = chunk.slice(lastPos, i);
                    chunks.push(buf);
                    chunklen += buf.length;
                }
                chunks.push(insert);
                chunklen += insert.length;
                lastPos = i;
            }
        }

        if (chunks.length) {
            // add last piece
            if (lastPos < chunk.length) {
                buf = chunk.slice(lastPos);
                chunks.push(buf);
                chunklen += buf.length;
            }

            this.outByteCount += chunklen;
            this.push(Buffer.concat(chunks, chunklen));
        } else {
            this.outByteCount += chunk.length;
            this.push(chunk);
        }

        this.lastByte = chunk[chunk.length - 1];
        done();
    }

    /**
     * Finalizes the stream with a dot on a single line
     * @internal
     */
    override _flush(done: TransformCallback): void {
        let buf: Buffer;
        if (this.lastByte === 0x0a) {
            buf = Buffer.from('.\r\n');
        } else if (this.lastByte === 0x0d) {
            buf = Buffer.from('\n.\r\n');
        } else {
            buf = Buffer.from('\r\n.\r\n');
        }
        this.outByteCount += buf.length;
        this.push(buf);
        done();
    }
}
