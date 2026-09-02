import * as shared from '../shared/index.js';
import MimeNode, {
    type MimeNodeAddress,
    type MimeNodeAddressInput,
    type MimeNodeHeaders,
    type MimeNodePreparedHeaderValue
} from '../mime-node/index.js';
import * as mimeFuncs from '../mime-funcs/index.js';
import type {
    MailComposerAlternative,
    MailComposerAttachment,
    MailComposerListHeaderEntry,
    MailComposerListHeaders,
    MailComposerOptions
} from '../mail-composer/index.js';
import type { DKIMOptions } from '../dkim/index.js';
import type { SMTPEnvelopeDsn } from '../smtp-connection/index.js';
import type { SMTPTransportAuthOptions } from '../smtp-transport/index.js';
import type { NodemailerError, ResultCallback } from '../errors.js';
import type { ResolveContentOptions } from '../shared/index.js';
import type Mail from './index.js';
import type { SentMessageInfo } from './index.js';

/**
 * The message data accepted by sendMail. MailComposerOptions describes the fields the MIME
 * tree is built from, the fields below are the ones the mailer reads on top of those
 */
export interface SendMailOptions extends MailComposerOptions {
    /** DKIM signing options for this message, used instead of the ones of the transporter */
    dkim?: DKIMOptions;
    /** Extra DKIM options for this message, merged over the options of the signer */
    _dkim?: DKIMOptions;
    /** Recipients allowed on this message, 0 disables the limit, defaults to 100000 */
    maxRecipients?: number;
    /** SMTP transports: DSN parameters for the envelope, sent when the server supports the DSN extension */
    dsn?: SMTPEnvelopeDsn;
    /** SMTP transports: RFC 8689, send the REQUIRETLS parameter with MAIL FROM */
    requireTLSExtensionEnabled?: boolean;
    /** SMTP transports: per-message authentication settings, used instead of the transport level auth */
    auth?: SMTPTransportAuthOptions;
    /** SES transport: extra SendEmailCommand parameters merged into the API call */
    ses?: { [key: string]: unknown };
}

/**
 * Default message fields, the third argument of createTransport. Applied to every message
 * for the fields the message does not set itself, the headers are merged one by one
 */
export type MailDefaults = SendMailOptions;

/**
 * The message data as held by a MailMessage: the options the caller passed to sendMail with
 * the transporter defaults applied. resolveAll rewrites the content and address fields in
 * place and normalize adds the envelope, the Message-ID and the normalized headers
 */
export interface MailMessageData extends SendMailOptions {
    /** Header values flattened to strings and keyed by lowercase header name, set by normalize */
    normalizedHeaders?: { [key: string]: string };
}

/**
 * Callback for resolveAll and normalize, receives the message data with every content value
 * resolved
 */
export type MailMessageDataCallback = (err: NodemailerError | null, data: MailMessageData) => void;

/**
 * Callback for resolveContent, receives the resolved content value
 */
export type MailMessageContentCallback = (err: NodemailerError | null, value?: any) => void;

/**
 * A single prepared List-* header value, emitted as is
 */
export interface MailMessageListHeaderValue extends MimeNodePreparedHeaderValue {
    prepared: boolean;
    foldLines: boolean;
    value: string;
}

/**
 * A List-* header as built from the list value, one prepared value per list entry
 */
export interface MailMessageListHeader {
    /** Header key, 'list-' followed by the lowercase list key */
    key: string;
    value: MailMessageListHeaderValue[];
}

// the message data is walked by key in places, so it is read as a plain object there
type MailDataBag = { [key: string]: any };

// Only an own key counts as already set. `key in obj` also matches every member of
// Object.prototype, which silently drops a transporter default legitimately named
// toString or constructor.
const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

export default class MailMessage<T = SentMessageInfo> {
    mailer: Mail<T>;
    data: MailMessageData;
    message: MimeNode | null;

