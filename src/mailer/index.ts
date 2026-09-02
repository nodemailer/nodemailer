import { EventEmitter } from 'node:events';
import * as shared from '../shared/index.js';
import * as mimeTypes from '../mime-funcs/mime-types.js';
import MailComposer from '../mail-composer/index.js';
import DKIM, { type DKIMOptions } from '../dkim/index.js';
import httpProxyClient from '../smtp-connection/http-proxy-client.js';
import * as errors from '../errors.js';
import util from 'node:util';
import * as urllib from '../shared/url.js';
import * as packageData from '../package-info.js';
import MailMessage, { type MailDefaults, type SendMailOptions } from './mail-message.js';
import net from 'node:net';
import dns from 'node:dns';
import crypto from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';
import type {
    MailComposerAlternative,
    MailComposerAttachment,
    MailComposerIcalEvent,
    MailComposerListHeaderEntry,
    MailComposerListHeaders
} from '../mail-composer/index.js';
import type { NodemailerError, ResultCallback } from '../errors.js';
import type { ParsedUrl } from '../shared/url.js';
import type MimeNode from '../mime-node/index.js';
import type { MimeNodeAddress, MimeNodeEnvelope, MimeNodeEnvelopeInput, MimeNodeHeaders, MimeNodeOptions } from '../mime-node/index.js';
import type { XOAuth2ProvisionCallback } from '../xoauth2/index.js';

export type {
    SendMailOptions,
    MailDefaults,
    MailMessageData,
    MailMessageDataCallback,
    MailMessageContentCallback,
    MailMessageListHeader,
    MailMessageListHeaderValue
} from './mail-message.js';
export type { default as MailMessage } from './mail-message.js';

/**
 * Recipients allowed on one message unless the caller sets its own maxRecipients. A backstop
 * against a runaway or hostile recipient list rather than a delivery policy: RFC 5321 only
 * asks a server to accept 100, so a real send is bounded far below this.
 */
const DEFAULT_MAX_RECIPIENTS = 100000;

/**
 * The base shape of the object a transport hands back for a sent message. Every bundled
 * transport sets the envelope and the Message-ID, the rest depends on the transport
 */
export interface SentMessageInfo {
    /** The envelope the message was sent with */
    envelope: MimeNodeEnvelope;
    /** Message-ID of the sent message */
    messageId: string;
    /** Recipient addresses the transport accepted */
    accepted?: string[];
    /** Recipient addresses the transport rejected */
    rejected?: string[];
    /** Recipient addresses left pending, LMTP reports these */
    pending?: string[];
    /** Last response from the server */
    response?: string;
    /** The generated message, for the transports that hand it back instead of sending it */
    message?: unknown;
    /** Transport specific fields */
    [key: string]: unknown;
}

/**
 * Callback for sendMail, receives the transport result once the transport has taken the
 * message
 */
export type SendMailCallback<T = SentMessageInfo> = (err: NodemailerError | null, info: T) => void;

/**
 * Callback for verify(), success is true once the transport accepted the configuration
 */
export type VerifyCallback = (err: NodemailerError | null, success?: true) => void;

/**
 * Callback a plugin calls once it is done, an error aborts the send
 */
export type PluginCallback = (err?: NodemailerError | null) => void;

/**
 * A plugin registered with use(): receives the message and a callback to call once done
 */
export type PluginFunction<T = SentMessageInfo> = (mail: MailMessage<T>, callback: PluginCallback) => void;

/**
 * Connection options a getSocket handler receives: the options of the transport asking for
 * the socket, with the host and port to connect to
 */
export interface GetSocketOptions {
    host?: string;
    port?: number | string;
    [key: string]: any;
}

/**
 * The result of a getSocket handler, the socket to use for the connection
 */
export interface SocketOptions {
    /** An established socket, the proxied connection */
    connection?: net.Socket;
}

/**
 * Receives the socket options from a getSocket handler, or the error that prevented the
 * connection
 */
export type GetSocketCallback = (err: NodemailerError | null, socketOptions?: SocketOptions) => void;

/**
 * A socket handler. Mail sets one on the transport as getSocket when a proxy is configured,
 * the SMTP transports call it to get a proxied socket instead of connecting directly
 */
export type GetSocketHandler = (options: GetSocketOptions, callback: GetSocketCallback) => void;

