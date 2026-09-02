/* eslint no-undefined: 0 */

import MimeNode, {
    type MimeNodeAddressInput,
    type MimeNodeContent,
    type MimeNodeContentObject,
    type MimeNodeEnvelopeInput,
    type MimeNodeHeaderMap,
    type MimeNodeHeaderValue,
    type MimeNodeHeaders,
    type MimeNodeOptions
} from '../mime-node/index.js';
import * as mimeFuncs from '../mime-funcs/index.js';
import { parseDataURI, copyOwnKeys, type ParsedDataURI } from '../shared/index.js';
import type { Readable } from 'node:stream';
import type { OutgoingHttpHeaders } from 'node:http';

/**
 * A content element, the shape of the text, html, watchHtml, amp and alternatives values.
 * The content is either given in `content`, read from `path` or `href`, or `raw` supplies
 * a pregenerated MIME part
 */
export interface MailComposerAlternative {
    /** The content itself: a string, a Buffer, a readable stream or a content descriptor */
    content?: MimeNodeContent;
    /** File path, data URI or http(s) URL to read the content from */
    path?: string | false;
    /** URL or data URI to fetch the content from */
    href?: string | false;
    /** Request headers for a URL fetch */
    httpHeaders?: OutgoingHttpHeaders;
    /** TLS settings for a URL fetch, see nmfetch */
    tls?: { [key: string]: any };
    /** Encoding of a string `content`, decoded into a Buffer unless it is utf8 or ascii */
    encoding?: string;
    /** Pregenerated MIME part, used as is instead of building the node */
    raw?: MimeNodeContent;
    /** Content type, detected from the filename, path or URL when not set */
    contentType?: string;
    /** Content-Transfer-Encoding for the node, false leaves the choice to the node */
    contentTransferEncoding?: string | false;
    /** Filename for the node, false suppresses the generated one */
    filename?: string | false;
    /** Additional headers for the node */
    headers?: MimeNodeHeaders;
}

/**
 * An attachment, the shape of the attachments entries
 */
export interface MailComposerAttachment extends MailComposerAlternative {
    /** Content-Disposition for the node, 'attachment' by default and 'inline' for a message node or an image with a cid */
    contentDisposition?: string;
    /** Content-Id for an embedded image, moves the attachment into the multipart/related node beside the html */
    cid?: string;
}

/**
 * The icalEvent value as an object
 */
export interface MailComposerIcalEvent extends MailComposerAlternative {
    /** iCalendar method, PUBLISH by default */
    method?: string;
}

/**
 * The attachments as sorted by getAttachments
 */
export interface MailComposerAttachments {
    /** Attachments for the multipart/mixed node, the icalEvent attachment included */
    attached: MailComposerAttachment[];
    /** Attachments with a cid, embedded in the multipart/related node beside the html */
    related: MailComposerAttachment[];
}

/**
 * A List-* header entry, a bare url or an url with a comment
 */
export type MailComposerListHeaderEntry = string | { url: string; comment?: string };

/**
 * The list value: List-* headers keyed by the part after "List-" (help, unsubscribe,
 * subscribe, post, owner, archive, id). An array emits one header per entry, an entry that
 * is itself an array joins its values into one header
 */
export interface MailComposerListHeaders {
    [key: string]: MailComposerListHeaderEntry | (MailComposerListHeaderEntry | MailComposerListHeaderEntry[])[];
}

/**
 * Mail options, the message data MailComposer builds the MIME tree from. The address
 * fields, subject, messageId, date, inReplyTo and references become headers of the root
 * node. Some fields are read by the mailer that hands the data to MailComposer rather than
 * by MailComposer itself, these are marked as such
 */