    constructor(mailer: Mail<T>, data?: SendMailOptions) {
        this.mailer = mailer;
        this.data = {};
        this.message = null;

        data = data || {};
        const options = mailer.options || {};
        const defaults = mailer._defaults || {};

        shared.copyOwnKeys(this.data, data);

        this.data.headers = this.data.headers || {};

        // Apply defaults. `_defaults` is caller supplied too, it is the second argument of
        // createTransport, so it needs the same treatment as `data` above
        shared.copyOwnKeys(this.data, defaults, key => hasOwn(this.data, key));

        // headers is a special case. Allow setting individual default headers
        shared.copyOwnKeys(this.data.headers, defaults.headers, key => hasOwn(this.data.headers as MimeNodeHeaders, key));

        // force specific keys from transporter options
        ['disableFileAccess', 'disableUrlAccess', 'normalizeHeaderKey', 'maxRecipients'].forEach(key => {
            if (key in options) {
                (this.data as MailDataBag)[key] = (options as { [key: string]: unknown })[key];
            }
        });

        // The access flags are a sandbox rather than a message field, so `defaults` counts as
        // transporter configuration for them. For a transporter plugin it is the only channel
        // there is, createTransport leaves `options` undefined for one, and the defaults copy
        // above yields to anything the message already set, which let message data switch the
        // sandbox back off. Closing is one way here, same as in resolveContent below: either
        // side may switch a flag on, neither can switch off what the other closed.
        (['disableFileAccess', 'disableUrlAccess'] as const).forEach(key => {
            if (!(key in options) && hasOwn(defaults, key)) {
                this.data[key] = this.data[key] || defaults[key];
            }
        });
    }

    resolveContent(data: { [key: string]: any }, key: string | number, callback: MailMessageContentCallback): void;
    resolveContent(
        data: { [key: string]: any },
        key: string | number,
        options: ResolveContentOptions | false | undefined,
        callback: MailMessageContentCallback
    ): void;
    resolveContent(data: { [key: string]: any }, key: string | number, options?: ResolveContentOptions | false): Promise<any>;
    resolveContent(
        data: { [key: string]: any },
        key: string | number,
        options?: ResolveContentOptions | MailMessageContentCallback | false,
        callback?: MailMessageContentCallback
    ): Promise<any> | void {
        // Most plugins call this with the legacy (data, key, callback) signature, which carries
        // no access policy. The policy belongs to the message, so apply it here. Explicit
        // options may only tighten it, never reopen what the transporter closed.
        if (!callback && typeof options === 'function') {
            callback = options;
            options = false;
        }
        options = options || {};

        const policy = {
            disableFileAccess: this.data.disableFileAccess || (options as ResolveContentOptions).disableFileAccess,
            disableUrlAccess: this.data.disableUrlAccess || (options as ResolveContentOptions).disableUrlAccess
        };

        return shared.resolveContent(data, key, policy, callback);
    }

    resolveAll(callback: MailMessageDataCallback): void {
        const keys: [MailDataBag, string | number][] = [
            [this.data, 'html'],
            [this.data, 'text'],
            [this.data, 'watchHtml'],
            [this.data, 'amp'],
            [this.data, 'icalEvent']
        ];

        if (this.data.alternatives && this.data.alternatives.length) {
            this.data.alternatives.forEach((alternative, i) => {
                keys.push([this.data.alternatives as MailComposerAlternative[], i]);
            });
        }

        if (this.data.attachments && this.data.attachments.length) {
            this.data.attachments.forEach((attachment, i) => {
                if (!attachment.filename) {
                    attachment.filename =
                        ((attachment.path || attachment.href || '').split('/').pop() as string).split('?').shift() ||
                        'attachment-' + (i + 1);
                    if (attachment.filename.indexOf('.') < 0) {
                        attachment.filename += '.' + mimeFuncs.detectExtension(attachment.contentType);
                    }
                }

                if (!attachment.contentType) {
                    attachment.contentType = mimeFuncs.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin');
                }

                keys.push([this.data.attachments as MailComposerAttachment[], i]);
            });
        }

        const mimeNode = new MimeNode();

        const addressKeys = ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo'] as const;

        addressKeys.forEach(address => {
            let value: MimeNodeAddress[] | undefined;
            if (this.message) {
                value = ([] as MimeNodeAddress[]).concat(
                    mimeNode._parseAddresses(
                        this.message.getHeader(address === 'replyTo' ? 'reply-to' : address) as MimeNodeAddressInput
                    ) || []
                );
            } else if (this.data[address]) {
                value = ([] as MimeNodeAddress[]).concat(mimeNode._parseAddresses(this.data[address]) || []);
            }
            if (value && value.length) {
                this.data[address] = value;
            } else if (address in this.data) {
                (this.data as MailDataBag)[address] = null;
            }
        });

        const singleKeys = ['from', 'sender'] as const;
        singleKeys.forEach(address => {
            if (this.data[address]) {
                this.data[address] = (this.data[address] as MimeNodeAddress[]).shift();
            }
        });

        let pos = 0;
        const resolveNext = (): void => {
            if (pos >= keys.length) {
                return callback(null, this.data);
            }
            const args = keys[pos++];
            if (!args[0] || !args[0][args[1]]) {
                return resolveNext();
            }
            shared.resolveContent(
                ...args,
                { disableFileAccess: this.data.disableFileAccess, disableUrlAccess: this.data.disableUrlAccess },
                (err, value) => {
                    if (err) {
                        return (callback as ResultCallback<MailMessageData>)(err);
                    }

                    const node = {
                        content: value
                    };
                    if (args[0][args[1]] && typeof args[0][args[1]] === 'object' && !Buffer.isBuffer(args[0][args[1]])) {
                        // The keys are the caller's, so copying them takes the same "__proto__"
                        // rule as the constructor. `key in node` stays as the already-set test
                        // here, unlike for the defaults: it also skips the Object.prototype
                        // member names, and letting message data land a `toString` string on a
                        // node only buys a TypeError the first time something stringifies it.
                        shared.copyOwnKeys(node, args[0][args[1]], key => key in node || ['content', 'path', 'href', 'raw'].includes(key));
                    }

                    args[0][args[1]] = node;
                    resolveNext();
                }
            );
        };

        setImmediate(() => resolveNext());
    }

