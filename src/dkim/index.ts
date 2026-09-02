// FIXME:
// replace this Transform mess with a method that pipes input argument to output argument

import MessageParser, { type MessageParserHeaderLine } from './message-parser.js';
import RelaxedBody from './relaxed-body.js';
import sign, { type DKIMKey, type DKIMPrivateKey, type DKIMSignOptions } from './sign.js';
import { PassThrough, type Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { copyOwnKeys } from '../shared/objects.js';

const DKIM_ALGO = 'sha256';
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // buffer messages larger than this to disk

/*
// Usage:

let dkim = new DKIM({
    domainName: 'example.com',
    keySelector: 'key-selector',
    privateKey,
    cacheDir: '/tmp'
});
dkim.sign(input).pipe(process.stdout);

// Where inputStream is a rfc822 message (either a stream, string or Buffer)
// and outputStream is a DKIM signed rfc822 message
*/

/**
 * A single DKIM signing key
 */
export type { DKIMKey, DKIMPrivateKey, DKIMSignOptions };

/**
 * Options for the DKIM signer
 */
export interface DKIMOptions extends DKIMSignOptions {
    /** One or more signing keys, used instead of the domainName, keySelector and privateKey options */
    keys?: DKIMKey | DKIMKey[];
    /** Directory for buffering large message bodies to disk, no buffering when not set */
    cacheDir?: string | false;
    /** Body size in bytes from which the body is buffered to cacheDir, defaults to 10 MB */
    cacheTreshold?: number;
    /** Hash algorithm for the body hash and the signature, defaults to sha256 */
    hashAlgo?: string;
}

/**
 * The signed message as returned by DKIM#sign
 */
export interface DKIMSignedStream extends PassThrough {
    /** true if the message body was buffered to cacheDir while signing */
    usingCache: boolean;
}

class DKIMSigner {
    options: DKIMOptions;
    keys: DKIMKey[];
    cacheTreshold: number;
    hashAlgo: string;
    cacheDir: string | false;
    chunks: Buffer[];
    chunklen: number;
    readPos: number;
    cachePath: string | false;
    cache: fs.ReadStream | fs.WriteStream | false;
    headers: MessageParserHeaderLine[] | false;
    bodyHash: string | false;
    parser: MessageParser | false;
    relaxedBody: RelaxedBody | false;
    input: Readable;
    output: DKIMSignedStream;
    hasErrored: boolean;

    constructor(options: DKIMOptions, keys: DKIMKey[], input: Readable, output: DKIMSignedStream) {
        this.options = options || {};
        this.keys = keys;

        this.cacheTreshold = Number(this.options.cacheTreshold) || MAX_MESSAGE_SIZE;
        this.hashAlgo = this.options.hashAlgo || DKIM_ALGO;

        this.cacheDir = this.options.cacheDir || false;

        this.chunks = [];
        this.chunklen = 0;
        this.readPos = 0;
        this.cachePath = this.cacheDir
            ? path.join(this.cacheDir, 'message.' + Date.now() + '-' + crypto.randomBytes(14).toString('hex'))
            : false;
        this.cache = false;

        this.headers = false;
        this.bodyHash = false;
        this.parser = false;
        this.relaxedBody = false;

        this.input = input;
        this.output = output;
        this.output.usingCache = false;

        this.hasErrored = false;

        this.input.on('error', err => {
            this.hasErrored = true;
            this.cleanup();
            output.emit('error', err);
        });
    }

    cleanup(): void {
        if (!this.cache || !this.cachePath) {
            return;
        }
        fs.unlink(this.cachePath, () => false);
    }

    createReadCache(): void {
        // pipe remainings to cache file
        this.cache = fs.createReadStream(this.cachePath as string);
        this.cache.once('error', err => {
            this.cleanup();
            this.output.emit('error', err);
        });
        this.cache.once('close', () => {
            this.cleanup();
        });
        this.cache.pipe(this.output);
    }

    sendNextChunk(): void {
        if (this.hasErrored) {
            return;
        }

        if (this.readPos >= this.chunks.length) {
            if (!this.cache) {
                this.output.end();
                return;
            }
            return this.createReadCache();
        }
        const chunk = this.chunks[this.readPos++];
        if (this.output.write(chunk) === false) {
            this.output.once('drain', () => {
                this.sendNextChunk();
            });
            return;
        }
        setImmediate(() => this.sendNextChunk());
    }

    sendSignedOutput(): void {
        let keyPos = 0;
        const signNextKey = (): void => {
            if (keyPos >= this.keys.length) {
                this.output.write((this.parser as MessageParser).rawHeaders as Buffer);
                setImmediate(() => this.sendNextChunk());
                return;
            }
            const key = this.keys[keyPos++];
            const dkimField = sign(this.headers as MessageParserHeaderLine[], this.hashAlgo, this.bodyHash as string, {
                domainName: key.domainName,
                keySelector: key.keySelector,
                privateKey: key.privateKey,
                headerFieldNames: this.options.headerFieldNames,
                skipFields: this.options.skipFields
            });
            if (dkimField) {
                this.output.write(Buffer.from(dkimField + '\r\n'));
            }
            setImmediate(signNextKey);
        };

        if (this.bodyHash && this.headers) {
            return signNextKey();
        }

        this.output.write((this.parser as MessageParser).rawHeaders as Buffer);
        this.sendNextChunk();
    }

    createWriteCache(): void {
        this.output.usingCache = true;
        // pipe remainings to cache file
        this.cache = fs.createWriteStream(this.cachePath as string);
        this.cache.once('error', err => {
            this.cleanup();
            // drain input
            (this.relaxedBody as RelaxedBody).unpipe(this.cache as fs.WriteStream);
            (this.relaxedBody as RelaxedBody).on('readable', () => {
                while ((this.relaxedBody as RelaxedBody).read() !== null) {
                    // do nothing
                }
            });
            this.hasErrored = true;
            // emit error
            this.output.emit('error', err);
        });
        this.cache.once('close', () => {
            this.sendSignedOutput();
        });
        (this.relaxedBody as RelaxedBody).removeAllListeners('readable');
        (this.relaxedBody as RelaxedBody).pipe(this.cache);
    }

    signStream(): void {
        this.parser = new MessageParser();
        this.relaxedBody = new RelaxedBody({
            hashAlgo: this.hashAlgo
        });

        this.parser.on('headers', value => {
            this.headers = value;
        });

        this.relaxedBody.on('hash', value => {
            this.bodyHash = value;
        });

        this.relaxedBody.on('readable', () => {
            let chunk: Buffer;
            if (this.cache) {
                return;
            }
            while ((chunk = (this.relaxedBody as RelaxedBody).read()) !== null) {
                this.chunks.push(chunk);
                this.chunklen += chunk.length;
                if (this.chunklen >= this.cacheTreshold && this.cachePath) {
                    return this.createWriteCache();
                }
            }
        });

        this.relaxedBody.on('end', () => {
            if (this.cache) {
                return;
            }
            this.sendSignedOutput();
        });

        this.parser.pipe(this.relaxedBody);
        setImmediate(() => this.input.pipe(this.parser as MessageParser));
    }
}

class DKIM {
    options: DKIMOptions;
    keys: DKIMKey[];

    constructor(options: DKIMOptions) {
        this.options = options || {};
        this.keys = ([] as DKIMKey[]).concat(
            this.options.keys || {
                domainName: options.domainName,
                keySelector: options.keySelector,
                privateKey: options.privateKey
            }
        );
    }

    sign(input: Readable | Buffer | string, extraOptions?: DKIMOptions): DKIMSignedStream {
        const output = new PassThrough() as DKIMSignedStream;
        let inputStream = input;
        let writeValue: Buffer | false = false;

        if (Buffer.isBuffer(input)) {
            writeValue = input;
            inputStream = new PassThrough();
        } else if (typeof input === 'string') {
            writeValue = Buffer.from(input);
            inputStream = new PassThrough();
        }

        let options = this.options;
        if (extraOptions && Object.keys(extraOptions).length) {
            // extraOptions is mail.data._dkim, caller supplied message data. An own
            // "__proto__" key there would let every option this signer reads and the
            // transport did not set, such as skipFields, answer from the caller
            options = copyOwnKeys({}, extraOptions);
            copyOwnKeys(options, this.options);
        }

        const signer = new DKIMSigner(options, this.keys, inputStream as Readable, output);
        setImmediate(() => {
            signer.signStream();
            if (writeValue) {
                setImmediate(() => {
                    (inputStream as PassThrough).end(writeValue);
                });
            }
        });

        return output;
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `DKIM.Options` style references keep working
 */
declare namespace DKIM {
    export type Options = DKIMOptions;
    export type SingleKeyOptions = Omit<DKIMOptions, 'keys'>;
}

export default DKIM;