export interface MailComposerOptions {
    from?: MimeNodeAddressInput;
    sender?: MimeNodeAddressInput;
    to?: MimeNodeAddressInput;
    cc?: MimeNodeAddressInput;
    bcc?: MimeNodeAddressInput;
    replyTo?: MimeNodeAddressInput;
    inReplyTo?: string;
    references?: string | string[];
    subject?: string;
    /** Message-ID header value, generated when missing */
    messageId?: string;
    /** Date header value, the current time when missing */
    date?: Date | string;
    /** Plaintext version of the message */
    text?: string | Buffer | Readable | MailComposerAlternative;
    /** HTML version of the message */
    html?: string | Buffer | Readable | MailComposerAlternative;
    /** Apple Watch specific HTML version of the message */
    watchHtml?: string | Buffer | Readable | MailComposerAlternative;
    /** AMP4EMAIL version of the message */
    amp?: string | Buffer | Readable | MailComposerAlternative;
    /** iCalendar event, included both as a text/calendar alternative and as an application/ics attachment */
    icalEvent?: string | Buffer | Readable | MailComposerIcalEvent;
    attachments?: MailComposerAttachment[];
    /** Further alternatives for the multipart/alternative node, after text, watchHtml, amp, html and the calendar event */
    alternatives?: MailComposerAlternative[];
    /** Custom headers for the root node, the standard headers above override them */
    headers?: MimeNodeHeaders;
    /** List-* headers, read by the mailer */
    list?: MailComposerListHeaders;
    /** SMTP envelope to use instead of the one generated from the headers */
    envelope?: MimeNodeEnvelopeInput;
    /** Content-Transfer-Encoding to force for the text/* nodes that do not set their own */
    encoding?: string;
    /** Header string encoding, 'Q' (the default) or 'B', 'quoted-printable' and 'base64' are accepted as well */
    textEncoding?: string;
    /** Pregenerated rfc822 message, used as is instead of building one */
    raw?: MimeNodeContent;
    /** Reject content that points to a URL */
    disableUrlAccess?: boolean;
    /** Reject content that points to a file path */
    disableFileAccess?: boolean;
    /** Convert data: images in the html into embedded attachments, read by the mailer */
    attachDataUrls?: boolean;
    /** Prefix for the generated multipart boundaries */
    boundaryPrefix?: string;
    /** Shared part of the unique multipart boundary */
    baseBoundary?: string;
    /** 'win' for CRLF and 'linux' for LF line breaks in the generated message, kept as is when not set */
    newline?: string;
    /** Keep the Bcc header in the generated message, listed for completeness, the transports set it on the message directly */
    keepBcc?: boolean;
    /** Method to normalize header keys for custom caseing */
    normalizeHeaderKey?: MimeNodeOptions['normalizeHeaderKey'];
    /** 'high', 'normal' or 'low', sets the priority headers, read by the mailer */
    priority?: string;
    /** X-Mailer header value, false leaves the header out, read by the mailer */
    xMailer?: string | false;
}

/**
 * Creates the object for composing a MimeNode instance out from the mail options
 *
 * @constructor
 * @param mail Mail options
 */
/**
 * Tells whether a content value is a content descriptor object (something to load or to
 * use as is) rather than the content itself
 */
function isContentObject(value: unknown): value is MailComposerAlternative {
    const content = value as MailComposerAlternative;
    return typeof value === 'object' && !!(content.content || content.path || content.href || content.raw);
}

export default class MailComposer {
    mail: MailComposerOptions;
    message: MimeNode | false;

    // set by compile, declared without a runtime field to keep the shape the constructor produces
    declare _alternatives: MailComposerAlternative[];
    declare _htmlNode: MailComposerAlternative | undefined;
    declare _attachments: MailComposerAttachments;
    declare _useRelated: boolean;
    declare _useAlternative: boolean;
    declare _useMixed: boolean | number;
    declare _icalEvent: MailComposerIcalEvent | undefined;

    constructor(mail?: MailComposerOptions) {
        this.mail = mail || {};
        this.message = false;
    }

