import { EventEmitter } from 'node:events';
import SMTPConnection, {
    type SMTPConnectionOptions,
    type SMTPConnectionAuth,
    type SMTPConnectionSendInfo,
    type SMTPEnvelope
} from '../smtp-connection/index.js';
import wellKnown, { type WellKnownService } from '../well-known/index.js';
import * as shared from '../shared/index.js';
import XOAuth2, { type XOAuth2Options, type XOAuth2Token } from '../xoauth2/index.js';
import * as errors from '../errors.js';
import type { Socket } from 'node:net';
import type { NodemailerError, ResultCallback } from '../errors.js';
import * as packageData from '../package-info.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, SentMessageInfo, SendMailOptions, TransportOptions, VerifyCallback } from '../mailer/index.js';
import type { MimeNodeEnvelope } from '../mime-node/index.js';

/**
 * Authentication settings, either from the transport options or from the message data.
 * OAuth2 settings are handed to XOAuth2 as is
 */
export interface SMTPTransportAuthOptions extends XOAuth2Options {
    /** 'OAuth2' selects XOAUTH2, anything else is a password login, 'LOGIN' when not set */
    type?: string;
    /** Username */
    user?: string;
    /** Password */
    pass?: string;
    /** SASL method to use, e.g. 'PLAIN', 'LOGIN' or 'CRAM-MD5' */
    method?: string;
    /** Extra options for the authentication method, handed to a custom SASL handler */
    options?: { [key: string]: any };
    /** Service identifier, an OAuth2 login needs either this or a user */
    service?: string;
}

/**
 * Authentication data built by getAuth() and handed to SMTPConnection#login
 */
export interface SMTPTransportAuth extends SMTPConnectionAuth {
    /** 'OAUTH2', or the upper cased type from the settings, 'LOGIN' when none was given */
    type: string;
    /** 'XOAUTH2' for OAuth2, otherwise the configured SASL method, false lets the connection pick one */
    method: string | false;
}

/**
 * Receives the socket details from getSocket, false when a new socket should be opened. The
 * object is merged into the connection options, a proxy handler provides the connected socket
 * as `connection`
 */
export type SMTPTransportGetSocketCallback = (err: Error | null, socketOptions?: SMTPConnectionOptions | false) => void;

/**
 * Custom socket provider, replaces the getSocket method of the transport
 */
export type SMTPTransportGetSocket = (options: SMTPTransportOptions, callback: SMTPTransportGetSocketCallback) => void;

/**
 * Options for the SMTP transport, the connection options plus the transport level settings
 */
export interface SMTPTransportOptions extends SMTPConnectionOptions, TransportOptions {
    /** Well-known service name, e.g. 'Gmail', fills in host, port and secure */
    service?: string;
    /** Connection url, e.g. 'smtps://user:pass@smtp.example.com', parsed into options */
    url?: string;
    /** Authentication settings, no authentication when not set */
    auth?: SMTPTransportAuthOptions;
    /** Custom socket provider, e.g. for connecting through a proxy, replaces the getSocket method */
    getSocket?: SMTPTransportGetSocket;
    /** Authenticate even when the server does not advertise AUTH, and fail verify() when it does but no credentials were given */
    forceAuth?: boolean;
    /** Default SASL method for the password logins when the auth settings do not name one */
    authMethod?: string;
    /** Logger component name, defaults to 'smtp-transport' */
    component?: string;
    /** Set to true to get a pooled transport from createTransport, this transport does not read it */
    pool?: boolean;
}

/**
 * Result of a sent message, the connection result plus the envelope and the Message-ID
 */
export interface SMTPSentMessageInfo extends SMTPConnectionSendInfo, SentMessageInfo {
    /** Envelope the message was sent with */
    envelope: MimeNodeEnvelope;
    /** Message-ID value of the sent message */
    messageId: string;
    // both base types name these, so they have to be restated to pick the connection shape
    /** Recipients the server accepted */
    accepted: string[];
    /** Recipients the server rejected */
    rejected: string[];
}

/**
 * Callback for send()
 */
export type SMTPTransportSendCallback = ResultCallback<SMTPSentMessageInfo>;

/**
 * Creates a SMTP transport object for Nodemailer
 *
 * @constructor
 * @param options Connection options
 */
class SMTPTransport extends EventEmitter {
    options: SMTPTransportOptions;
    logger: shared.Logger;
    name: string;
    version: string;

    /**
     * Transport level authentication data, set when the options include auth
     */
    declare auth?: SMTPTransportAuth | false;

    /**
     * The Mail instance using this transport, assigned by Mail
     */
    declare mailer?: Mail<SMTPSentMessageInfo>;