/**
 * A custom proxy handler, registered with set('proxy_handler_' + protocol, handler) for the
 * protocol of the proxy url
 */
export type ProxyHandler = (proxy: ParsedUrl, options: GetSocketOptions, callback: GetSocketCallback) => void;

/**
 * Well known keys of the meta store, see set() and get(): the OAuth2 token provisioning
 * callback the SMTP transports use, the socks module for socks proxies, and a custom proxy
 * handler per proxy protocol
 */
export interface MailMeta {
    /** Called by the SMTP transports when a new OAuth2 access token is needed */
    oauth2_provision_cb: XOAuth2ProvisionCallback;
    /** The socks module, v1 or v2, used to connect through a socks proxy */
    proxy_socks_module: any;
    [key: `proxy_handler_${string}`]: ProxyHandler;
    [key: string]: any;
}

/**
 * A transport as consumed by Mail: any object with a name, a version and a send method
 * works, the rest is optional. Mail forwards its close, isIdle and verify calls to the
 * methods of the same name as they are, so their arguments are up to the transport
 */
export interface Transport<T = SentMessageInfo> {
    /** Transport name, used for logging */
    name: string;
    /** Transport version, used for logging */
    version: string;
    /** Hands a message to the transport, the callback receives the transport result */
    send(mail: MailMessage<T>, callback: ResultCallback<T>): void;
    /** Checks the configuration, the SMTP transports connect and authenticate for it */
    verify?(...args: any[]): any;
    /** Closes the transport */
    close?(...args: any[]): any;
    /** Tells whether the transport can take a message right away */
    isIdle?(...args: any[]): any;
    /** Registers an event listener, the transport may emit 'log', 'error', 'idle' and 'clear' */
    on?(event: string | symbol, listener: (...args: any[]) => void): this;
    /** The Mail object the transport belongs to, set by Mail */
    mailer?: Mail<T>;
    /** Socket handler for a proxied connection, set by Mail when a proxy is configured */
    getSocket?: GetSocketHandler;
}

/**
 * Transport configuration as read by Mail itself. The transport reads its own options from
 * the same object, see the transport for those
 */
export interface TransportOptions {
    /** Bunyan compatible logger, true for the default console logger, false or unset for no logging */
    logger?: shared.ExternalLogger | boolean;
    /** Component name for the log lines, defaults to 'mail' */
    component?: string;
    /** DKIM signing options, every message is signed with these unless it carries its own */
    dkim?: DKIMOptions;
    /** Proxy url. http(s) proxies work as is, socks proxies need the socks module set with set('proxy_socks_module', socks) */
    proxy?: string;
    /** TLS options, rejectUnauthorized applies to an https proxy as well */
    tls?: ConnectionOptions;
    /** Reject content that points to a file path, forced onto every message */
    disableFileAccess?: boolean;
    /** Reject content that points to a URL, forced onto every message */
    disableUrlAccess?: boolean;
    /** Method to normalize header keys for custom caseing, forced onto every message */
    normalizeHeaderKey?: MimeNodeOptions['normalizeHeaderKey'];
    /** Recipients allowed on one message, forced onto every message, 0 disables the limit, defaults to 100000 */
    maxRecipients?: number;
    /** Convert data: images in the html into embedded attachments */
    attachDataUrls?: boolean;
}

/**
 * The transporter object createTransport returns, a Mail instance wrapping a transport
 */
export type Transporter<T = SentMessageInfo> = Mail<T>;

/**
 * Creates an object for exposing the Mail API
 *
 * @constructor
 * @param transporter Transport object instance to pass the mails to
 */
class Mail<T = SentMessageInfo> extends EventEmitter {
    options: TransportOptions;
    _defaults: MailDefaults;
    _defaultPlugins: { [step: string]: PluginFunction<T>[] };
    _userPlugins: { [step: string]: PluginFunction<T>[] };
    meta: Map<string, any>;
    dkim: DKIM | false;
    transporter: Transport<T>;
    logger: shared.Logger;

    // set in the constructor by name, see the loop over the forwarded methods there. Each
    // forwards to the transport method of the same name, or logs a warning and returns
    // false when the transport does not implement it
    /** Closes the transport, the pooled SMTP transport closes its connections */
    close!: () => void;
    /** Tells whether the transport can take a message right away */
    isIdle!: () => boolean;
    /** Checks the configuration, the SMTP transports connect and authenticate for it */
    verify!: {
        (callback: VerifyCallback): void;
        (): Promise<true>;
    };

