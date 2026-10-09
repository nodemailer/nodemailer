import SMTPConnection, { type SMTPEnvelope } from '../smtp-connection/index.js';
import { assign, type Logger } from '../shared/index.js';
import XOAuth2, { type XOAuth2Token } from '../xoauth2/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import { EventEmitter } from 'node:events';
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
    declare auth?: SMTPTransportAuth | undefined;

    /** @internal */
    _connection: boolean;
    /** @internal */
    _connected: boolean;
    /** @internal */
    _failed: boolean;
    /** A message is being sent, its callback decides what an error means for it @internal */
    _sending: boolean;
    /** Closes the connection once it was idle for options.idleTimeout @internal */
    _idleTimer: NodeJS.Timeout | false;

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
    declare queueEntry?: SMTPPoolQueueEntry | false | undefined;

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
                    oauth2.on('error', err => this._fail(err));
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
        this._failed = false;
        this._sending = false;
        this._idleTimer = false;
    }

    /**
     * Emits 'error' for the first failure only. A dead resource can report the same failure more
     * than once (the connection error, then the send callback), the pool handles it once
     * @internal
     */
    _fail(err: NodemailerError): void {
        if (this._failed) {
            return;
        }
        this._failed = true;
        this.emit('error', err);
    }

    /**
     * Initiates a connection to the SMTP server
     *
     * @param callback Callback function to run once the connection is established or failed
     */
    connect(callback: PoolResourceConnectCallback): void {
        // the proxy handshake, if any, counts against connectionTimeout as well
        const connectStartedAt = Date.now();
        this.pool.getSocket(Object.assign({}, this.options, { connectStartedAt }), (err, socketOptions) => {
            if (err) {
                // nothing was connected, so no 'close' event is coming that would free the
                // slot this resource holds in the pool, report the failure the way a failed
                // login does
                this._fail(err);
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

            this.connection._connectStartedAt = connectStartedAt;

            this.connection.on('error', (err: NodemailerError) => {
                if (this._sending) {
                    // the send callback gets the same error and decides what it means for the message
                    return;
                }
                if (this._connected && errors.isTransientError(err)) {
                    // the server ended a connection that had nothing in flight, usually after it
                    // was idle for a while. The 'end' that follows closes this resource
                    this.logger.info(
                        {
                            tnx: 'pool',
                            cid: this.id
                        },
                        'Connection #%s was closed by the server: %s',
                        this.id,
                        err.message
                    );
                    return;
                }
                this._fail(err);
                if (returned) {
                    return;
                }
                returned = true;
                return callback(err);
            });

            this.connection.once('end', () => {
                this.close();
                returned = true;
            });

            this.connection.connect(err => {
                if (returned) {
                    return;
                }

                if (err) {
                    // a close before the greeting, the 'end' that follows closes this resource
                    // and the pool requeues or fails the entry, bounded by maxRequeues
                    returned = true;
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
                            this._fail(err);
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

        const envelope = mail.message.getEnvelope();
        const messageId = mail.message.messageId();

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

        this._sending = true;
        // a connection that sent messages before may have been dropped by the server in between
        const reused = this.messages > 0;
        const messageStream = mail.message.createReadStream();

        this.connection.send(envelope as SMTPEnvelope, messageStream, (err, info) => {
            this._sending = false;
            this.messages++;

            if (err) {
                if (reused && messageStream.readableDidRead === false && errors.isTransientError(err)) {
                    // Not a byte of the message was sent, so it can go out over another
                    // connection. The pool requeues the message when this resource closes
                    this.logger.info(
                        {
                            tnx: 'pool',
                            cid: this.id,
                            messageId
                        },
                        'Connection #%s was closed by the server before message %s was sent: %s',
                        this.id,
                        messageId,
                        err.message
                    );
                    this.connection.close();
                    return;
                }

                if (
                    (err.code === errors.EENVELOPE || err.code === errors.EMESSAGE) &&
                    err.responseCode !== 421 &&
                    !this.connection._destroyed
                ) {
                    // The server refused this message, the connection itself is fine. Reset the
                    // session and keep using it instead of opening a new one
                    this.connection.reset(resetErr => {
                        if (resetErr) {
                            this.connection.close();
                            return;
                        }
                        this._release();
                    });
                    return callback(err);
                }

                this.connection.close();
                this._fail(err);
                return callback(err);
            }

            (info as SMTPPoolSentMessageInfo).envelope = {
                from: envelope.from,
                to: envelope.to
            };
            (info as SMTPPoolSentMessageInfo).messageId = messageId;

            setImmediate(() => this._release());

            callback(null, info as SMTPPoolSentMessageInfo);
        });
    }

    /**
     * Makes the connection available for the next message, or closes it once it has sent
     * maxMessages messages
     *
     * @internal
     */
    _release(): void {
        if (this.messages >= this.options.maxMessages) {
            const err: NodemailerError = new Error('Resource exhausted');
            err.code = errors.EMAXLIMIT;
            this.connection.close();
            this._fail(err);
            return;
        }

        this.pool._checkRateLimit(() => {
            this.available = true;
            this._startIdleTimer();
            this.emit('available');
        });
    }

    /** @internal */
    _startIdleTimer(): void {
        if (!this.options.idleTimeout || this.options.idleTimeout < 0) {
            return;
        }
        // one timer per connection, restarted every time the connection becomes available. A
        // connection that is busy when it fires is simply not closed
        if (this._idleTimer && typeof this._idleTimer.refresh === 'function') {
            this._idleTimer.refresh();
            return;
        }
        clearTimeout(this._idleTimer as NodeJS.Timeout);
        this._idleTimer = setTimeout(() => {
            if (!this.available) {
                return;
            }
            this.logger.debug(
                {
                    tnx: 'pool',
                    cid: this.id
                },
                'Closing connection #%s after it was idle for %sms',
                this.id,
                this.options.idleTimeout
            );
            // not handed another message while it says goodbye
            this.available = false;
            this.connection.quit();
        }, this.options.idleTimeout);
        if (typeof this._idleTimer.unref === 'function') {
            this._idleTimer.unref();
        }
    }

    /** @internal */
    _stopIdleTimer(): void {
        clearTimeout(this._idleTimer as NodeJS.Timeout);
        this._idleTimer = false;
    }

    /**
     * Closes the connection
     */
    close(): void {
        this._connected = false;
        this._stopIdleTimer();
        if (this.auth && this.auth.oauth2) {
            this.auth.oauth2.removeAllListeners();
        }
        if (this.connection) {
            this.connection.close();
        }
        this.emit('close');
    }
}
