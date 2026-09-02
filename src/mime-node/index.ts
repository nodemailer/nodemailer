/* eslint no-undefined: 0, prefer-spread: 0, no-control-regex: 0 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import * as punycode from '../punycode/index.js';
import { PassThrough, type Duplex, type Readable, type Transform, type TransformOptions, type Writable } from 'node:stream';
import * as shared from '../shared/index.js';
import urlModule from 'node:url';

import * as mimeFuncs from '../mime-funcs/index.js';
import * as qp from '../qp/index.js';
import * as base64 from '../base64/index.js';
import addressparser, { type Address } from '../addressparser/index.js';
import nmfetch from '../fetch/index.js';
import * as errors from '../errors.js';
import type { NodemailerError, ResultCallback } from '../errors.js';
import type { OutgoingHttpHeaders } from 'node:http';
import LastNewline from './last-newline.js';

import LeWindows from './le-windows.js';
import LeUnix from './le-unix.js';

/**
 * Options for a MimeNode
 */
export interface MimeNodeOptions {
    /** root node for this tree */
    rootNode?: MimeNode;
    /** immediate parent for this node */
    parentNode?: MimeNode;
    /** filename for an attachment node */
    filename?: string;
    /** shared part of the unique multipart boundary */
    baseBoundary?: string;
    /** prefix for the generated multipart boundaries, defaults to '--_NmP' */
    boundaryPrefix?: string;
    /** If true, do not exclude Bcc from the generated headers */
    keepBcc?: boolean;
    /** method to normalize header keys for custom caseing */
    normalizeHeaderKey?: (key: string, value: string) => string;
    /** either 'Q' (the default) or 'B' */
    textEncoding?: string;
    /** Hostname for default message-id values */
    hostname?: string;
    /** If set to 'win' then uses \r\n, if 'linux' then \n. If not set (or `raw` is used) then newlines are kept as is */
    newline?: string;
    /** Reject content that points to a file path, for this node and every node below it */
    disableFileAccess?: boolean;
    /** Reject content that points to a URL, for this node and every node below it */
    disableUrlAccess?: boolean;
}

/**
 * An address object as accepted in address headers and produced by getAddresses. Either a
 * mailbox with an address or a group holding a list of addresses
 */
export interface MimeNodeAddress {
    name?: string;
    address?: string;
    group?: MimeNodeAddress[];
}

/**
 * Addresses as accepted by address headers and envelope fields: an address string, an
 * address object, or an array of these, nested arrays included
 */
export type MimeNodeAddressInput = string | MimeNodeAddress | MimeNodeAddressInput[];

/**
 * A header value object. When `prepared` is set the value is emitted as is, without
 * encoding, and folded only if `foldLines` is set as well
 */
export interface MimeNodePreparedHeaderValue {
    value?: unknown;
    prepared?: boolean;
    foldLines?: boolean;
}

/**
 * The values a header can hold: a string, a number, a Date (for the Date header), address
 * objects (for the address headers), a prepared value object, or a list of these
 */
export type MimeNodeHeaderValue =
    string | number | boolean | Date | MimeNodeAddress | MimeNodePreparedHeaderValue | MimeNodeHeaderValue[] | null | undefined;

/**
 * A single header, the shape the headers are stored in and one of the list forms
 * setHeader and addHeader accept
 */
export interface MimeNodeHeader {
    key: string;
    value: MimeNodeHeaderValue;
}

/**
 * Several headers keyed by header name
 */
export interface MimeNodeHeaderMap {
    [key: string]: MimeNodeHeaderValue;
}

/**
 * Several headers at once, as accepted by setHeader and addHeader: a single {key, value}
 * pair, a list of them, or an object keyed by header name
 */
export type MimeNodeHeaders = MimeNodeHeader | MimeNodeHeader[] | MimeNodeHeaderMap;

/**
 * A content descriptor object, see setContent. Points to the content instead of carrying it
 */
export interface MimeNodeContentObject {
    /** File path to read the content from */
    path?: string;
    /** URL to fetch the content from */
    href?: string;
    /** Request headers for a URL fetch */
    httpHeaders?: OutgoingHttpHeaders;
    /** TLS settings for a URL fetch, see nmfetch */
    tls?: { [key: string]: any };
    /** Read the content once and reuse the buffered value for every stream. MailComposer sets it on the icalEvent content, which is used twice */
    _resolve?: boolean;
    /** The buffered content once _resolve has run */
    _resolvedValue?: Buffer;
}

/**
 * Body content as accepted by setContent and setRaw: a string, a Buffer, a readable stream
 * or an object pointing to the content
 */
export type MimeNodeContent = string | Buffer | Readable | MimeNodeContentObject;

/**
 * SMTP envelope as returned by getEnvelope. Custom fields of an envelope set with
 * setEnvelope are carried along
 */
export interface MimeNodeEnvelope {
    from: string | false;
    to: string[];
    [key: string]: unknown;
}

/**
 * Envelope as accepted by setEnvelope. Recipients are collected from to, cc and bcc, any
 * other field is copied to the envelope as is
 */
export interface MimeNodeEnvelopeInput {
    from?: MimeNodeAddressInput;
    to?: MimeNodeAddressInput;
    cc?: MimeNodeAddressInput;
    bcc?: MimeNodeAddressInput;
    [key: string]: unknown;
}

/**
 * Parsed address headers as returned by getAddresses, keyed by lowercase header name
 */
export interface MimeNodeAddresses {
    from?: MimeNodeAddress[];
    sender?: MimeNodeAddress[];
    'reply-to'?: MimeNodeAddress[];
    to?: MimeNodeAddress[];
    cc?: MimeNodeAddress[];
    bcc?: MimeNodeAddress[];
}

/**
 * Options for createReadStream. Handed to the PassThrough the message is written to and to
 * the base64 / quoted-printable encoders, which read `lineLength` from it
 */
export interface MimeNodeStreamOptions extends TransformOptions {
    /** Maximum line length for base64 and quoted-printable bodies, false disables wrapping */
    lineLength?: number | false;
}

/**
 * A transform stream the message is piped through, or a function returning one
 */
export type MimeNodeTransform = Duplex | (() => Duplex);

/**
 * A post process function, takes the message stream and returns the stream to expose instead
 */
export type MimeNodeProcessFunc = (input: Readable) => Readable;

/**
 * Callback for build
 */
export type MimeNodeBuildCallback = (err: NodemailerError | null, message: Buffer) => void;

const FORMATTED_HEADERS = ['From', 'Sender', 'To', 'Cc', 'Bcc', 'Reply-To', 'Date', 'References'];

// RFC 5321 atext, plus the non-ascii bytes that SMTPUTF8 (RFC 6531) adds to it. A local part
// built from these, with '.' as a separator, is a dot-atom and can be emitted bare
const ATEXT = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~\\x80-\\uFFFF]";
const DOT_ATOM = new RegExp('^' + ATEXT + '+(?:\\.' + ATEXT + '+)*$');

// A complete quoted-string: everything between the outer quotes is either a plain char or
// a quoted-pair. Anchored, so a value that only starts and ends with a quote does not pass
const QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"$/;