    /**
     * Builds MimeNode instance
     */
    compile(): MimeNode {
        this._alternatives = this.getAlternatives();
        this._htmlNode = this._alternatives.filter(alternative => /^text\/html\b/i.test(alternative.contentType as string)).pop();
        this._attachments = this.getAttachments(!!this._htmlNode);

        this._useRelated = !!(this._htmlNode && this._attachments.related.length);
        this._useAlternative = this._alternatives.length > 1;
        this._useMixed = this._attachments.attached.length > 1 || (this._alternatives.length && this._attachments.attached.length === 1);

        // Compose MIME tree
        if (this.mail.raw) {
            this.message = new MimeNode('message/rfc822', {
                newline: this.mail.newline,
                disableUrlAccess: this.mail.disableUrlAccess,
                disableFileAccess: this.mail.disableFileAccess
            }).setRaw(this.mail.raw);
        } else if (this._useMixed) {
            this.message = this._createMixed();
        } else if (this._useAlternative) {
            this.message = this._createAlternative();
        } else if (this._useRelated) {
            this.message = this._createRelated();
        } else {
            this.message = this._createContentNode(
                false,
                ([] as MailComposerAlternative[])
                    .concat(this._alternatives || [])
                    .concat(this._attachments.attached || [])
                    .shift() || {
                    contentType: 'text/plain',
                    content: ''
                }
            );
        }

        // Add custom headers
        if (this.mail.headers) {
            this.message.addHeader(this.mail.headers);
        }

        // Add headers to the root node, always overrides custom headers
        ['from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'in-reply-to', 'references', 'subject', 'message-id', 'date'].forEach(header => {
            const key = header.replace(/-(\w)/g, (o, c) => c.toUpperCase());
            if (this.mail[key as keyof MailComposerOptions]) {
                (this.message as MimeNode).setHeader(header, this.mail[key as keyof MailComposerOptions] as MimeNodeHeaderValue);
            }
        });

        // Sets custom envelope
        if (this.mail.envelope) {
            this.message.setEnvelope(this.mail.envelope);
        }

        // ensure Message-Id value
        this.message.messageId();

