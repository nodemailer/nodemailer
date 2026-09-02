import { Transform, type TransformCallback, type TransformOptions } from 'node:stream';

/**
 * Ensures that only <CR><LF> sequences are used for linebreaks
 *
 * @param options Stream options
 */
export default class LeWindows extends Transform {
    lastByte: number | false;

    constructor(options?: TransformOptions) {
        super(options);
        this.lastByte = false;
    }

    /**
     * Escapes dots
     */
    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        let buf: Buffer;
        let lastPos = 0;

        for (let i = 0, len = chunk.length; i < len; i++) {
            if (chunk[i] === 0x0a) {
                // \n
                if ((i && chunk[i - 1] !== 0x0d) || (!i && this.lastByte !== 0x0d)) {
                    if (i > lastPos) {
                        buf = chunk.slice(lastPos, i);
                        this.push(buf);
                    }
                    this.push(Buffer.from('\r\n'));
                    lastPos = i + 1;
                }
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
}