    constructor(options?: SMTPTransportOptions | string) {
        super();

        options = options || {};

        if (typeof options === 'string') {
            options = {
                url: options
            };
        }

        let urlData: shared.ConnectionUrlOptions | undefined;
        let service = options.service;

        if (typeof options.getSocket === 'function') {
            this.getSocket = options.getSocket;
        }

        if (options.url) {
            urlData = shared.parseConnectionUrl(options.url);
            service = service || urlData.service;
        }

        this.options = shared.assign(
            false, // create new object
            options, // regular options
            urlData, // url options
            (service && wellKnown(service)) as WellKnownService | false | undefined // wellknown options
        );

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-transport'
        });

        this.name = 'SMTP';
        this.version = packageData.version + '[client:' + packageData.version + ']';

        if (this.options.auth) {
            this.auth = this.getAuth({});
        }
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param options Connection options
     * @param callback Callback function to run with the socket keys
     */
    getSocket(options: SMTPTransportOptions, callback: SMTPTransportGetSocketCallback): void {
        // return immediatelly
        setImmediate(() => callback(null, false));
    }

    getAuth(authOpts?: SMTPTransportAuthOptions | false | null): SMTPTransportAuth | false | undefined {
        if (!authOpts) {
            if (this.auth && this.auth.oauth2 && this.mailer) {
                // Transport-level auth is resolved in the constructor, before the Mail wrapper
                // assigns `this.mailer`, so a provision callback registered with
                // `transporter.set('oauth2_provision_cb', ...)` has to be re-checked here
                this.auth.oauth2.provisionCallback = this.mailer.get('oauth2_provision_cb') || this.auth.oauth2.provisionCallback;
            }
            return this.auth;
        }

        const authData: SMTPTransportAuthOptions = Object.assign(
            {},
            this.options.auth && typeof this.options.auth === 'object' ? this.options.auth : {},
            typeof authOpts === 'object' ? authOpts : {}
        );

        if (Object.keys(authData).length === 0) {
            return false;
        }

        switch ((authData.type || '').toString().toUpperCase()) {
            case 'OAUTH2': {
                if (!authData.service && !authData.user) {
                    return false;
                }
                const oauth2 = new XOAuth2(authData, this.logger);
                oauth2.provisionCallback = (this.mailer && this.mailer.get('oauth2_provision_cb')) || oauth2.provisionCallback;
                oauth2.on('token', (token: XOAuth2Token) => this.mailer!.emit('token', token));
                oauth2.on('error', err => this.emit('error', err));
                return {
                    type: 'OAUTH2',
                    user: authData.user,
                    oauth2,
                    method: 'XOAUTH2'
                };
            }
            default:
                return {
                    type: (authData.type || '').toString().toUpperCase() || 'LOGIN',
                    user: authData.user,
                    credentials: {
                        user: authData.user || '',
                        pass: authData.pass,
                        options: authData.options
                    },
                    method: (authData.method || '').trim().toUpperCase() || this.options.authMethod || false
                };
        }
    }

    /**
     * Sends an e-mail using the selected settings
     *
     * @param mail Mail object
     * @param callback Callback function
     */
    send(mail: MailMessage, callback: SMTPTransportSendCallback): void {
        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback(err);
            }

            let returned = false;
            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );

                // only copy options if we need to modify it
                options = Object.assign(shared.assign(false, options), socketOptions);
            }

            const connection = new SMTPConnection(options);

            let perCallAuth: SMTPTransportAuth | false | null | undefined;
            const cleanupPerCallAuth = () => {
                if (perCallAuth && perCallAuth !== this.auth && perCallAuth.oauth2) {
                    perCallAuth.oauth2.removeAllListeners();
                }
                perCallAuth = null;
            };

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                cleanupPerCallAuth();
                connection.close();
                return callback(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }

                const timer = setTimeout(() => {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    cleanupPerCallAuth();
                    // still have not returned, this means we have an unexpected connection close
                    const err: NodemailerError = new Error('Unexpected socket close');
                    if (connection && connection._socket && (connection._socket as Socket & { upgrading?: boolean }).upgrading) {
                        // starttls connection errors
                        err.code = errors.ETLS;
                    }
                    callback(err);
                }, 1000);

                try {
                    timer.unref();
                } catch (_E) {
                    // Ignore. Happens on envs with non-node timer implementation
                }
            });

            const sendMessage = () => {
                const envelope = mail.message!.getEnvelope();
                const messageId = mail.message!.messageId();

                const recipients = ([] as string[]).concat(envelope.to || []);
                if (recipients.length > 3) {
                    recipients.push('...and ' + recipients.splice(2).length + ' more');
                }

                if (mail.data.dsn) {
                    envelope.dsn = mail.data.dsn;
                }

                // RFC 8689: Pass requireTLSExtensionEnabled to envelope for MAIL FROM parameter
                if (mail.data.requireTLSExtensionEnabled) {
                    envelope.requireTLSExtensionEnabled = mail.data.requireTLSExtensionEnabled;
                }

                this.logger.info(
                    {
                        tnx: 'send',
                        messageId
                    },
                    'Sending message %s to <%s>',
                    messageId,
                    recipients.join(', ')
                );

                connection.send(envelope as SMTPEnvelope, mail.message!.createReadStream(), (err, info) => {
                    returned = true;
                    cleanupPerCallAuth();
                    connection.close();
                    if (err) {
                        this.logger.error(
                            {
                                err,
                                tnx: 'send'
                            },
                            'Send error for %s: %s',
                            messageId,
                            err.message
                        );
                        return callback(err);
                    }
                    (info as SMTPSentMessageInfo).envelope = {
                        from: envelope.from,
                        to: envelope.to
                    };
                    (info as SMTPSentMessageInfo).messageId = messageId;
                    try {
                        return callback(null, info as SMTPSentMessageInfo);
                    } catch (E: any) {
                        this.logger.error(
                            {
                                err: E,
                                tnx: 'callback'
                            },
                            'Callback error for %s: %s',
                            messageId,
                            E.message
                        );
                    }
                });
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                perCallAuth = this.getAuth(mail.data.auth);

                if (perCallAuth && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(perCallAuth, err => {
                        cleanupPerCallAuth();
                        if (returned) {
                            return;
                        }

                        if (err) {
                            returned = true;
                            connection.close();
                            return callback(err);
                        }

                        sendMessage();
                    });
                } else {
                    sendMessage();
                }
            });
        });
    }

    /**
     * Verifies SMTP configuration
     *
     * @param callback Callback function
     */
    verify(): Promise<true>;
    verify(callback: VerifyCallback): void;
    verify(callback?: VerifyCallback): Promise<true> | void {
        let promise: Promise<true> | undefined;

        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback!(err);
            }

            let options = this.options;
            if (socketOptions && socketOptions.connection) {
                this.logger.info(
                    {
                        tnx: 'proxy',
                        remoteAddress: socketOptions.connection.remoteAddress,
                        remotePort: socketOptions.connection.remotePort,
                        destHost: options.host || '',
                        destPort: options.port || '',
                        action: 'connected'
                    },
                    'Using proxied socket from %s:%s to %s:%s',
                    socketOptions.connection.remoteAddress,
                    socketOptions.connection.remotePort,
                    options.host || '',
                    options.port || ''
                );

                options = Object.assign(shared.assign(false, options), socketOptions);
            }

            const connection = new SMTPConnection(options);
            let returned = false;
            let perCallAuth: SMTPTransportAuth | false | null | undefined;
            const cleanupPerCallAuth = () => {
                if (perCallAuth && perCallAuth !== this.auth && perCallAuth.oauth2) {
                    perCallAuth.oauth2.removeAllListeners();
                }
                perCallAuth = null;
            };

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                cleanupPerCallAuth();
                connection.close();
                return callback!(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }
                returned = true;
                cleanupPerCallAuth();
                return callback!(new Error('Connection closed'));
            });

            const finalize = () => {
                if (returned) {
                    return;
                }
                returned = true;
                cleanupPerCallAuth();
                connection.quit();
                return callback!(null, true);
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                perCallAuth = this.getAuth({});

                if (perCallAuth && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(perCallAuth, err => {
                        cleanupPerCallAuth();
                        if (returned) {
                            return;
                        }

                        if (err) {
                            returned = true;
                            connection.close();
                            return callback!(err);
                        }

                        finalize();
                    });
                } else if (!perCallAuth && connection.allowsAuth && options.forceAuth) {
                    const err: NodemailerError = new Error('Authentication info was not provided');
                    err.code = errors.ENOAUTH;

                    returned = true;
                    cleanupPerCallAuth();
                    connection.close();
                    return callback!(err);
                } else {
                    finalize();
                }
            });
        });

        return promise;
    }

    /**
     * Releases resources
     */
    close(): void {
        if (this.auth && this.auth.oauth2) {
            this.auth.oauth2.removeAllListeners();
        }
        this.emit('close');
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `SMTPTransport.Options` style references keep working
 */
declare namespace SMTPTransport {
    export type Options = SMTPTransportOptions;
    export type MailOptions = SendMailOptions;
    export type SentMessageInfo = SMTPSentMessageInfo;
    export type AuthenticationType = SMTPTransportAuth;
}

export default SMTPTransport;
