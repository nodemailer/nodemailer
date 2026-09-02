import { Transform, type TransformCallback } from 'node:stream';

export default class LastNewline extends Transform {
    lastByte: number | false;

    constructor() {
        super();
        this.lastByte = false;
    }

    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        if (chunk.length) {
            this.lastByte = chunk[chunk.length - 1];
        }

        this.push(chunk);
        done();
    }

    override _flush(done: TransformCallback): void {
        if (this.lastByte === 0x0a) {
            return done();
        }
        if (this.lastByte === 0x0d) {
            this.push(Buffer.from('\n'));
            return done();
        }
        this.push(Buffer.from('\r\n'));
        return done();
    }
}
