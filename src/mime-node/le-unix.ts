import { Transform, type TransformCallback, type TransformOptions } from 'node:stream';

const LF = Buffer.from('\n');

/**
 * Ensures that only <LF> is used for linebreaks
 *
 * @param options Stream options
 */
export default class LeUnix extends Transform {
    lastByte: number | false;

    constructor(options?: TransformOptions) {
        super(options);
        this.lastByte = false;
    }

    /**
     * Escapes dots
     * @internal
     */
    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        let buf: Buffer;
        let lastPos = 0;

        if (!chunk.length) {
            return done();
        }

        for (let i = 0, len = chunk.length; i < len; i++) {
            const prev = i ? chunk[i - 1] : this.lastByte;
            if (prev === 0x0d && chunk[i] !== 0x0a) {
                // a bare CR is a line break of its own, the same way the SMTP data stream
                // treats it. Dropping it would join the lines on either side of it
                this.push(LF);
            }

            if (chunk[i] === 0x0d) {
                // \r
                buf = chunk.slice(lastPos, i);
                lastPos = i + 1;
                this.push(buf);
            }
        }
        if (lastPos && lastPos < chunk.length) {
            buf = chunk.slice(lastPos);
            this.push(buf);
        } else if (!lastPos) {
            this.push(chunk);
        }

        this.lastByte = chunk[chunk.length - 1];
        done();
    }

    /** @internal */
    override _flush(done: TransformCallback): void {
        if (this.lastByte === 0x0d) {
            // the input ended with a bare CR
            this.push(LF);
        }
        done();
    }
}
