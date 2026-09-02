// streams through a message body and calculates relaxed body hash

import { Transform, type TransformCallback } from 'node:stream';
import crypto from 'node:crypto';

const CHAR_CR = 0x0d;
const CHAR_LF = 0x0a;
const CHAR_SPACE = 0x20;
const CHAR_TAB = 0x09;

const CRLF = Buffer.from('\r\n');
// a run of empty lines is hashed from this buffer in slices
const EMPTY_LINES = Buffer.alloc(4096, CRLF);

/**
 * Options for the relaxed body hash stream
 */
export interface RelaxedBodyOptions {
    /** Hash algorithm for the body hash, defaults to sha256 */
    hashAlgo?: string;
    /** Collect the canonicalized body and emit it with the 'hash' event */
    debug?: boolean;
}

/**
 * Passes the message body through unchanged and hashes its relaxed
 * canonicalization (RFC 6376 section 3.4.4) on the side: whitespace at the end
 * of a line is dropped, runs of whitespace within a line become a single space,
 * every line ends with CRLF, empty lines at the end of the body are ignored and
 * a non-empty body always ends with CRLF. Bytes are canonicalized as they arrive,
 * so a line of any length costs constant memory.
 */
export default class RelaxedBody extends Transform {
    bodyHash: crypto.Hash;
    /** Bytes of the original body seen so far */
    byteLength: number;
    debug: boolean | undefined;
    _debugBody: Buffer[] | false;

    /** The current line has bytes that survive canonicalization */
    _lineHasContent: boolean;
    /** Whitespace that ends up as a single space if more content follows on the line */
    _pendingWsp: boolean;
    /** A CR that is part of the line ending if LF follows, otherwise content */
    _pendingCr: boolean;
    /** Empty lines that are hashed only once a non-empty line follows them */
    _pendingEmptyLines: number;

    constructor(options?: RelaxedBodyOptions) {
        super();
        options = options || {};
        this.bodyHash = crypto.createHash(options.hashAlgo || 'sha256');
        this.byteLength = 0;

        this.debug = options.debug;
        this._debugBody = options.debug ? [] : false;

        this._lineHasContent = false;
        this._pendingWsp = false;
        this._pendingCr = false;
        this._pendingEmptyLines = 0;
    }

    _hashCanonical(data: Buffer): void {
        if (!data.length) {
            return;
        }
        this.bodyHash.update(data);
        if (this._debugBody) {
            this._debugBody.push(Buffer.from(data));
        }
    }

    _hashEmptyLines(): void {
        while (this._pendingEmptyLines > 0) {
            const count = Math.min(this._pendingEmptyLines, EMPTY_LINES.length / 2);
            this._hashCanonical(EMPTY_LINES.subarray(0, count * 2));
            this._pendingEmptyLines -= count;
        }
    }

    /**
     * Writes a content byte, with the space a pending run of whitespace collapses to,
     * into the output buffer and returns the new write position. Kept a method rather
     * than a closure so the write position stays a plain local in the byte loop
     */
    _emitContent(out: Buffer, outPos: number, c: number): number {
        if (!this._lineHasContent) {
            if (this._pendingEmptyLines) {
                // the first content byte of a line is where the empty lines before it
                // become part of the body, so hash what is in the buffer before them
                this._hashCanonical(out.subarray(0, outPos));
                outPos = 0;
                this._hashEmptyLines();
            }
            this._lineHasContent = true;
        }
        if (this._pendingWsp) {
            out[outPos++] = CHAR_SPACE;
            this._pendingWsp = false;
        }
        out[outPos++] = c;
        return outPos;
    }

    updateHash(chunk: Buffer, final?: boolean): void {
        // every byte contributes itself at most once, plus a CR for a bare LF
        // and, once per chunk, a pending space and CR carried over from before
        const out = Buffer.allocUnsafe(chunk.length * 2 + 2);
        let outPos = 0;

        for (let i = 0; i < chunk.length; i++) {
            const c = chunk[i];

            if (c === CHAR_LF) {
                // end of line, a CR right before it and any trailing whitespace are dropped
                if (this._lineHasContent) {
                    out[outPos++] = CHAR_CR;
                    out[outPos++] = CHAR_LF;
                    this._lineHasContent = false;
                } else {
                    this._pendingEmptyLines++;
                }
                this._pendingWsp = false;
                this._pendingCr = false;
                continue;
            }

            if (this._pendingCr) {
                // not followed by LF, so the CR is content
                outPos = this._emitContent(out, outPos, CHAR_CR);
                this._pendingCr = false;
            }

            if (c === CHAR_CR) {
                this._pendingCr = true;
            } else if (c === CHAR_SPACE || c === CHAR_TAB) {
                this._pendingWsp = true;
            } else {
                outPos = this._emitContent(out, outPos, c);
            }
        }

        if (final && this._pendingCr) {
            // a CR at the very end of the body is content
            outPos = this._emitContent(out, outPos, CHAR_CR);
            this._pendingCr = false;
        }

        this._hashCanonical(out.subarray(0, outPos));
    }

    override _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        this.updateHash(chunk);

        this.byteLength += chunk.length;
        this.push(chunk);
        callback();
    }

    override _flush(callback: TransformCallback): void {
        this.updateHash(Buffer.alloc(0), true);

        if (this._lineHasContent) {
            // the body does not end with a line break, add one
            this._hashCanonical(CRLF);
        }

        this.emit('hash', this.bodyHash.digest('base64'), this.debug ? Buffer.concat(this._debugBody as Buffer[]) : false);
        callback();
    }
}