    /** Socket handler for a proxied connection, set by setupProxy and handed to the transport on the next send */
    declare getSocket?: GetSocketHandler | false;

    constructor(transporter: Transport<T>, options?: TransportOptions, defaults?: MailDefaults) {
        super();

        this.options = options || {};
        this._defaults = defaults || {};

        this._defaultPlugins = {
            compile: [(...args) => this._convertDataImages(...args)],
            stream: []
        };

        this._userPlugins = {
            compile: [],
            stream: []
        };

        this.meta = new Map();

        this.dkim = this.options.dkim ? new DKIM(this.options.dkim) : false;

        this.transporter = transporter;
        this.transporter.mailer = this;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'mail'
        });

        this.logger.debug(
            {
                tnx: 'create'
            },
            'Creating transport: %s',
            this.getVersionString()
        );

        // setup emit handlers for the transporter
        if (typeof this.transporter.on === 'function') {
            // deprecated log interface
            this.transporter.on('log', log => {
                this.logger.debug(
                    {
                        tnx: 'transport'
                    },
                    '%s: %s',
                    log.type,
                    log.message
                );
            });

            // transporter errors
            this.transporter.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'transport'
                    },
                    'Transport Error: %s',
                    err.message
                );
                this.emit('error', err);
            });

            // indicates if the sender has became idle
            this.transporter.on('idle', (...args) => {
                this.emit('idle', ...args);
            });

            // indicates if the sender has became idle and all connections are terminated
            this.transporter.on('clear', (...args) => {
                this.emit('clear', ...args);
            });
        }

        /**
         * Optional methods passed to the underlying transport object
         */
        (['close', 'isIdle', 'verify'] as const).forEach(method => {
            this[method] = (...args: any[]) => {
                if (typeof this.transporter[method] === 'function') {
                    if (method === 'verify' && typeof this.getSocket === 'function') {
                        this.transporter.getSocket = this.getSocket;
                        this.getSocket = false;
                    }
                    return this.transporter[method](...args);
                }

                this.logger.warn(
                    {
                        tnx: 'transport',
                        methodName: method
                    },
                    'Non existing method %s called for transport',
                    method
                );
                return false;
            };
        });

        // setup proxy handling
        if (this.options.proxy && typeof this.options.proxy === 'string') {
            this.setupProxy(this.options.proxy);
        }
    }

    use(step: string, plugin: PluginFunction<T>): this {
        step = (step || '').toString();
        if (!this._userPlugins.hasOwnProperty(step)) {
            this._userPlugins[step] = [plugin];
        } else {
            this._userPlugins[step].push(plugin);
        }

        return this;
    }

    /**
     * Sends an email using the preselected transport object
     *
     * @param data E-data description
     * @param callback Callback to run once the sending succeeded or failed
     */
    sendMail(data: SendMailOptions): Promise<T>;
    sendMail(data: SendMailOptions, callback: SendMailCallback<T>): void;
    sendMail(data: SendMailOptions, callback: SendMailCallback<T> | null = null): Promise<T> | void {
        let promise: Promise<T> | undefined;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }
        const done = callback as ResultCallback<T>;

        if (typeof this.getSocket === 'function') {
            this.transporter.getSocket = this.getSocket;
            this.getSocket = false;
        }

        const mail = new MailMessage(this, data);

        this.logger.debug(
            {
                tnx: 'transport',
                name: this.transporter.name,
                version: this.transporter.version,
                action: 'send'
            },
            'Sending mail using %s/%s',
            this.transporter.name,
            this.transporter.version
        );

        this._processPlugins('compile', mail, err => {
            if (err) {
                this.logger.error(
                    {
                        err,
                        tnx: 'plugin',
                        action: 'compile'
                    },
                    'PluginCompile Error: %s',
                    err.message
                );
                return done(err);
            }

            mail.message = new MailComposer(mail.data).compile();

            mail.setMailerHeader();
            mail.setPriorityHeaders();
            mail.setListHeaders();

            const maxRecipients = mail.data.maxRecipients === undefined ? DEFAULT_MAX_RECIPIENTS : mail.data.maxRecipients;
            const recipientCount = mail.message.getEnvelope().to.length;

            if (maxRecipients && recipientCount > maxRecipients) {
                const err: NodemailerError = new Error(
                    `Message has ${recipientCount} recipients, which is over the ${maxRecipients} allowed by maxRecipients`
                );
                err.code = errors.EMAXRECIPIENTS;
                this.logger.error(
                    {
                        err,
                        tnx: 'transport',
                        action: 'send'
                    },
                    'Send Error: %s',
                    err.message
                );
                return done(err);
            }

            this._processPlugins('stream', mail, err => {
                if (err) {
                    this.logger.error(
                        {
                            err,
                            tnx: 'plugin',
                            action: 'stream'
                        },
                        'PluginStream Error: %s',
                        err.message
                    );
                    return done(err);
                }

                if (mail.data.dkim || this.dkim) {
                    (mail.message as MimeNode).processFunc(input => {
                        const dkim = mail.data.dkim ? new DKIM(mail.data.dkim) : (this.dkim as DKIM);
                        this.logger.debug(
                            {
                                tnx: 'DKIM',
                                messageId: (mail.message as MimeNode).messageId(),
                                dkimDomains: dkim.keys.map(key => key.keySelector + '.' + key.domainName).join(', ')
                            },
                            'Signing outgoing message with %s keys',
                            dkim.keys.length
                        );
                        return dkim.sign(input, mail.data._dkim);
                    });
                }

                this.transporter.send(mail, (...args) => {
                    if (args[0]) {
                        this.logger.error(
                            {
                                err: args[0],
                                tnx: 'transport',
                                action: 'send'
                            },
                            'Send Error: %s',
                            args[0].message
                        );
                    }
                    done(...args);
                });
            });
        });

        return promise;
    }

    getVersionString(): string {
        return util.format(
            '%s (%s; +%s; %s/%s)',
            packageData.name,
            packageData.version,
            packageData.homepage,
            this.transporter.name,
            this.transporter.version
        );
    }

    _processPlugins(step: string, mail: MailMessage<T>, callback: PluginCallback): void {
        step = (step || '').toString();

        if (!this._userPlugins.hasOwnProperty(step)) {
            return callback();
        }

        const userPlugins = this._userPlugins[step] || [];
        const defaultPlugins = this._defaultPlugins[step] || [];

        if (userPlugins.length) {
            this.logger.debug(
                {
                    tnx: 'transaction',
                    pluginCount: userPlugins.length,
                    step
                },
                'Using %s plugins for %s',
                userPlugins.length,
                step
            );
        }

        if (userPlugins.length + defaultPlugins.length === 0) {
            return callback();
        }

        let pos = 0;
        let block = 'default';
        const processPlugins = (): void => {
            let curplugins = block === 'default' ? defaultPlugins : userPlugins;
            if (pos >= curplugins.length) {
                if (block === 'default' && userPlugins.length) {
                    block = 'user';
                    pos = 0;
                    curplugins = userPlugins;
                } else {
                    return callback();
                }
            }
            const plugin = curplugins[pos++];
            plugin(mail, err => {
                if (err) {
                    return callback(err);
                }
                processPlugins();
            });
        };

        processPlugins();
    }

    /**
     * Sets up proxy handler for a Nodemailer object
     *
     * @param proxyUrl Proxy configuration url
     */
    setupProxy(proxyUrl: string): void {
        const proxy = urllib.parse(proxyUrl);

        // setup socket handler for the mailer object
        this.getSocket = (options, callback) => {
            const protocol = (proxy.protocol as string).replace(/:$/, '').toLowerCase();

            if (this.meta.has('proxy_handler_' + protocol)) {
                return this.meta.get('proxy_handler_' + protocol)(proxy, options, callback);
            }

            switch (protocol) {
                // Connect using a HTTP CONNECT method
                case 'http':
                case 'https':
                    httpProxyClient(
                        proxy.href,
                        options.port as number | string,
                        options.host as string,
                        this.options.tls || {},
                        (err, socket) => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, {
                                connection: socket
                            });
                        }
                    );
                    return;
                case 'socks':
                case 'socks5':
                case 'socks4':
                case 'socks4a': {
                    if (!this.meta.has('proxy_socks_module')) {
                        let err: NodemailerError = new Error('Socks module not loaded');
                        err.code = errors.EPROXY;
                        return callback(err);
                    }
                    const connect = (ipaddress: string) => {
                        const proxyV2 = !!this.meta.get('proxy_socks_module').SocksClient;
                        const socksClient = proxyV2 ? this.meta.get('proxy_socks_module').SocksClient : this.meta.get('proxy_socks_module');
                        const proxyType = Number((proxy.protocol as string).replace(/\D/g, '')) || 5;
                        const connectionOpts: { [key: string]: any } = {
                            proxy: {
                                ipaddress,
                                port: Number(proxy.port),
                                type: proxyType
                            },
                            [proxyV2 ? 'destination' : 'target']: {
                                host: options.host,
                                port: options.port
                            },
                            command: 'connect'
                        };

                        if (proxy.username || proxy.password) {
                            const username = proxy.username || '';
                            const password = proxy.password || '';
                            if (proxyV2) {
                                connectionOpts.proxy.userId = username;
                                connectionOpts.proxy.password = password;
                            } else if (proxyType === 4) {
                                connectionOpts.userid = username;
                            } else {
                                connectionOpts.authentication = {
                                    username,
                                    password
                                };
                            }
                        }

                        socksClient.createConnection(connectionOpts, (err: NodemailerError | null, info: any) => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, {
                                connection: info.socket || info
                            });
                        });
                    };

                    if (net.isIP(proxy.hostname as string)) {
                        return connect(proxy.hostname as string);
                    }

                    return dns.resolve(proxy.hostname as string, (err, address) => {
                        if (err) {
                            return callback(err);
                        }
                        connect(Array.isArray(address) ? address[0] : address);
                    });
                }
            }
            let err: NodemailerError = new Error('Unknown proxy configuration');
            err.code = errors.EPROXY;
            callback(err);
        };
    }

    _convertDataImages(mail: MailMessage<T>, callback: PluginCallback): void {
        if ((!this.options.attachDataUrls && !mail.data.attachDataUrls) || !mail.data.html) {
            return callback();
        }
        mail.resolveContent(
            mail.data,
            'html',
            { disableFileAccess: mail.data.disableFileAccess, disableUrlAccess: mail.data.disableUrlAccess },
            (err, html) => {
                if (err) {
                    return callback(err);
                }
                let cidCounter = 0;
                html = (html || '')
                    .toString()
                    .replace(
                        /(<img\b[^<>]{0,1024} src\s{0,20}=[\s"']{0,20})(data:([^;]+);[^"'>\s]+)/gi,
                        (match: string, prefix: string, dataUri: string, mimeType: string) => {
                            const cid = crypto.randomBytes(10).toString('hex') + '@localhost';
                            if (!mail.data.attachments) {
                                mail.data.attachments = [];
                            }
                            if (!Array.isArray(mail.data.attachments)) {
                                mail.data.attachments = ([] as MailComposerAttachment[]).concat(mail.data.attachments || []);
                            }
                            mail.data.attachments.push({
                                path: dataUri,
                                cid,
                                filename: 'image-' + ++cidCounter + '.' + mimeTypes.detectExtension(mimeType)
                            });
                            return prefix + 'cid:' + cid;
                        }
                    );
                mail.data.html = html;
                callback();
            }
        );
    }

    set<K extends keyof MailMeta & string>(key: K, value: MailMeta[K]): Map<string, any> {
        return this.meta.set(key, value);
    }

    get<K extends keyof MailMeta & string>(key: K): MailMeta[K] | undefined {
        return this.meta.get(key);
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `Mail.Options` style references keep working
 */
// the namespace member can not refer to the module level type of the same name directly
type MailPluginFunction<T> = PluginFunction<T>;

declare namespace Mail {
    export type Options = SendMailOptions;
    export type Address = MimeNodeAddress;
    export type Attachment = MailComposerAttachment;
    export type AttachmentLike = MailComposerAlternative;
    export type AmpAttachment = MailComposerAlternative;
    export type IcalAttachment = MailComposerIcalEvent;
    export type Headers = MimeNodeHeaders;
    export type ListHeader = MailComposerListHeaderEntry;
    export type ListHeaders = MailComposerListHeaders;
    export type Envelope = MimeNodeEnvelopeInput;
    export type TextEncoding = NonNullable<SendMailOptions['textEncoding']>;
    export type PluginFunction<T = SentMessageInfo> = MailPluginFunction<T>;
}

export default Mail;
