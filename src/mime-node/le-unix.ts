import { Transform, type TransformCallback, type TransformOptions } from 'node:stream';

/**
 * Ensures that only <LF> is used for linebreaks
 *
 * @param options Stream options
 */
export default class LeUnix extends Transform {
    constructor(options?: TransformOptions) {
        super(options);
    }

    /**
     * Escapes dots
     */
    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        let buf: Buffer;
        let lastPos = 0;

        for (let i = 0, len = chunk.length; i < len; i++) {
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
        done();
    }
}