    normalize(callback: MailMessageDataCallback): void {
        const envelope = (this.message as MimeNode).getEnvelope();
        const messageId = (this.message as MimeNode).messageId();

        this.resolveAll((err, data: MailDataBag) => {
            if (err) {
                return (callback as ResultCallback<MailMessageData>)(err);
            }

            data.envelope = envelope;
            data.messageId = messageId;

            ['html', 'text', 'watchHtml', 'amp'].forEach(key => {
                if (data[key] && data[key].content) {
                    if (typeof data[key].content === 'string') {
                        data[key] = data[key].content;
                    } else if (Buffer.isBuffer(data[key].content)) {
                        data[key] = data[key].content.toString();
                    }
                }
            });

            if (data.icalEvent && Buffer.isBuffer(data.icalEvent.content)) {
                data.icalEvent.content = data.icalEvent.content.toString('base64');
                data.icalEvent.encoding = 'base64';
            }

            if (data.alternatives && data.alternatives.length) {
                data.alternatives.forEach((alternative: MailComposerAlternative) => {
                    if (alternative && alternative.content && Buffer.isBuffer(alternative.content)) {
                        alternative.content = alternative.content.toString('base64');
                        alternative.encoding = 'base64';
                    }
                });
            }

            if (data.attachments && data.attachments.length) {
                data.attachments.forEach((attachment: MailComposerAttachment) => {
                    if (attachment && attachment.content && Buffer.isBuffer(attachment.content)) {
                        attachment.content = attachment.content.toString('base64');
                        attachment.encoding = 'base64';
                    }
                });
            }

            data.normalizedHeaders = {};
            Object.keys(data.headers || {}).forEach(key => {
                if (shared.isProtoKey(key)) {
                    return;
                }
                let value = ([] as any[]).concat(data.headers[key] || []).shift();
                value = (value && value.value) || value;
                if (value) {
                    if (['references', 'in-reply-to', 'message-id', 'content-id'].includes(key)) {
                        value = (this.message as MimeNode)._encodeHeaderValue(key, value);
                    }
                    data.normalizedHeaders[key] = value;
                }
            });

            if (data.list && typeof data.list === 'object') {
                const listHeaders = this._getListHeaders(data.list);
                listHeaders.forEach(entry => {
                    data.normalizedHeaders[entry.key] = entry.value.map(val => (val && val.value) || val).join(', ');
                });
            }

            if (data.references) {
                data.normalizedHeaders.references = (this.message as MimeNode)._encodeHeaderValue('references', data.references);
            }

            if (data.inReplyTo) {
                data.normalizedHeaders['in-reply-to'] = (this.message as MimeNode)._encodeHeaderValue('in-reply-to', data.inReplyTo);
            }

            return callback(null, data);
        });
    }

