import SMTPConnection, { type SMTPEnvelope } from '../smtp-connection/index.js';
import { assign, type Logger } from '../shared/index.js';
import XOAuth2, { type XOAuth2Token } from '../xoauth2/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { SMTPTransportAuth, SMTPTransportSendCallback } from '../smtp-transport/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type SMTPPool from './index.js';
import type { SMTPPoolOptions, SMTPPoolResolvedOptions, SMTPPoolQueueEntry, SMTPPoolSentMessageInfo } from './index.js';

/**
 * Callback for connect(), the result is true once the connection is ready for messages
 */
export type PoolResourceConnectCallback = (err: Error | null, connected?: true) => void;

/**
 * Callback for send()
 */
export type PoolResourceSendCallback = SMTPTransportSendCallback;

/**
 * Creates an element for the pool
 *
 * @constructor
 * @param pool SMTPPool instance
 */
export default class PoolResource extends EventEmitter {
    pool: SMTPPool;
    options: SMTPPoolResolvedOptions;
    logger: Logger;

    /**
     * Authentication data for the connection, set when the pool options include auth
     */
    declare auth?: SMTPTransportAuth;

    _connection: boolean;
    _connected: boolean;

    messages: number;
    available: boolean;

    /**
     * The SMTP connection, set by connect()
     */
    declare connection: SMTPConnection;

    /**
     * Resource id, assigned by the pool
     */
    declare id: number;

    /**
     * The queue entry being sent, assigned by the pool. False once it has been handled
     */
    declare queueEntry?: SMTPPoolQueueEntry | false;

    constructor(pool: SMTPPool) {
        super();

        this.pool = pool;
        this.options = pool.options;
        this.logger = this.pool.logger;

        if (this.options.auth) {
            switch ((this.options.auth.type || '').toString().toUpperCase()) {
                case 'OAUTH2': {
                    const oauth2 = new XOAuth2(this.options.auth, this.logger);
                    oauth2.provisionCallback =
                        (this.pool.mailer && this.pool.mailer.get('oauth2_provision_cb')) || oauth2.provisionCallback;
                    this.auth = {
                        type: 'OAUTH2',
                        user: this.options.auth.user,
                        oauth2,
                        method: 'XOAUTH2'
                    };
                    oauth2.on('token', (token: XOAuth2Token) => this.pool.mailer!.emit('token', token));
                    oauth2.on('error', err => this.emit('error', err));
                    break;
                }
                default:
                    if (!this.options.auth.user && !this.options.auth.pass) {
                        break;
                    }
                    this.auth = {
                        type: (this.options.auth.type || '').toString().toUpperCase() || 'LOGIN',
                        user: this.options.auth.user,
                        credentials: {
                            user: this.options.auth.user || '',
                            pass: this.options.auth.pass,
                            options: this.options.auth.options
                        },
                        method: (this.options.auth.method || '').trim().toUpperCase() || this.options.authMethod || false
                    };
            }
        }

        this._connection = false;
        this._connected = false;

        this.messages = 0;
        this.available = true;
    }

    /**
     * Initiates a connection to the SMTP server
     *
     * @param callback Callback function to run once the connection is established or failed
     */
    connect(callback: PoolResourceConnectCallback): void {
        this.pool.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                // nothing was connected, so no 'close' event is coming that would free the
                // slot this resource holds in the pool, report the failure the way a failed
                // login does
                this.emit('error', err);
                return callback(err);
            }

            let returned = false;
            let options: SMTPPoolOptions = this.options;
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

                options = Object.assign(assign(false, options), socketOptions);
            }

            this.connection = new SMTPConnection(options);

            this.connection.once('error', err => {
                this.emit('error', err);
                if (returned) {
                    return;
                }
                returned = true;
                return callback(err);
            });

            this.connection.once('end', () => {
                this.close();
                if (returned) {
                    return;
                }
                returned = true;

                const timer = setTimeout(() => {
                    if (returned) {
                        return;
                    }
                    // still have not returned, this means we have an unexpected connection close
                    const err: NodemailerError = new Error('Unexpected socket close');
                    if (
                        this.connection &&
                        this.connection._socket &&
                        (this.connection._socket as Socket & { upgrading?: boolean }).upgrading
                    ) {
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

            this.connection.connect(() => {
                if (returned) {
                    return;
                }

                if (this.auth && (this.connection.allowsAuth || options.forceAuth)) {
                    this.connection.login(this.auth, err => {
                        if (returned) {
                            return;
                        }
                        returned = true;

                        if (err) {
                            this.connection.close();
                            this.emit('error', err);
                            return callback(err);
                        }

                        this._connected = true;
                        callback(null, true);
                    });
                } else {
                    returned = true;
                    this._connected = true;
                    return callback(null, true);
                }
            });
        });
    }

    /**
     * Sends an e-mail to be sent using the selected settings
     *
     * @param mail Mail object
     * @param callback Callback function
     */
    send(mail: MailMessage, callback: PoolResourceSendCallback): void {
        if (!this._connected) {
            return this.connect(err => {
                if (err) {
                    return callback(err);
                }
                return this.send(mail, callback);
            });
        }

        const envelope = mail.message!.getEnvelope();
        const messageId = mail.message!.messageId();

        const recipients = ([] as string[]).concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId,
                cid: this.id
            },
            'Sending message %s using #%s to <%s>',
            messageId,
            this.id,
            recipients.join(', ')
        );

        if (mail.data.dsn) {
            envelope.dsn = mail.data.dsn;
        }

        // RFC 8689: Pass requireTLSExtensionEnabled to envelope for MAIL FROM parameter
        if (mail.data.requireTLSExtensionEnabled) {
            envelope.requireTLSExtensionEnabled = mail.data.requireTLSExtensionEnabled;
        }

        this.connection.send(envelope as SMTPEnvelope, mail.message!.createReadStream(), (err, info) => {
            this.messages++;

            if (err) {
                this.connection.close();
                this.emit('error', err);
                return callback(err);
            }

            (info as SMTPPoolSentMessageInfo).envelope = {
                from: envelope.from,
                to: envelope.to
            };
            (info as SMTPPoolSentMessageInfo).messageId = messageId;

            setImmediate(() => {
                if (this.messages >= this.options.maxMessages) {
                    const err: NodemailerError = new Error('Resource exhausted');
                    err.code = errors.EMAXLIMIT;
                    this.connection.close();
                    this.emit('error', err);
                } else {
                    this.pool._checkRateLimit(() => {
                        this.available = true;
                        this.emit('available');
                    });
                }
            });

            callback(null, info as SMTPPoolSentMessageInfo);
        });
    }

    /**
     * Closes the connection
     */
    close(): void {
        this._connected = false;
        if (this.auth && this.auth.oauth2) {
            this.auth.oauth2.removeAllListeners();
        }
        if (this.connection) {
            this.connection.close();
        }
        this.emit('close');
    }
}