// An address that carries no special anywhere can be emitted bare in a header, everything
// else goes into angle brackets so that the header can not be read as more addresses than
// the envelope carries
const PLAIN_ADDRESS = /^[^\s"(),:;<>@[\\\]]+@[^\s"(),:;<>@[\\\]]+$/;

// domainToASCII and domainToUnicode are WHATWG host parsers rather than plain IDNA
// mappers, so they do more than map: they cut the host at '/', '\\', '?' and '#', drop C0
// controls, and percent-decode. Handing them 'evil.example/mail.corp.example' returns the
// deliverable 'evil.example', which would turn a value the bundled codec leaves as
// unroutable garbage into mail for a domain the sender never named. None of these
// characters are legal in a domain, so keep them away from the mapper.
const URL_PARSER_UNSAFE = /[/\\?#%\x00-\x20\x7F]/;

/**
 * Encodes a domain the way browsers, the WHATWG URL Standard and DNS facing resolvers do,
 * which is with UTS-46 mapping applied before the Punycode step.
 *
 * The bundled codec is plain RFC 3492 and maps nothing, so it disagrees with every
 * conformant parser on any domain holding a mapped or ignored code point. An invisible
 * U+00AD in 'compa\u00ADny.com' encoded to 'xn--company-pka.com' where a validator reads
 * 'company.com', which let an allow-listed domain be checked and a different one mailed.
 *
 * Anything the URL parser does not accept as a hostname, an address literal such as
 * '[127.0.0.1]' included, comes back empty and falls through to the bundled codec, which
 * leaves those as they were supplied.
 *
 * @param domain Domain to encode, already lowercased by the caller
 * @param toUnicode Return the U-label form instead of the A-label form
 * @return Encoded domain
 */
function normalizeDomain(domain: string, toUnicode: boolean): string {
    // domainToASCII and domainToUnicode landed in Node 7, the bundled codec covers Node 6
    const mapper = toUnicode ? urlModule.domainToUnicode : urlModule.domainToASCII;

    if (typeof mapper === 'function' && !URL_PARSER_UNSAFE.test(domain)) {
        const mapped = mapper(domain);
        if (mapped) {
            return mapped;
        }
    }

    return toUnicode ? punycode.toUnicode(domain) : punycode.toASCII(domain);
}

/**
 * Creates a new mime tree node. Assumes 'multipart/*' as the content type
 * if it is a branch, anything else counts as leaf. If rootNode is missing from
 * the options, assumes this is the root.
 *
 * @param contentType Define the content type for the node. Can be left blank for attachments (derived from filename)
 * @param [options] optional options
 * @param [options.rootNode] root node for this tree
 * @param [options.parentNode] immediate parent for this node
 * @param [options.filename] filename for an attachment node
 * @param [options.baseBoundary] shared part of the unique multipart boundary
 * @param [options.keepBcc] If true, do not exclude Bcc from the generated headers
 * @param [options.normalizeHeaderKey] method to normalize header keys for custom caseing
 * @param [options.textEncoding] either 'Q' (the default) or 'B'
 */
class MimeNode {
    nodeCounter: number;
    baseBoundary: string;
    boundaryPrefix: string;
    disableFileAccess: boolean;
    disableUrlAccess: boolean;
    normalizeHeaderKey: MimeNodeOptions['normalizeHeaderKey'];
    date: Date | null;
    rootNode: MimeNode;
    keepBcc: boolean;
    textEncoding: string;
    parentNode: MimeNode | undefined;
    hostname: string | undefined;
    newline: string | undefined;
    childNodes: MimeNode[];
    _nodeId: number;
    _headers: MimeNodeHeader[];
    _isPlainText: boolean;
    _hasLongLines: boolean;
    _envelope: MimeNodeEnvelope | false;
    _raw: MimeNodeContent | Error | false;
    _transforms: MimeNodeTransform[];
    _processFuncs: MimeNodeProcessFunc[];

    // these are only set later, by setContent, setRaw and the header build, so they are
    // declared without a runtime field to keep the node shape the constructor produces
    /** Filename for this node. Useful with attachments */
    declare filename?: string;
    /** Body content, or the error a content stream emitted before it was read */
    declare content?: MimeNodeContent | Error;
    /** Lowercase content type, set when the headers are built */
    declare contentType?: string;
    /** Multipart subtype, false for a non-multipart node, set when the headers are built */
    declare multipart?: string | false;
    /** Multipart boundary, false for a non-multipart node, set when the headers are built */
    declare boundary?: string | false;
    declare _contentErrorHandler?: (err: Error) => void;

    constructor(contentType?: string | false, options?: MimeNodeOptions) {
        this.nodeCounter = 0;

        options = options || {};

        /**
         * shared part of the unique multipart boundary
         */
        this.baseBoundary = options.baseBoundary || crypto.randomBytes(8).toString('hex');
        this.boundaryPrefix = options.boundaryPrefix || '--_NmP';

        this.disableFileAccess = !!options.disableFileAccess;
        this.disableUrlAccess = !!options.disableUrlAccess;

        this.normalizeHeaderKey = options.normalizeHeaderKey;

        /**
         * If date headers is missing and current node is the root, this value is used instead
         */
        this.date = options.parentNode ? null : new Date();

        /**
         * Root node for current mime tree
         */
        this.rootNode = options.rootNode || this;

        /**
         * If true include Bcc in generated headers (if available)
         */
        this.keepBcc = !!options.keepBcc;

        /**
         * If filename is specified but contentType is not (probably an attachment)
         * detect the content type from filename extension
         */
        if (options.filename) {
            /**
             * Filename for this node. Useful with attachments
             */
            this.filename = options.filename;
            if (!contentType) {
                contentType = mimeFuncs.detectMimeType(this.filename.split('.').pop());
            }
        }

        /**
         * Indicates which encoding should be used for header strings: "Q" or "B"
         */
        this.textEncoding = (options.textEncoding || '').toString().trim().charAt(0).toUpperCase();

        /**
         * Immediate parent for this node (or undefined if not set)
         */
        this.parentNode = options.parentNode;

        /**
         * Hostname for default message-id values
         */
        this.hostname = options.hostname;

        /**
         * If set to 'win' then uses \r\n, if 'linux' then \n. If not set (or `raw` is used) then newlines are kept as is.
         */
        this.newline = options.newline;

        /**
         * An array for possible child nodes
         */
        this.childNodes = [];

        /**
         * Used for generating unique boundaries (prepended to the shared base)
         */
        this._nodeId = ++this.rootNode.nodeCounter;

        /**
         * A list of header values for this node in the form of [{key:'', value:''}]
         */
        this._headers = [];

        /**
         * True if the content only uses ASCII printable characters
         * @type {Boolean}
         */
        this._isPlainText = false;

        /**
         * True if the content is plain text but has longer lines than allowed
         * @type {Boolean}
         */
        this._hasLongLines = false;

        /**
         * If set, use instead this value for envelopes instead of generating one
         * @type {Boolean}
         */
        this._envelope = false;

        /**
         * If set then use this value as the stream content instead of building it
         * @type {String|Buffer|Stream}
         */
        this._raw = false;

        /**
         * Additional transform streams that the message will be piped before
         * exposing by createReadStream
         * @type {Array}
         */
        this._transforms = [];

        /**
         * Additional process functions that the message will be piped through before
         * exposing by createReadStream. These functions are run after transforms
         * @type {Array}
         */
        this._processFuncs = [];

        /**
         * If content type is set (or derived from the filename) add it to headers
         */
        if (contentType) {
            this.setHeader('Content-Type', contentType);
        }
    }

    /////// PUBLIC METHODS

    /**
     * Creates and appends a child node.Arguments provided are passed to MimeNode constructor
     *
     * @param [contentType] Optional content type
     * @param [options] Optional options object
     * @return Created node object
     */
    createChild(contentType?: string | false | MimeNodeOptions, options?: MimeNodeOptions): MimeNode {
        if (!options && typeof contentType === 'object') {
            options = contentType;
            contentType = undefined;
        }
        const node = new MimeNode(contentType as string | false | undefined, options);
        this.appendChild(node);
        return node;
    }

    /**
     * Appends an existing node to the mime tree. Removes the node from an existing
     * tree if needed
     *
     * @param childNode node to be appended
     * @return Appended node object
     */
    appendChild(childNode: MimeNode): MimeNode {
        // Take the node out of the tree it is in first. Leaving it there keeps it in that
        // parent's childNodes, so it still streams as part of the old tree while parentNode
        // already points at the new one, and anything read off the parent chain answers for
        // the wrong tree.
        if (childNode.parentNode && childNode.parentNode !== this) {
            childNode.remove();
        }

        if (childNode.rootNode !== this.rootNode) {
            childNode.rootNode = this.rootNode;
            childNode._nodeId = ++this.rootNode.nodeCounter;
        }

        childNode.parentNode = this;

        this.childNodes.push(childNode);
        return childNode;
    }

    /**
     * Replaces current node with another node
     *
     * @param node Replacement node
     * @return Replacement node
     */
    replace(node: MimeNode): MimeNode {
        if (node === this) {
            return this;
        }

        (this.parentNode as MimeNode).childNodes.forEach((childNode, i) => {
            if (childNode === this) {
                node.rootNode = this.rootNode;
                node.parentNode = this.parentNode;
                node._nodeId = this._nodeId;

                this.rootNode = this;
                this.parentNode = undefined;

                (node.parentNode as MimeNode).childNodes[i] = node;
            }
        });

        return node;
    }

    /**
     * Removes current node from the mime tree
     *
     * @return removed node
     */
    remove(): MimeNode | undefined {
        if (!this.parentNode) {
            return this;
        }

        for (let i = this.parentNode.childNodes.length - 1; i >= 0; i--) {
            if (this.parentNode.childNodes[i] === this) {
                this.parentNode.childNodes.splice(i, 1);
                this.parentNode = undefined;
                this.rootNode = this;
                return this;
            }
        }
    }

    /**
     * Sets a header value. If the value for selected key exists, it is overwritten.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param key Header key or a list of key value pairs
     * @param value Header value
     * @return current node
     */
    setHeader(key: string | MimeNodeHeaders, value?: MimeNodeHeaderValue): this {
        let added = false;

        // Allow setting multiple headers at once
        if (!value && key && typeof key === 'object') {
            // allow {key:'content-type', value: 'text/plain'}
            if ((key as MimeNodeHeader).key && 'value' in key) {
                this.setHeader((key as MimeNodeHeader).key, (key as MimeNodeHeader).value);
            } else if (Array.isArray(key)) {
                // allow [{key:'content-type', value: 'text/plain'}]
                key.forEach(i => {
                    this.setHeader(i.key, i.value);
                });
            } else {
                // allow {'content-type': 'text/plain'}
                Object.keys(key).forEach(i => {
                    this.setHeader(i, (key as MimeNodeHeaderMap)[i]);
                });
            }
            return this;
        }

        key = this._normalizeHeaderKey(key as string);

        const headerValue = {
            key,
            value
        };

        // Check if the value exists and overwrite
        for (let i = 0, len = this._headers.length; i < len; i++) {
            if (this._headers[i].key === key) {
                if (!added) {
                    // replace the first match
                    this._headers[i] = headerValue;
                    added = true;
                } else {
                    // remove following matches
                    this._headers.splice(i, 1);
                    i--;
                    len--;
                }
            }
        }

        // match not found, append the value
        if (!added) {
            this._headers.push(headerValue);
        }

        return this;
    }

    /**
     * Adds a header value. If the value for selected key exists, the value is appended
     * as a new field and old one is not touched.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param key Header key or a list of key value pairs
     * @param value Header value
     * @return current node
     */
    addHeader(key: string | MimeNodeHeaders, value?: MimeNodeHeaderValue): this {
        // Allow setting multiple headers at once
        if (!value && key && typeof key === 'object') {
            // allow {key:'content-type', value: 'text/plain'}
            if ((key as MimeNodeHeader).key && (key as MimeNodeHeader).value) {
                this.addHeader((key as MimeNodeHeader).key, (key as MimeNodeHeader).value);
            } else if (Array.isArray(key)) {
                // allow [{key:'content-type', value: 'text/plain'}]
                key.forEach(i => {
                    this.addHeader(i.key, i.value);
                });
            } else {
                // allow {'content-type': 'text/plain'}
                Object.keys(key).forEach(i => {
                    this.addHeader(i, (key as MimeNodeHeaderMap)[i]);
                });
            }
            return this;
        } else if (Array.isArray(value)) {
            value.forEach(val => {
                this.addHeader(key, val);
            });
            return this;
        }

        this._headers.push({
            key: this._normalizeHeaderKey(key as string),
            value
        });

        return this;
    }

    /**
     * Retrieves the first mathcing value of a selected key
     *
     * @param key Key to search for
     * @retun Value for the key
     */
    getHeader(key: string): MimeNodeHeaderValue {
        key = this._normalizeHeaderKey(key);
        for (let i = 0, len = this._headers.length; i < len; i++) {
            if (this._headers[i].key === key) {
                return this._headers[i].value;
            }
        }
    }

    /**
     * Sets body content for current node. If the value is a string, charset is added automatically
     * to Content-Type (if it is text/*). If the value is a Buffer, you need to specify
     * the charset yourself
     *
     * @param content Body content
     * @return current node
     */
    setContent(content: MimeNodeContent): this {
        this.content = content;
        if (typeof (this.content as Readable).pipe === 'function') {
            // pre-stream handler. might be triggered if a stream is set as content
            // and 'error' fires before anything is done with this stream
            this._contentErrorHandler = err => {
                (this.content as Readable).removeListener('error', this._contentErrorHandler as (err: Error) => void);
                this.content = err;
            };
            (this.content as Readable).once('error', this._contentErrorHandler);
        } else if (typeof this.content === 'string') {
            this._isPlainText = mimeFuncs.isPlainText(this.content);
            if (this._isPlainText && mimeFuncs.hasLongerLines(this.content, 76)) {
                // If there are lines longer than 76 symbols/bytes do not use 7bit
                this._hasLongLines = true;
            }
        }
        return this;
    }

    build(): Promise<Buffer>;
    build(callback: MimeNodeBuildCallback): void;
    build(callback?: MimeNodeBuildCallback): Promise<Buffer> | void {
        let promise: Promise<Buffer> | undefined;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }
        const done = callback as ResultCallback<Buffer>;

        const stream = this.createReadStream();
        const buf: Buffer[] = [];
        let buflen = 0;
        let returned = false;

        stream.on('readable', () => {
            let chunk: Buffer;

            while ((chunk = stream.read()) !== null) {
                buf.push(chunk);
                buflen += chunk.length;
            }
        });

        stream.once('error', err => {
            if (returned) {
                return;
            }
            returned = true;

            return done(err);
        });

        stream.once('end', (chunk?: Buffer) => {
            if (returned) {
                return;
            }
            returned = true;

            if (chunk && chunk.length) {
                buf.push(chunk);
                buflen += chunk.length;
            }
            return done(null, Buffer.concat(buf, buflen));
        });

        return promise;
    }

    getTransferEncoding(): string | false {
        let transferEncoding: string | false = false;
        const contentType = (this.getHeader('Content-Type') || '').toString().toLowerCase().trim();

        if (this.content) {
            transferEncoding = (this.getHeader('Content-Transfer-Encoding') || '').toString().toLowerCase().trim();
            if (!transferEncoding || !['base64', 'quoted-printable'].includes(transferEncoding)) {
                if (/^text\//i.test(contentType)) {
                    // If there are no special symbols, no need to modify the text
                    if (this._isPlainText && !this._hasLongLines) {
                        transferEncoding = '7bit';
                    } else if (typeof this.content === 'string' || this.content instanceof Buffer) {
                        // detect preferred encoding for string value
                        transferEncoding = this._getTextEncoding(this.content) === 'Q' ? 'quoted-printable' : 'base64';
                    } else {
                        // we can not check content for a stream, so either use preferred encoding or fallback to QP
                        transferEncoding = this.textEncoding === 'B' ? 'base64' : 'quoted-printable';
                    }
                } else if (!/^(multipart|message)\//i.test(contentType)) {
                    transferEncoding = transferEncoding || 'base64';
                }
            }
        }
        return transferEncoding;
    }

    /**
     * Builds the header block for the mime node. Append \r\n\r\n before writing the content
     *
     * @returns Headers
     */
    buildHeaders(): string {
        const transferEncoding = this.getTransferEncoding();
        const headers: string[] = [];

        if (transferEncoding) {
            this.setHeader('Content-Transfer-Encoding', transferEncoding);
        }

        if (this.filename && !this.getHeader('Content-Disposition')) {
            this.setHeader('Content-Disposition', 'attachment');
        }

        // Ensure mandatory header fields
        if (this.rootNode === this) {
            if (!this.getHeader('Date')) {
                this.setHeader('Date', (this.date as Date).toUTCString().replace(/GMT/, '+0000'));
            }

            // ensure that Message-Id is present
            this.messageId();

            if (!this.getHeader('MIME-Version')) {
                this.setHeader('MIME-Version', '1.0');
            }

            // Ensure that Content-Type is the last header for the root node
            for (let i = this._headers.length - 2; i >= 0; i--) {
                const header = this._headers[i];
                if (header.key === 'Content-Type') {
                    this._headers.splice(i, 1);
                    this._headers.push(header);
                }
            }
        }

        this._headers.forEach(header => {
            let key = header.key;
            let value: any = header.value;
            let structured: mimeFuncs.ParsedHeaderValue;
            let param: string;
            const options: { prepared?: boolean; foldLines?: boolean } = {};
            const formattedHeaders = FORMATTED_HEADERS;

            if (value && typeof value === 'object' && !formattedHeaders.includes(key)) {
                // the keys come from a caller supplied header object and `options.prepared`
                // below decides whether the value is emitted raw, so an own "__proto__" key
                // here would turn an unfolded value into header injection
                shared.copyOwnKeys(options, value, optionKey => optionKey === 'value');
                value = (value.value || '').toString();
                if (!value.trim()) {
                    return;
                }
            }

            if (options.prepared) {
                // header value is
                if (options.foldLines) {
                    headers.push(mimeFuncs.foldLines(key + ': ' + value));
                } else {
                    headers.push(key + ': ' + value);
                }
                return;
            }

            switch (header.key) {
                case 'Content-Disposition':
                    structured = mimeFuncs.parseHeaderValue(value);
                    if (this.filename) {
                        structured.params.filename = this.filename;
                    }
                    value = mimeFuncs.buildHeaderValue(structured);
                    break;

                case 'Content-Type':
                    structured = mimeFuncs.parseHeaderValue(value);

                    // the type token decides multipart and charset below, so clean it before
                    // those run and not just on the way out, otherwise a control char makes
                    // the checks miss and the header ends up claiming a type it is not set up for
                    structured.value = (structured.value || '').toString().replace(/[\x00-\x1f\x7f]/g, '');

                    this._handleContentType(structured);

                    if (
                        structured.value.match(/^text\/plain\b/) &&
                        typeof this.content === 'string' &&
                        /[\u0080-\uFFFF]/.test(this.content)
                    ) {
                        structured.params.charset = 'utf-8';
                    }

                    value = mimeFuncs.buildHeaderValue(structured);

                    if (this.filename) {
                        // add support for non-compliant clients like QQ webmail
                        // we can't build the value with buildHeaderValue as the value is non standard and
                        // would be converted to parameter continuation encoding that we do not want
                        // control chars can not be quoted here: HT is a fold point that unfolding would
                        // turn into a space, CR/LF can not appear in a header at all and DEL is not
                        // qtext, so force the mime encoded word that a non-ascii filename would get anyway
                        param = /[\x00-\x1f\x7f]/.test(this.filename)
                            ? mimeFuncs.encodeWord(this.filename, this._getTextEncoding(this.filename), 52)
                            : this._encodeWords(this.filename);

                        if (param !== this.filename || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(param)) {
                            // include value in quotes if needed, escaping backslashes and quotes as
                            // quoted-pairs exactly like buildHeaderValue does for filename=, otherwise
                            // a trailing backslash would escape the closing quote
                            param = JSON.stringify(param);
                        }
                        value += '; name=' + param;
                    }
                    break;

                case 'Bcc':
                    if (!this.keepBcc) {
                        // skip BCC values
                        return;
                    }
                    break;
            }

            value = this._encodeHeaderValue(key, value);

            // skip empty lines
            if (!(value || '').toString().trim()) {
                return;
            }

            if (typeof this.normalizeHeaderKey === 'function') {
                const normalized = this.normalizeHeaderKey(key, value);
                // the result replaces the key on the way into the header, so it gets the same
                // treatment the key it replaces already had. a line break here would end the
                // header and start one of the caller's own
                const cleaned = typeof normalized === 'string' ? normalized.replace(/[\x00-\x1f\x7f]/g, '') : '';
                if (cleaned) {
                    key = cleaned;
                }
            }

            headers.push(mimeFuncs.foldLines(key + ': ' + value, 76));
        });

        return headers.join('\r\n');
    }

    /**
     * Streams the rfc2822 message from the current node. If this is a root node,
     * mandatory header fields are set if missing (Date, Message-Id, MIME-Version)
     *
     * @return Compiled message
     */
    createReadStream(options?: MimeNodeStreamOptions): Readable {
        options = options || {};

        const stream = new PassThrough(options);
        let outputStream: Readable = stream;
        let transform: Duplex | MimeNodeProcessFunc;

        this.stream(stream, options, err => {
            if (err) {
                outputStream.emit('error', err);
                return;
            }
            stream.end();
        });

        for (let i = 0, len = this._transforms.length; i < len; i++) {
            transform =
                typeof this._transforms[i] === 'function' ? (this._transforms[i] as () => Duplex)() : (this._transforms[i] as Duplex);
            outputStream.once('error', err => {
                (transform as Duplex).emit('error', err);
            });
            outputStream = outputStream.pipe(transform);
        }

        // ensure terminating newline after possible user transforms
        transform = new LastNewline();
        outputStream.once('error', err => {
            (transform as Duplex).emit('error', err);
        });
        outputStream = outputStream.pipe(transform);

        // dkim and stuff
        for (let i = 0, len = this._processFuncs.length; i < len; i++) {
            transform = this._processFuncs[i];
            outputStream = transform(outputStream);
        }

        if (this.newline) {
            const winbreak = ['win', 'windows', 'dos', '\r\n'].includes(this.newline.toString().toLowerCase());
            const newlineTransform = winbreak ? new LeWindows() : new LeUnix();

            const stream = outputStream.pipe(newlineTransform);
            outputStream.on('error', err => stream.emit('error', err));
            return stream;
        }

        return outputStream;
    }

    /**
     * Appends a transform stream object to the transforms list. Final output
     * is passed through this stream before exposing
     *
     * @param transform Read-Write stream
     */
    transform(transform: MimeNodeTransform): void {
        this._transforms.push(transform);
    }

    /**
     * Appends a post process function. The functon is run after transforms and
     * uses the following syntax
     *
     *   processFunc(input) -> outputStream
     *
     * @param processFunc Read-Write stream
     */
    processFunc(processFunc: MimeNodeProcessFunc): void {
        this._processFuncs.push(processFunc);
    }

    stream(outputStream: Writable, options: MimeNodeStreamOptions, done: (err?: Error | null) => void): void {
        const transferEncoding = this.getTransferEncoding();
        let contentStream: Transform;
        let localStream: Readable;

        // protect actual callback against multiple triggering
        let returned = false;
        const callback = (err?: Error | null) => {
            if (returned) {
                return;
            }
            returned = true;
            done(err);
        };

        // for multipart nodes, push child nodes
        // for content nodes end the stream
        const finalize = () => {
            let childId = 0;
            const processChildNode = () => {
                if (childId >= this.childNodes.length) {
                    outputStream.write('\r\n--' + this.boundary + '--\r\n');
                    return callback();
                }
                const child = this.childNodes[childId++];
                outputStream.write((childId > 1 ? '\r\n' : '') + '--' + this.boundary + '\r\n');
                child.stream(outputStream, options, err => {
                    if (err) {
                        return callback(err);
                    }
                    setImmediate(processChildNode);
                });
            };

            if (this.multipart) {
                setImmediate(processChildNode);
            } else {
                return callback();
            }
        };

        // pushes node content
        const sendContent = () => {
            if (this.content) {
                if (Object.prototype.toString.call(this.content) === '[object Error]') {
                    // content is already errored
                    return callback(this.content as Error);
                }

                if (typeof (this.content as Readable).pipe === 'function') {
                    (this.content as Readable).removeListener('error', this._contentErrorHandler as (err: Error) => void);
                    this._contentErrorHandler = err => callback(err);
                    (this.content as Readable).once('error', this._contentErrorHandler);
                }

                const createStream = () => {
                    if (['quoted-printable', 'base64'].includes(transferEncoding as string)) {
                        contentStream = new (transferEncoding === 'base64' ? base64 : qp).Encoder(options);

                        contentStream.pipe(outputStream, {
                            end: false
                        });
                        contentStream.once('end', finalize);
                        contentStream.once('error', err => callback(err));

                        localStream = this._getStream(this.content);
                        localStream.pipe(contentStream);
                    } else {
                        // anything that is not QP or Base54 passes as-is
                        localStream = this._getStream(this.content);
                        localStream.pipe(outputStream, {
                            end: false
                        });
                        localStream.once('end', finalize);
                    }

                    localStream.once('error', err => callback(err));
                };

                if ((this.content as MimeNodeContentObject)._resolve) {
                    const chunks: Buffer[] = [];
                    let chunklen = 0;
                    let returned = false;
                    const sourceStream = this._getStream(this.content);
                    sourceStream.on('error', err => {
                        if (returned) {
                            return;
                        }
                        returned = true;
                        callback(err);
                    });
                    sourceStream.on('readable', () => {
                        let chunk: Buffer;
                        while ((chunk = sourceStream.read()) !== null) {
                            chunks.push(chunk);
                            chunklen += chunk.length;
                        }
                    });
                    sourceStream.on('end', () => {
                        if (returned) {
                            return;
                        }
                        returned = true;
                        (this.content as MimeNodeContentObject)._resolve = false;
                        (this.content as MimeNodeContentObject)._resolvedValue = Buffer.concat(chunks, chunklen);
                        setImmediate(createStream);
                    });
                } else {
                    setImmediate(createStream);
                }
                return;
            }
            return setImmediate(finalize);
        };

        if (this._raw) {
            setImmediate(() => {
                if (Object.prototype.toString.call(this._raw) === '[object Error]') {
                    // content is already errored
                    return callback(this._raw as Error);
                }

                // remove default error handler (if set)
                if (typeof (this._raw as Readable).pipe === 'function') {
                    (this._raw as Readable).removeListener('error', this._contentErrorHandler as (err: Error) => void);
                }

                const raw = this._getStream(this._raw);
                raw.pipe(outputStream, {
                    end: false
                });
                raw.on('error', err => outputStream.emit('error', err));
                raw.on('end', finalize);
            });
        } else {
            outputStream.write(this.buildHeaders() + '\r\n\r\n');
            setImmediate(sendContent);
        }
    }

    /**
     * Sets envelope to be used instead of the generated one
     *
     * @return SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
     */
    setEnvelope(envelope: MimeNodeEnvelopeInput): this {
        let list: MimeNodeAddress[];

        this._envelope = {
            from: false,
            to: []
        };

        if (envelope.from) {
            list = [];
            this._convertAddresses(this._parseEnvelopeAddresses(envelope.from), list);
            list = list.filter(address => address && address.address);
            if (list.length && list[0]) {
                this._envelope.from = list[0].address as string;
            }
        }
        const seenRecipients = new Set<string>();
        const recipients: MimeNodeAddress[] = [];
        ['to', 'cc', 'bcc'].forEach(key => {
            if (envelope[key]) {
                this._convertAddresses(this._parseEnvelopeAddresses(envelope[key] as MimeNodeAddressInput), recipients, seenRecipients);
            }
        });

        this._envelope.to = recipients.map(to => to.address as string).filter(address => address);

        const standardFields = ['to', 'cc', 'bcc', 'from'];
        shared.copyOwnKeys(this._envelope, envelope, key => standardFields.includes(key));

        return this;
    }

    /**
     * Generates and returns an object with parsed address fields
     *
     * @return Address object
     */
    getAddresses(): MimeNodeAddresses {
        const addresses: MimeNodeAddresses = {};
        const seenByKey = new Map<string, Set<string>>();

        this._headers.forEach(header => {
            const key = header.key.toLowerCase() as keyof MimeNodeAddresses;
            if (['from', 'sender', 'reply-to', 'to', 'cc', 'bcc'].includes(key)) {
                if (!Array.isArray(addresses[key])) {
                    addresses[key] = [];
                    seenByKey.set(key, new Set());
                }

                this._convertAddresses(this._parseAddresses(header.value as MimeNodeAddressInput), addresses[key], seenByKey.get(key));
            }
        });

        return addresses;
    }

    /**
     * Generates and returns SMTP envelope with the sender address and a list of recipients addresses
     *
     * @return SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
     */
    getEnvelope(): MimeNodeEnvelope {
        if (this._envelope) {
            return this._envelope;
        }

        const envelope: MimeNodeEnvelope = {
            from: false,
            to: []
        };

        // Built once and carried across the headers. Letting _convertAddresses seed it per
        // call would cost O(headers x recipients), and a message can carry many address
        // headers: `headers: { to: [...] }` emits one To per entry.
        const seenRecipients = new Set<string>();
        const recipients: MimeNodeAddress[] = [];

        this._headers.forEach(header => {
            const list: MimeNodeAddress[] = [];
            if (header.key === 'From' || (!envelope.from && ['Reply-To', 'Sender'].includes(header.key))) {
                this._convertAddresses(this._parseAddresses(header.value as MimeNodeAddressInput), list);
                if (list.length && list[0]) {
                    envelope.from = list[0].address as string;
                }
            } else if (['To', 'Cc', 'Bcc'].includes(header.key)) {
                this._convertAddresses(this._parseAddresses(header.value as MimeNodeAddressInput), recipients, seenRecipients);
            }
        });

        envelope.to = recipients.map(to => to.address as string);

        return envelope;
    }

    /**
     * Returns Message-Id value. If it does not exist, then creates one
     *
     * @return Message-Id value
     */
    messageId(): string {
        let messageId = this.getHeader('Message-ID') as string;
        // You really should define your own Message-Id field!
        if (!messageId) {
            messageId = this._generateMessageId();
            this.setHeader('Message-ID', messageId);
        }
        return messageId;
    }

    /**
     * Sets pregenerated content that will be used as the output of this node
     *
     * @param raw Raw MIME contents
     */
    setRaw(raw: MimeNodeContent): this {
        this._raw = raw;

        if (this._raw && typeof (this._raw as Readable).pipe === 'function') {
            // pre-stream handler. might be triggered if a stream is set as content
            // and 'error' fires before anything is done with this stream
            this._contentErrorHandler = err => {
                (this._raw as Readable).removeListener('error', this._contentErrorHandler as (err: Error) => void);
                this._raw = err;
            };
            (this._raw as Readable).once('error', this._contentErrorHandler);
        }

        return this;
    }

    /////// PRIVATE METHODS

    /**
     * Checks an access policy flag for this node and every node above it. The flags are set
     * from the options the node was built with, and createChild only ever sees the options
     * the caller passed, so a child of a closed tree starts out open. Reading the answer off
     * the parent chain keeps it right whatever order the tree was assembled in.
     *
     * @param flag Either 'disableFileAccess' or 'disableUrlAccess'
     * @return true if this node or an ancestor closed that access
     */
    _accessDisabled(flag: 'disableFileAccess' | 'disableUrlAccess'): boolean {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let node: MimeNode | undefined = this;
        while (node) {
            if (node[flag]) {
                return true;
            }
            node = node.parentNode;
        }
        return false;
    }

    /**
     * Detects and returns handle to a stream related with the content.
     *
     * @param content Node content
     * @returns Stream object
     */
    _getStream(content: any): Readable {
        let contentStream: PassThrough;

        if (content._resolvedValue) {
            // pass string or buffer content as a stream
            contentStream = new PassThrough();

            setImmediate(() => {
                try {
                    contentStream.end(content._resolvedValue);
                } catch (_err) {
                    contentStream.emit('error', _err);
                }
            });

            return contentStream;
        }

        if (typeof content.pipe === 'function') {
            // assume as stream
            return content;
        }

        if (content && typeof content.path === 'string' && !content.href) {
            if (this._accessDisabled('disableFileAccess')) {
                contentStream = new PassThrough();
                setImmediate(() => {
                    const err: NodemailerError = new Error('File access rejected for ' + content.path);
                    err.code = errors.EFILEACCESS;
                    contentStream.emit('error', err);
                });
                return contentStream;
            }
            // read file
            return fs.createReadStream(content.path);
        }

        if (content && typeof content.href === 'string') {
            if (this._accessDisabled('disableUrlAccess')) {
                contentStream = new PassThrough();
                setImmediate(() => {
                    const err: NodemailerError = new Error('Url access rejected for ' + content.href);
                    err.code = errors.EURLACCESS;
                    contentStream.emit('error', err);
                });
                return contentStream;
            }
            // fetch URL. nmfetch refuses any scheme that is not http(s), and it decides
            // that on the parsed URL. Testing the raw string here instead would reject
            // forms the parser accepts, such as a leading space or a slash-less authority
            return nmfetch(content.href, { headers: content.httpHeaders, tls: content.tls });
        }

        // pass string or buffer content as a stream
        contentStream = new PassThrough();

        setImmediate(() => {
            try {
                contentStream.end(content || '');
            } catch (_err) {
                contentStream.emit('error', _err);
            }
        });
        return contentStream;
    }

    /**
     * Parses addresses. Takes in a single address or an array or an
     * array of address arrays (eg. To: [[first group], [second group],...])
     *
     * @param addresses Addresses to be parsed
     * @return An array of address objects
     */
    _parseAddresses(addresses: MimeNodeAddressInput | undefined): MimeNodeAddress[] {
        // Collected into one list as we go. concat.apply spreads the entries into arguments
        // and throws a RangeError once a recipient array is long enough to pass the
        // argument limit, which a large Bcc list reaches on its own.
        const flattened: MimeNodeAddress[] = [];

        ([] as any[]).concat(addresses).forEach(address => {
            if (address && address.address) {
                const normalized = this._normalizeAddress(address.address);
                if (normalized === address.address && typeof address.name === 'string') {
                    // there is nothing to rewrite, so there is nothing to keep off the original
                    flattened.push(address);
                    return;
                }

                // rewriting would land on the object the caller passed in and might
                // still hold a reference to, so rewrite a copy of it instead. An own
                // "__proto__" key would make the copy inherit from caller data, and
                // _convertAddresses reads `group` off it straight into the envelope
                const copy = shared.copyOwnKeys({} as MimeNodeAddress, address);
                copy.address = normalized;
                copy.name = address.name || '';
                flattened.push(copy);
                return;
            }

            const parsed = this._normalizeParsedAddresses(addressparser(address));
            for (let i = 0; i < parsed.length; i++) {
                flattened.push(parsed[i]);
            }
        });

        return flattened;
    }

    /**
     * Normalizes the addresses of a freshly parsed address list, groups included.
     *
     * Everything this method returns carries a normalized address, whether it arrived as an
     * object or was parsed out of a header value. Without this the two shapes disagree, and
     * a consumer reading the parsed form back is handed the ambiguous
     * 'user@evil.com@good.com' that the header and the envelope no longer carry.
     *
     * @param parsed An array of address objects, as returned by addressparser
     * @return The same array, with every address normalized
     */
    _normalizeParsedAddresses(parsed: Address[]): Address[] {
        // addressparser builds these objects, so no caller holds a reference to rewrite around
        parsed.forEach(entry => {
            if (entry.address) {
                entry.address = this._normalizeAddress(entry.address);
            } else if (entry.group) {
                this._normalizeParsedAddresses(entry.group);
            }
        });

        return parsed;
    }

    /**
     * Parses the addresses of an explicitly set envelope.
     *
     * An envelope value is an addr-spec and never a display name, so a bare local username
     * such as 'root' is the address here. Header parsing has to read the same value as a
     * display name, as a value with no '@' in it can not be an addr-spec in a header.
     *
     * @param addresses Addresses to be parsed
     * @return An array of address objects
     */
    _parseEnvelopeAddresses(addresses: MimeNodeAddressInput | undefined): MimeNodeAddress[] {
        return this._parseAddresses(addresses).map(entry => {
            if (entry.address || entry.group || !entry.name || /[\s@]/.test(entry.name)) {
                return entry;
            }
            return { address: this._normalizeAddress(entry.name), name: '' };
        });
    }

    /**
     * Normalizes a header key, uses Camel-Case form, except for uppercase MIME-
     *
     * @param key Key to be normalized
     * @return key in Camel-Case form
     */
    _normalizeHeaderKey(key: string): string {
        key = (key || '')
            .toString()
            // no newlines in keys
            .replace(/\r?\n|\r/g, ' ')
            // a field name is printable ascii without the colon, so a control char or DEL
            // can only be dropped, there is no quoting construct around a field name
            .replace(/[\x00-\x1f\x7f]/g, '')
            .trim()
            .toLowerCase()
            // use uppercase words, except MIME
            .replace(/^X-SMTPAPI$|^(MIME|DKIM|ARC|BIMI)\b|^[a-z]|-(SPF|FBL|ID|MD5)$|-[a-z]/gi, c => c.toUpperCase())
            // special case
            .replace(/^Content-Features$/i, 'Content-features');

        return key;
    }

    /**
     * Checks if the content type is multipart and defines boundary if needed.
     * Doesn't return anything, modifies object argument instead.
     *
     * @param structured Parsed header value for 'Content-Type' key
     */
    _handleContentType(structured: mimeFuncs.StructuredHeaderValue): void {
        this.contentType = (structured.value as string).trim().toLowerCase();

        this.multipart = /^multipart\//i.test(this.contentType) ? this.contentType.substr(this.contentType.indexOf('/') + 1) : false;

        if (this.multipart) {
            this.boundary = (structured.params as Record<string, string>).boundary =
                (structured.params as Record<string, string>).boundary || this.boundary || this._generateBoundary();
        } else {
            this.boundary = false;
        }
    }

    /**
     * Generates a multipart boundary value
     *
     * @return boundary value
     */
    _generateBoundary(): string {
        return this.rootNode.boundaryPrefix + '-' + this.rootNode.baseBoundary + '-Part_' + this._nodeId;
    }

    /**
     * Encodes a header value for use in the generated rfc2822 email.
     *
     * @param key Header key
     * @param value Header value
     */
    _encodeHeaderValue(key: string, value: MimeNodeHeaderValue): string {
        key = this._normalizeHeaderKey(key);

        switch (key) {
            // Structured headers
            case 'From':
            case 'Sender':
            case 'To':
            case 'Cc':
            case 'Bcc':
            case 'Reply-To':
                return this._convertAddresses(this._parseAddresses(value as MimeNodeAddressInput));

            // values enclosed in <>
            case 'Message-ID':
            case 'In-Reply-To':
            case 'Content-Id':
                // a msg-id is structured, so an encoded word inside the angle brackets would
                // be read as literal text. drop the characters that can not appear in a header
                // at all, but leave HT alone, it separates the ids of a multi id value
                value = (value || '')
                    .toString()
                    .replace(/\r?\n|\r/g, ' ')
                    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

                if (value.charAt(0) !== '<') {
                    value = '<' + value;
                }

                if (value.charAt(value.length - 1) !== '>') {
                    value = value + '>';
                }
                return value;

            // space separated list of values enclosed in <>
            case 'References':
                value = ([] as string[]).concat
                    .apply(
                        [],
                        ([] as MimeNodeHeaderValue[]).concat(value || '').map(elm => {
                            elm = (elm || '')
                                .toString()
                                .replace(/\r?\n|\r/g, ' ')
                                .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
                                .trim();
                            return elm.replace(/<[^>]*>/g, str => str.replace(/\s/g, '')).split(/\s+/);
                        })
                    )
                    .map(elm => {
                        if (elm.charAt(0) !== '<') {
                            elm = '<' + elm;
                        }
                        if (elm.charAt(elm.length - 1) !== '>') {
                            elm = elm + '>';
                        }
                        return elm;
                    });

                return value.join(' ').trim();

            case 'Date':
                if (Object.prototype.toString.call(value) === '[object Date]') {
                    return (value as Date).toUTCString().replace(/GMT/, '+0000');
                }

                value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                return this._encodeHeaderText(value);

            case 'Content-Type':
            case 'Content-Disposition':
                // if it includes a filename then it is already encoded
                return (value || '').toString().replace(/\r?\n|\r/g, ' ');

            default:
                value = (value || '').toString().replace(/\r?\n|\r/g, ' ');
                return this._encodeHeaderText(value);
        }
    }

    /**
     * Rebuilds address object using punycode and other adjustments
     *
     * @param addresses An array of address objects
     * @param [uniqueList] An array to be populated with addresses
     * @return address string
     */
    _convertAddresses(
        addresses: MimeNodeAddress | MimeNodeAddress[] | undefined,
        uniqueList?: MimeNodeAddress[],
        seenAddresses?: Set<string>
    ): string {
        const values: string[] = [];

        uniqueList = uniqueList || [];

        // Membership is checked once per address, so scanning uniqueList itself would make
        // a recipient list cost O(n^2). Groups recurse with the same set so that a nested
        // group still dedupes against the addresses collected around it, and a caller that
        // passes a partly filled list (To, then Cc, then Bcc) keeps deduping across headers.
        if (!seenAddresses) {
            seenAddresses = new Set();
            for (let i = 0; i < uniqueList.length; i++) {
                seenAddresses.add(uniqueList[i].address as string);
            }
        }

        ([] as MimeNodeAddress[]).concat(addresses || []).forEach(address => {
            if (address.address) {
                address.address = this._normalizeAddress(address.address);

                if (!address.name) {
                    // an address that carries a special, be it a quoted local part or a domain
                    // that could not be normalized, is only unambiguous inside angle brackets.
                    // Without them a ',' or a ';' anywhere in it reads as a recipient separator
                    // and the header would list more recipients than the envelope carries
                    values.push(PLAIN_ADDRESS.test(address.address) ? address.address : `<${address.address}>`);
                } else {
                    values.push(`${this._encodeAddressName(address.name)} <${address.address}>`);
                }

                if (!seenAddresses.has(address.address)) {
                    seenAddresses.add(address.address);
                    uniqueList.push(address);
                }
            } else if (address.group) {
                const groupListAddresses = (
                    address.group.length ? this._convertAddresses(address.group, uniqueList, seenAddresses) : ''
                ).trim();
                values.push(`${this._encodeAddressName(address.name as string)}:${groupListAddresses};`);
            }
        });

        return values.join(', ');
    }

    /**
     * Normalizes an email address
     *
     * @param address An array of address objects
     * @return address string
     */
    _normalizeAddress(address?: string | false): string {
        address = (address || '')
            .toString()
            .replace(/[\x00-\x1F\x7F<>]+/g, ' ') // remove unallowed characters
            .trim();

        if (!address) {
            // callers use an empty value to detect a missing address
            return address;
        }

        const lastAt = address.lastIndexOf('@');
        if (lastAt < 0) {
            // Bare username, there is no domain to split off
            return this._normalizeLocalPart(address);
        }

        const user = address.substr(0, lastAt);
        const domain = address.substr(lastAt + 1);

        // Unicode in the local part is kept as is, see _normalizeLocalPart for the rest of it.
        // A domain has no quoting construct to fall back on, so whatever is not a valid domain
        // is kept as supplied and it is _convertAddresses that keeps such an address unambiguous.
        // Domains are punycoded when the local part is ASCII ('safe@jõgeva.ee' -> 'safe@xn--jgeva-dua.ee').
        // When the local part contains non-ASCII bytes the address already requires SMTPUTF8,
        // so the domain is kept (or decoded back) as UTF-8 for symmetry on both sides of '@'.

        let encodedDomain = domain;

        // A non-ASCII local part already requires SMTPUTF8, so the domain stays UTF-8 for
        // symmetry on both sides of the '@' rather than being encoded to an A-label
        const smtputf8 = /[\x80-\uFFFF]/.test(user);

        try {
            encodedDomain = normalizeDomain(domain.toLowerCase(), smtputf8);
        } catch (_err) {
            // keep domain as supplied
        }

        return `${this._normalizeLocalPart(user)}@${encodedDomain}`;
    }

    /**
     * Normalizes the local part of an address into a form that can be emitted as is.
     *
     * A local part is either a dot-atom or a quoted-string, anything else is not a valid
     * addr-spec. The quotes of a quoted local part get lost along the way, and a bare
     * 'user@evil.com@good.com' leaves it to the receiver which '@' splits the domain off,
     * while the split here is always at the last one. So whatever is not already one of
     * the two valid forms goes back out as a quoted-string.
     *
     * @param user Local part of an address
     * @return Local part as a dot-atom or as a quoted-string
     */
    _normalizeLocalPart(user: string): string {
        if (DOT_ATOM.test(user) || QUOTED_STRING.test(user)) {
            return user;
        }

        return mimeFuncs.quoteString(user);
    }

    /**
     * If needed, mime encodes the name part
     *
     * @param name Name part of an address
     * @returns Mime word encoded string if needed
     */
    _encodeAddressName(name: string): string {
        if (!/^[\w ]*$/.test(name)) {
            if (/^[\x20-\x7e]*$/.test(name)) {
                return mimeFuncs.quoteString(name);
            } else {
                return mimeFuncs.encodeWord(name, this._getTextEncoding(name), 52);
            }
        }
        return name;
    }

    /**
     * Encodes an unstructured header value. Such a value can only carry VCHAR and WSP, so a
     * control char or DEL has to be forced into the mime encoded word that a non-ascii value
     * would get anyway. HT stays as it is, it is valid folding whitespace here.
     *
     * @param value Header value to encode
     * @returns Mime word encoded string if needed
     */
    _encodeHeaderText(value: string): string {
        return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
            ? mimeFuncs.encodeWord(value, this._getTextEncoding(value), 52)
            : // encodeWords only encodes if needed, otherwise the original string is returned
              this._encodeWords(value);
    }

    /**
     * If needed, mime encodes the name part
     *
     * @param name Name part of an address
     * @returns Mime word encoded string if needed
     */
    _encodeWords(value: string): string {
        // set encodeAll parameter to true even though it is against the recommendation of RFC2047,
        // by default only words that include non-ascii should be converted into encoded words
        // but some clients (eg. Zimbra) do not handle it properly and remove surrounding whitespace
        return mimeFuncs.encodeWords(value, this._getTextEncoding(value), 52, true);
    }

    /**
     * Detects best mime encoding for a text value
     *
     * @param value Value to check for
     * @return either 'Q' or 'B'
     */
    _getTextEncoding(value?: string | Buffer): string {
        value = (value || '').toString();

        if (this.textEncoding) {
            return this.textEncoding;
        }

        // count latin alphabet symbols and 8-bit range symbols + control symbols
        // if there are more latin characters, then use quoted-printable
        // encoding, otherwise use base64
        let nonLatinLen = 0;
        let latinLen = 0;
        for (let i = 0, len = value.length; i < len; i++) {
            const code = value.charCodeAt(i);
            if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code >= 0x80) {
                nonLatinLen++;
            } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
                latinLen++;
            }
        }
        // if there are more latin symbols than binary/unicode, then prefer Q, otherwise B
        return nonLatinLen < latinLen ? 'Q' : 'B';
    }

    /**
     * Generates a message id
     *
     * @return Random Message-ID value
     */
    _generateMessageId(): string {
        return (
            '<' +
            [2, 2, 2, 6].reduce(
                // crux to generate UUID-like random strings
                (prev, len) => prev + '-' + crypto.randomBytes(len).toString('hex'),
                crypto.randomBytes(4).toString('hex')
            ) +
            '@' +
            // try to use the domain of the FROM address or fallback to server hostname
            (this.getEnvelope().from || this.hostname || 'localhost').split('@').pop() +
            '>'
        );
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `MimeNode.Options` style references keep working
 */
declare namespace MimeNode {
    export type Options = MimeNodeOptions;
    export type Addresses = MimeNodeAddresses;
    export type Envelope = MimeNodeEnvelope;
}

export default MimeNode;