    setMailerHeader(): void {
        if (!this.message || !this.data.xMailer) {
            return;
        }
        this.message.setHeader('X-Mailer', this.data.xMailer);
    }

    setPriorityHeaders(): void {
        if (!this.message || !this.data.priority) {
            return;
        }
        switch ((this.data.priority || '').toString().toLowerCase()) {
            case 'high':
                this.message.setHeader('X-Priority', '1 (Highest)');
                this.message.setHeader('X-MSMail-Priority', 'High');
                this.message.setHeader('Importance', 'High');
                break;
            case 'low':
                this.message.setHeader('X-Priority', '5 (Lowest)');
                this.message.setHeader('X-MSMail-Priority', 'Low');
                this.message.setHeader('Importance', 'Low');
                break;
            default:
            // do not add anything, since all messages are 'Normal' by default
        }
    }

    setListHeaders(): void {
        if (!this.message || !this.data.list || typeof this.data.list !== 'object') {
            return;
        }
        // add optional List-* headers
        this._getListHeaders(this.data.list).forEach(listHeader => {
            listHeader.value.forEach(value => {
                (this.message as MimeNode).addHeader(listHeader.key, value);
            });
        });
    }

    _getListHeaders(listData: MailComposerListHeaders): MailMessageListHeader[] {
        // make sure an url looks like <protocol:url>
        return Object.keys(listData).map(key => ({
            key: 'list-' + key.toLowerCase().trim(),
            value: ([] as (MailComposerListHeaderEntry | MailComposerListHeaderEntry[])[]).concat(listData[key] || []).map(value => ({
                prepared: true,
                foldLines: true,
                value: ([] as MailComposerListHeaderEntry[])
                    .concat(value || [])
                    .map(value => {
                        if (typeof value === 'string') {
                            value = {
                                url: value
                            };
                        }

                        if (value && value.url) {
                            // strip CR/LF so a comment can't inject extra header lines. DEL is neither
                            // qtext nor ctext, so it can not be carried literally by either construct
                            // and has to become an encoded word like any other non-plaintext value
                            let comment = (value.comment || '').toString().replace(/\r?\n|\r/g, ' ');
                            const needsEncoding = !mimeFuncs.isPlainText(comment) || /\x7f/.test(comment);

                            if (key.toLowerCase().trim() === 'id') {
                                // List-ID: "comment" <domain>, where an unescaped quote or a trailing
                                // backslash in the comment would swallow the <domain> behind it
                                comment = needsEncoding ? mimeFuncs.encodeWord(comment) : mimeFuncs.quoteString(comment);

                                // List-ID expects a bare domain-like identifier, so strip the
                                // scheme prefix that _formatListUrl adds or passes through
                                return (
                                    (value.comment ? comment + ' ' : '') + this._formatListUrl(value.url).replace(/^<[^:]+:\/{0,2}/, '<')
                                );
                            }

                            // List-*: <http://domain> (comment)
                            // the ctext specials go out as quoted-pairs, otherwise a ")" closes the
                            // comment early and leaves the rest as junk, an unpaired "(" opens a
                            // nested comment that never closes, and a trailing backslash escapes
                            // the closing ")" so the comment swallows whatever follows it
                            comment = needsEncoding ? mimeFuncs.encodeWord(comment) : comment.replace(/[()\\]/g, '\\$&');

                            return this._formatListUrl(value.url) + (value.comment ? ' (' + comment + ')' : '');
                        }

                        return '';
                    })
                    .filter(value => value)
                    .join(', ')
            }))
        }));
    }

    _formatListUrl(url: string): string {
        // a url has no way to carry a control char or DEL, and the angle brackets around it
        // are not a quoting construct, so anything left here lands in the header raw
        url = url.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[\s<]+|[\s>]+/g, '');
        if (/^(https?|mailto|ftp):/.test(url)) {
            return '<' + url + '>';
        }
        if (/^[^@]+@[^@]+$/.test(url)) {
            return '<mailto:' + url + '>';
        }

        return '<http://' + url + '>';
    }
}
