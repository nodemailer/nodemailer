import { Transform, type TransformCallback, type TransformOptions } from 'node:stream';

/**
 * A header line as emitted with the 'headers' event
 */
export interface MessageParserHeaderLine {
    /** Lowercase header field name */
    key: string;
    /** Full header line, folded continuation lines included */
    line: string;
}

/**
 * MessageParser instance is a transform stream that separates message headers
 * from the rest of the body. Headers are emitted with the 'headers' event. Message
 * body is passed on as the resulting stream.
 */
export default class MessageParser extends Transform {
    lastBytes: Buffer;
    headersParsed: boolean;
    headerBytes: number;
    headerChunks: Buffer[] | null;
    rawHeaders: Buffer | false;
    bodySize: number;

    constructor(options?: TransformOptions) {
        super(options);
        this.lastBytes = Buffer.alloc(4);
        this.headersParsed = false;
        this.headerBytes = 0;
        this.headerChunks = [];
        this.rawHeaders = false;
        this.bodySize = 0;
    }

    /**
     * Keeps count of the last 4 bytes in order to detect line breaks on chunk boundaries
     *
     * @param data Next data chunk from the stream
     */
    updateLastBytes(data: Buffer): void {
        const lblen = this.lastBytes.length;
        const nblen = Math.min(data.length, lblen);

        // shift existing bytes
        for (let i = 0, len = lblen - nblen; i < len; i++) {
            this.lastBytes[i] = this.lastBytes[i + nblen];
        }

        // add new bytes
        for (let i = 1; i <= nblen; i++) {
            this.lastBytes[lblen - i] = data[data.length - i];
        }
    }

    /**
     * Finds and removes message headers from the remaining body. We want to keep
     * headers separated until final delivery to be able to modify these
     *
     * @param data Next chunk of data
     * @return Returns true if headers are already found or false otherwise
     */
    checkHeaders(data: Buffer): boolean {
        if (this.headersParsed) {
            return true;
        }

        const lblen = this.lastBytes.length;
        let headerPos = 0;
        for (let i = 0, len = this.lastBytes.length + data.length; i < len; i++) {
            let chr: number;
            if (i < lblen) {
                chr = this.lastBytes[i];
            } else {
                chr = data[i - lblen];
            }
            if (chr === 0x0a && i) {
                const pr1 = i - 1 < lblen ? this.lastBytes[i - 1] : data[i - 1 - lblen];
                const pr2 = i > 1 ? (i - 2 < lblen ? this.lastBytes[i - 2] : data[i - 2 - lblen]) : false;
                if (pr1 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                } else if (pr1 === 0x0d && pr2 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                }
            }
        }

        if (this.headersParsed) {
            (this.headerChunks as Buffer[]).push(data.slice(0, headerPos));
            this.rawHeaders = Buffer.concat(this.headerChunks as Buffer[], this.headerBytes);
            this.headerChunks = null;
            this.emit('headers', this.parseHeaders());
            if (data.length - 1 > headerPos) {
                const chunk = data.slice(headerPos);
                this.bodySize += chunk.length;
                // this would be the first chunk of data sent downstream
                setImmediate(() => this.push(chunk));
            }
            return false;
        }

        this.headerBytes += data.length;
        (this.headerChunks as Buffer[]).push(data);

        // store last 4 bytes to catch header break
        this.updateLastBytes(data);

        return false;
    }

    override _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        let headersFound: boolean;

        try {
            headersFound = this.checkHeaders(chunk);
        } catch (E) {
            return callback(E as Error);
        }

        if (headersFound) {
            this.bodySize += chunk.length;
            this.push(chunk);
        }

        setImmediate(callback);
    }

    override _flush(callback: TransformCallback): void {
        if (this.headerChunks) {
            const chunk = Buffer.concat(this.headerChunks, this.headerBytes);
            this.bodySize += chunk.length;
            this.push(chunk);
            this.headerChunks = null;
        }
        callback();
    }

    parseHeaders(): MessageParserHeaderLine[] {
        const lines = (this.rawHeaders || '').toString().split(/\r?\n/);
        for (let i = lines.length - 1; i > 0; i--) {
            if (/^\s/.test(lines[i])) {
                lines[i - 1] += '\n' + lines[i];
                lines.splice(i, 1);
            }
        }
        return lines
            .filter(line => line.trim())
            .map(line => ({
                key: line.substr(0, line.indexOf(':')).trim().toLowerCase(),
                line
            }));
    }
}