        return this.message;
    }

    /**
     * List all attachments. Resulting attachment objects can be used as input for MimeNode nodes
     *
     * @param findRelated If true separate related attachments from attached ones
     * @returns An object of arrays (`related` and `attached`)
     */
    getAttachments(findRelated?: boolean): MailComposerAttachments {
        let eventObject: MailComposerIcalEvent | undefined;
        const attachments = ([] as MailComposerAttachment[]).concat(this.mail.attachments || []).map((attachment, i) => {
            if (/^data:/i.test((attachment.path || attachment.href) as string)) {
                attachment = this._processDataUrl(attachment);
            }

            const contentType =
                attachment.contentType || mimeFuncs.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin');

            const isImage = /^image\//i.test(contentType);
            const isMessageNode = /^message\//i.test(contentType);

            const contentDisposition =
                attachment.contentDisposition || (isMessageNode || (isImage && attachment.cid) ? 'inline' : 'attachment');

            let contentTransferEncoding: string | false | undefined;
            if ('contentTransferEncoding' in attachment) {
                // also contains `false`, to set
                contentTransferEncoding = attachment.contentTransferEncoding;
            } else if (isMessageNode) {
                // the content might include non-ASCII bytes but at this point we do not know it yet
                contentTransferEncoding = '8bit';
            } else {
                contentTransferEncoding = 'base64'; // the default
            }

            const data: MailComposerAttachment = {
                contentType,
                contentDisposition,
                contentTransferEncoding
            };

            if (attachment.filename) {
                data.filename = attachment.filename;
            } else if (!isMessageNode && attachment.filename !== false) {
                data.filename =
                    ((attachment.path || attachment.href || '').split('/').pop() as string).split('?').shift() || 'attachment-' + (i + 1);
                if (data.filename.indexOf('.') < 0) {
                    data.filename += '.' + mimeFuncs.detectExtension(data.contentType);
                }
            }

            if (/^https?:\/\//i.test(attachment.path as string)) {
                attachment.href = attachment.path;
                attachment.path = undefined;
            }

            if (attachment.cid) {
                data.cid = attachment.cid;
            }

            if (attachment.raw) {
                data.raw = attachment.raw;
            } else if (attachment.path) {
                data.content = {
                    path: attachment.path
                };
            } else if (attachment.href) {
                data.content = {
                    href: attachment.href,
                    httpHeaders: attachment.httpHeaders,
                    tls: attachment.tls
                };
            } else {
                data.content = attachment.content || '';
            }

            if (attachment.encoding) {
                data.encoding = attachment.encoding;
            }

            if (attachment.headers) {
                data.headers = attachment.headers;
            }

            return data;
        });

        if (this.mail.icalEvent) {
            eventObject = Object.assign({}, this._getIcalEvent());

            eventObject.contentType = 'application/ics';
            if (!eventObject.headers) {
                eventObject.headers = {};
            }
            eventObject.filename = eventObject.filename || 'invite.ics';
            (eventObject.headers as MimeNodeHeaderMap)['Content-Disposition'] = 'attachment';
            (eventObject.headers as MimeNodeHeaderMap)['Content-Transfer-Encoding'] = 'base64';
        }

        if (!findRelated) {
            return {
                attached: attachments.concat(eventObject || []),
                related: []
            };
        }

        return {
            attached: attachments.filter(attachment => !attachment.cid).concat(eventObject || []),
            related: attachments.filter(attachment => !!attachment.cid)
        };
    }

    /**
     * Returns the icalEvent value with `path`/`href`/data uri input normalized into
     * a `content` entry, the same way as for regular attachments. The same event is
     * included twice (as a text/calendar alternative and as an application/ics
     * attachment), so the shared content object is marked to be resolved just once
     * and the buffered result is reused by the second node.
     *
     * @returns Normalized icalEvent data
     */
    _getIcalEvent(): MailComposerIcalEvent {
        if (!this._icalEvent) {
            let icalEvent: MailComposerIcalEvent;
            if (isContentObject(this.mail.icalEvent)) {
                // an own "__proto__" key would make the copy inherit path/href from caller
                // data, and the mapping below then replaces the content the caller did set
                icalEvent = copyOwnKeys({} as MailComposerIcalEvent, this.mail.icalEvent);
            } else {
                icalEvent = {
                    content: this.mail.icalEvent
                };
            }

            if (/^data:/i.test((icalEvent.path || icalEvent.href) as string)) {
                icalEvent = this._processDataUrl(icalEvent);
            }

            if (/^https?:\/\//i.test(icalEvent.path as string)) {
                icalEvent.href = icalEvent.path;
                icalEvent.path = undefined;
            }

            if (!icalEvent.raw) {
                // map file path and URL values into `content`, otherwise the content
                // nodes would render an empty body
                if (icalEvent.path) {
                    icalEvent.content = {
                        path: icalEvent.path
                    };
                    icalEvent.path = undefined;
                } else if (icalEvent.href) {
                    icalEvent.content = {
                        href: icalEvent.href,
                        httpHeaders: icalEvent.httpHeaders
                    };
                    icalEvent.href = undefined;
                }
            }

            if (icalEvent.content && typeof icalEvent.content === 'object') {
                // we are going to have the same attachment twice, so mark this to be
                // resolved just once
                (icalEvent.content as MimeNodeContentObject)._resolve = true;
            }

            this._icalEvent = icalEvent;
        }

        return this._icalEvent;
    }

    /**
     * List alternatives. Resulting objects can be used as input for MimeNode nodes
     *
     * @returns An array of alternative elements. Includes the `text` and `html` values as well
     */
    getAlternatives(): MailComposerAlternative[] {
        const alternatives: MailComposerAlternative[] = [];
        let text: MailComposerAlternative | undefined,
            html: MailComposerAlternative | undefined,
            watchHtml: MailComposerAlternative | undefined,
            amp: MailComposerAlternative | undefined,
            eventObject: MailComposerIcalEvent | undefined;

        if (this.mail.text) {
            if (isContentObject(this.mail.text)) {
                text = this.mail.text;
            } else {
                text = {
                    content: this.mail.text
                };
            }
            text.contentType = 'text/plain; charset=utf-8';
        }

        if (this.mail.watchHtml) {
            if (isContentObject(this.mail.watchHtml)) {
                watchHtml = this.mail.watchHtml;
            } else {
                watchHtml = {
                    content: this.mail.watchHtml
                };
            }
            watchHtml.contentType = 'text/watch-html; charset=utf-8';
        }

        if (this.mail.amp) {
            if (isContentObject(this.mail.amp)) {
                amp = this.mail.amp;
            } else {
                amp = {
                    content: this.mail.amp
                };
            }
            amp.contentType = 'text/x-amp-html; charset=utf-8';
        }

        // NB! when including attachments with a calendar alternative you might end up in a blank screen on some clients
        if (this.mail.icalEvent) {
            eventObject = Object.assign({}, this._getIcalEvent());

            eventObject.filename = false;
            eventObject.contentType =
                'text/calendar; charset=utf-8; method=' + (eventObject.method || 'PUBLISH').toString().trim().toUpperCase();
            if (!eventObject.headers) {
                eventObject.headers = {};
            }
        }

        if (this.mail.html) {
            if (isContentObject(this.mail.html)) {
                html = this.mail.html;
            } else {
                html = {
                    content: this.mail.html
                };
            }
            html.contentType = 'text/html; charset=utf-8';
        }

        ([] as MailComposerAlternative[])
            .concat(text || [])
            .concat(watchHtml || [])
            .concat(amp || [])
            .concat(html || [])
            .concat(eventObject || [])
            .concat(this.mail.alternatives || [])
            .forEach(alternative => {
                if (/^data:/i.test((alternative.path || alternative.href) as string)) {
                    alternative = this._processDataUrl(alternative);
                }

                const data: MailComposerAlternative = {
                    contentType:
                        alternative.contentType ||
                        mimeFuncs.detectMimeType(alternative.filename || alternative.path || alternative.href || 'txt'),
                    contentTransferEncoding: alternative.contentTransferEncoding
                };

                if (alternative.filename) {
                    data.filename = alternative.filename;
                }

                if (/^https?:\/\//i.test(alternative.path as string)) {
                    alternative.href = alternative.path;
                    alternative.path = undefined;
                }

                if (alternative.raw) {
                    data.raw = alternative.raw;
                } else if (alternative.path) {
                    data.content = {
                        path: alternative.path
                    };
                } else if (alternative.href) {
                    data.content = {
                        href: alternative.href
                    };
                } else {
                    data.content = alternative.content || '';
                }

                if (alternative.encoding) {
                    data.encoding = alternative.encoding;
                }

                if (alternative.headers) {
                    data.headers = alternative.headers;
                }

                alternatives.push(data);
            });

        return alternatives;
    }

    /**
     * Builds multipart/mixed node. It should always contain different type of elements on the same level
     * eg. text + attachments
     *
     * @param parentNode Parent for this note. If it does not exist, a root node is created
     * @returns MimeNode node element
     */
    _createMixed(parentNode?: MimeNode): MimeNode {
        const node = parentNode
            ? parentNode.createChild('multipart/mixed', {
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              })
            : new MimeNode('multipart/mixed', {
                  baseBoundary: this.mail.baseBoundary,
                  textEncoding: this.mail.textEncoding,
                  boundaryPrefix: this.mail.boundaryPrefix,
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              });

        if (this._useAlternative) {
            this._createAlternative(node);
        } else if (this._useRelated) {
            this._createRelated(node);
        }

        ([] as MailComposerAlternative[])
            .concat((!this._useAlternative && this._alternatives) || [])
            .concat(this._attachments.attached || [])
            .forEach(element => {
                // if the element is a html node from related subpart then ignore it
                if (!this._useRelated || element !== this._htmlNode) {
                    this._createContentNode(node, element);
                }
            });

        return node;
    }

    /**
     * Builds multipart/alternative node. It should always contain same type of elements on the same level
     * eg. text + html view of the same data
     *
     * @param parentNode Parent for this note. If it does not exist, a root node is created
     * @returns MimeNode node element
     */
    _createAlternative(parentNode?: MimeNode): MimeNode {
        const node = parentNode
            ? parentNode.createChild('multipart/alternative', {
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              })
            : new MimeNode('multipart/alternative', {
                  baseBoundary: this.mail.baseBoundary,
                  textEncoding: this.mail.textEncoding,
                  boundaryPrefix: this.mail.boundaryPrefix,
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              });

        this._alternatives.forEach(alternative => {
            if (this._useRelated && this._htmlNode === alternative) {
                this._createRelated(node);
            } else {
                this._createContentNode(node, alternative);
            }
        });

        return node;
    }

    /**
     * Builds multipart/related node. It should always contain html node with related attachments
     *
     * @param parentNode Parent for this note. If it does not exist, a root node is created
     * @returns MimeNode node element
     */
    _createRelated(parentNode?: MimeNode): MimeNode {
        const node = parentNode
            ? parentNode.createChild('multipart/related; type="text/html"', {
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              })
            : new MimeNode('multipart/related; type="text/html"', {
                  baseBoundary: this.mail.baseBoundary,
                  textEncoding: this.mail.textEncoding,
                  boundaryPrefix: this.mail.boundaryPrefix,
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              });

        this._createContentNode(node, this._htmlNode);

        this._attachments.related.forEach(alternative => this._createContentNode(node, alternative));

        return node;
    }

    /**
     * Creates a regular node with contents
     *
     * @param parentNode Parent for this note. If it does not exist, a root node is created
     * @param element Node data
     * @returns MimeNode node element
     */
    _createContentNode(parentNode: MimeNode | false, element?: MailComposerAttachment): MimeNode {
        element = element || {};
        element.content = element.content || '';

        const encoding = (element.encoding || 'utf8')
            .toString()
            .toLowerCase()
            .replace(/[-_\s]/g, '');

        const node = parentNode
            ? parentNode.createChild(element.contentType, {
                  filename: element.filename as string | undefined,
                  textEncoding: this.mail.textEncoding,
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              })
            : new MimeNode(element.contentType, {
                  filename: element.filename as string | undefined,
                  baseBoundary: this.mail.baseBoundary,
                  textEncoding: this.mail.textEncoding,
                  boundaryPrefix: this.mail.boundaryPrefix,
                  disableUrlAccess: this.mail.disableUrlAccess,
                  disableFileAccess: this.mail.disableFileAccess,
                  normalizeHeaderKey: this.mail.normalizeHeaderKey,
                  newline: this.mail.newline
              });

        // add custom headers
        if (element.headers) {
            node.addHeader(element.headers);
        }

        if (element.cid) {
            node.setHeader('Content-Id', '<' + element.cid.replace(/[<>]/g, '') + '>');
        }

        if (element.contentTransferEncoding) {
            node.setHeader('Content-Transfer-Encoding', element.contentTransferEncoding);
        } else if (this.mail.encoding && /^text\//i.test(element.contentType as string)) {
            node.setHeader('Content-Transfer-Encoding', this.mail.encoding);
        }

        if (!/^text\//i.test(element.contentType as string) || element.contentDisposition) {
            node.setHeader(
                'Content-Disposition',
                element.contentDisposition || (element.cid && /^image\//i.test(element.contentType as string) ? 'inline' : 'attachment')
            );
        }

        if (typeof element.content === 'string' && !['utf8', 'usascii', 'ascii'].includes(encoding)) {
            element.content = Buffer.from(element.content, encoding as BufferEncoding);
        }

        // prefer pregenerated raw content
        if (element.raw) {
            node.setRaw(element.raw);
        } else {
            node.setContent(element.content);
        }

        return node;
    }

    /**
     * Parses data uri and converts it to a Buffer
     *
     * @param element Content element
     * @return Parsed element
     */
    _processDataUrl<T extends MailComposerAlternative>(element: T): T {
        const dataUrl = element.path || element.href;

        // Early validation to prevent ReDoS
        if (!dataUrl || typeof dataUrl !== 'string') {
            return element;
        }

        if (!dataUrl.startsWith('data:')) {
            return element;
        }

        if (dataUrl.length > 52428800) {
            // 52428800 chars = 50MB limit for data URL string (~37.5MB decoded image)
            // Extract content type before rejecting to preserve MIME type
            let detectedType = 'application/octet-stream';
            const commaPos = dataUrl.indexOf(',');

            if (commaPos > 0 && commaPos < 200) {
                // Parse header safely with size limit
                const header = dataUrl.substring(5, commaPos); // skip 'data:'
                const parts = header.split(';');
                if (parts[0] && parts[0].includes('/')) {
                    detectedType = parts[0].trim();
                }
            }

            // Return empty content for excessively long data URLs
            return Object.assign(copyOwnKeys({} as T, element), {
                path: false,
                href: false,
                content: Buffer.alloc(0),
                contentType: element.contentType || detectedType
            });
        }

        let parsedDataUri: ParsedDataURI | null;
        try {
            parsedDataUri = parseDataURI(dataUrl);
        } catch (_err) {
            return element;
        }

        if (!parsedDataUri) {
            return element;
        }

        element.content = parsedDataUri.data;
        element.contentType = element.contentType || parsedDataUri.contentType;

        if ('path' in element) {
            element.path = false;
        }

        if ('href' in element) {
            element.href = false;
        }

        return element;
    }
}
