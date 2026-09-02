import { EventEmitter } from 'node:events';
import PoolResource from './pool-resource.js';
import SMTPConnection, { type SMTPConnectionAuth } from '../smtp-connection/index.js';
import wellKnown, { type WellKnownService } from '../well-known/index.js';
import * as shared from '../shared/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import * as packageData from '../package-info.js';
import type {
    SMTPTransportOptions,
    SMTPTransportGetSocketCallback,
    SMTPTransportSendCallback,
    SMTPSentMessageInfo
} from '../smtp-transport/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, VerifyCallback } from '../mailer/index.js';

/**
 * Options for the pooled SMTP transport, the SMTP transport options plus the pool settings
 */
export interface SMTPPoolOptions extends SMTPTransportOptions {
    /** Set to true to get this pooled transport from createTransport */
    pool?: boolean;
    /** Maximum number of open connections, defaults to 5 */
    maxConnections?: number;
    /** Number of messages a connection sends before it is closed and replaced, defaults to 100 */
    maxMessages?: number;
    /** Maximum number of messages to send in rateDelta milliseconds, unlimited when not set */
    rateLimit?: number;
    /** Time window for rateLimit in milliseconds, defaults to 1000 */
    rateDelta?: number;
    /** How many times a message is requeued when its connection closes while sending, unlimited when not set or negative */
    maxRequeues?: number;
}

/**
 * The pool options once the constructor has applied the defaults
 */
export type SMTPPoolResolvedOptions = SMTPPoolOptions & {
    maxConnections: number;
    maxMessages: number;
};

/**
 * Result of a message sent through the pool, same as for the SMTP transport
 */
export type SMTPPoolSentMessageInfo = SMTPSentMessageInfo;

/**
 * Callback for send()
 */
export type SMTPPoolSendCallback = SMTPTransportSendCallback;

/**
 * A message waiting in the pool queue
 */
export interface SMTPPoolQueueEntry {
    /** The message to send */
    mail: MailMessage;
    /** How many times the entry was put back on the queue after its connection closed */
    requeueAttempts: number;
    /** Callback to run once the message is sent or failed */
    callback: SMTPPoolSendCallback;
    /** Message-ID value without the angle brackets, set when the entry is assigned to a connection */
    messageId?: string;
}

/**
 * Rate limiter state of the pool
 */
export interface SMTPPoolRateLimit {
    /** Messages assigned within the current window */
    counter: number;
    /** Timer that clears the current window */
    timeout: NodeJS.Timeout | null;
    /** Availability callbacks waiting for the window to clear */
    waiting: Array<() => void>;
    /** Start of the current window as a timestamp, false when no window is open */
    checkpoint: number | false;
    /** Window length in milliseconds */
    delta: number;
    /** Maximum number of messages per window, 0 for no limit */
    limit: number;
}

/**
 * Creates a SMTP pool transport object for Nodemailer
 *
 * @constructor
 * @param options SMTP Connection options
 */
export default class SMTPPool extends EventEmitter {
    options: SMTPPoolResolvedOptions;
    logger: shared.Logger;
    name: string;
    version: string;
    _rateLimit: SMTPPoolRateLimit;
    _closed: boolean;
    _queue: SMTPPoolQueueEntry[];
    _connections: PoolResource[];
    _connectionCounter: number;
    idling: boolean;

    /**
     * The Mail instance using this transport, assigned by Mail
     */
    declare mailer?: Mail<SMTPPoolSentMessageInfo>;

    constructor(options?: SMTPPoolOptions | string) {
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
        ) as SMTPPoolResolvedOptions;

        this.options.maxConnections = this.options.maxConnections || 5;
        this.options.maxMessages = this.options.maxMessages || 100;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-pool'
        });

        this.name = 'SMTP (pool)';
        this.version = packageData.version + '[client:' + packageData.version + ']';

        this._rateLimit = {
            counter: 0,
            timeout: null,
            waiting: [],
            checkpoint: false,
            delta: Number(this.options.rateDelta) || 1000,
            limit: Number(this.options.rateLimit) || 0
        };
        this._closed = false;
        this._queue = [];
        this._connections = [];
        this._connectionCounter = 0;

        this.idling = true;

        setImmediate(() => {
            if (this.idling) {
                this.emit('idle');
            }
        });
    }

    /**
     * Placeholder function for creating proxy sockets. This method immediatelly returns
     * without a socket
     *
     * @param options Connection options
     * @param callback Callback function to run with the socket keys
     */
    getSocket(options: SMTPPoolOptions, callback: SMTPTransportGetSocketCallback): void {
        // return immediatelly
        setImmediate(() => callback(null, false));
    }

    /**
     * Queues an e-mail to be sent using the selected settings
     *
     * @param mail Mail object
     * @param callback Callback function
     */
    send(mail: MailMessage, callback: SMTPPoolSendCallback): boolean {
        if (this._closed) {
            return false;
        }

        this._queue.push({
            mail,
            requeueAttempts: 0,
            callback
        });

        if (this.idling && this._queue.length >= this.options.maxConnections) {
            this.idling = false;
        }

        setImmediate(() => this._processMessages());

        return true;
    }

    /**
     * Closes all connections in the pool. If there is a message being sent, the connection
     * is closed later
     */
    close(): void {
        let connection: PoolResource | undefined;
        const len = this._connections.length;
        this._closed = true;

        // clear rate limit timer if it exists
        clearTimeout(this._rateLimit.timeout as NodeJS.Timeout);

        if (!len && !this._queue.length) {
            return;
        }

        // remove all available connections
        for (let i = len - 1; i >= 0; i--) {
            if (this._connections[i] && this._connections[i].available) {
                connection = this._connections[i];
                connection.close();
                this.logger.info(
                    {
                        tnx: 'connection',
                        cid: connection.id,
                        action: 'removed'
                    },
                    'Connection #%s removed',
                    connection.id
                );
            }
        }

        if (len && !this._connections.length) {
            this.logger.debug(
                {
                    tnx: 'connection'
                },
                'All connections removed'
            );
        }

        if (!this._queue.length) {
            return;
        }

        // make sure that entire queue would be cleaned
        const invokeCallbacks = () => {
            if (!this._queue.length) {
                this.logger.debug(
                    {
                        tnx: 'connection'
                    },
                    'Pending queue entries cleared'
                );
                return;
            }
            const entry = this._queue.shift();
            if (entry && typeof entry.callback === 'function') {
                try {
                    entry.callback(new Error('Connection pool was closed'));
                } catch (E: any) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection!.id
                        },
                        'Callback error for #%s: %s',
                        connection!.id,
                        E.message
                    );
                }
            }
            setImmediate(invokeCallbacks);
        };
        setImmediate(invokeCallbacks);
    }

    /**
     * Check the queue and available connections. If there is a message to be sent and there is
     * an available connection, then use this connection to send the mail
     */
    _processMessages(): void {
        // do nothing if already closed
        if (this._closed) {
            return;
        }

        // do nothing if queue is empty
        if (!this._queue.length) {
            if (!this.idling) {
                // no pending jobs
                this.idling = true;
                this.emit('idle');
            }
            return;
        }

        // find first available connection
        let connection = this._connections.find(c => c.available);

        if (!connection && this._connections.length < this.options.maxConnections) {
            connection = this._createConnection();
        }

        if (!connection) {
            // no more free connection slots available
            this.idling = false;
            return;
        }

        // check if there is free space in the processing queue
        if (!this.idling && this._queue.length < this.options.maxConnections) {
            this.idling = true;
            this.emit('idle');
        }

        const entry = (connection.queueEntry = this._queue.shift() as SMTPPoolQueueEntry);
        entry.messageId = ((connection.queueEntry.mail.message!.getHeader('message-id') || '') as string).replace(/[<>\s]/g, '');

        connection.available = false;

        this.logger.debug(
            {
                tnx: 'pool',
                cid: connection.id,
                messageId: entry.messageId,
                action: 'assign'
            },
            'Assigned message <%s> to #%s (%s)',
            entry.messageId,
            connection.id,
            connection.messages + 1
        );

        if (this._rateLimit.limit) {
            this._rateLimit.counter++;
            if (!this._rateLimit.checkpoint) {
                this._rateLimit.checkpoint = Date.now();
            }
        }

        connection.send(entry.mail, (err, info) => {
            // only process callback if current handler is not changed
            if (entry === connection.queueEntry) {
                try {
                    entry.callback(err, info);
                } catch (E: any) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        },
                        'Callback error for #%s: %s',
                        connection.id,
                        E.message
                    );
                }
                connection.queueEntry = false;
            }
        });
    }

    /**
     * Creates a new pool resource
     */
    _createConnection(): PoolResource {
        const connection = new PoolResource(this);

        connection.id = ++this._connectionCounter;

        this.logger.info(
            {
                tnx: 'pool',
                cid: connection.id,
                action: 'conection'
            },
            'Created new pool resource #%s',
            connection.id
        );

        // resource comes available
        connection.on('available', () => {
            this.logger.debug(
                {
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'available'
                },
                'Connection #%s became available',
                connection.id
            );

            if (this._closed) {
                // if already closed run close() that will remove this connections from connections list
                this.close();
            } else {
                // check if there's anything else to send
                this._processMessages();
            }
        });

        // resource is terminated with an error
        connection.once('error', (err: NodemailerError) => {
            if (err.code !== errors.EMAXLIMIT) {
                this.logger.warn(
                    {
                        err,
                        tnx: 'pool',
                        cid: connection.id
                    },
                    'Pool Error for #%s: %s',
                    connection.id,
                    err.message
                );
            } else {
                this.logger.debug(
                    {
                        tnx: 'pool',
                        cid: connection.id,
                        action: 'maxlimit'
                    },
                    'Max messages limit exchausted for #%s',
                    connection.id
                );
            }

            if (connection.queueEntry) {
                try {
                    connection.queueEntry.callback(err);
                } catch (E: any) {
                    this.logger.error(
                        {
                            err: E,
                            tnx: 'callback',
                            cid: connection.id
                        },
                        'Callback error for #%s: %s',
                        connection.id,
                        E.message
                    );
                }
                connection.queueEntry = false;
            }

            // remove the erroneus connection from connections list
            this._removeConnection(connection);

            this._continueProcessing();
        });

        connection.once('close', () => {
            this.logger.info(
                {
                    tnx: 'connection',
                    cid: connection.id,
                    action: 'closed'
                },
                'Connection #%s was closed',
                connection.id
            );

            this._removeConnection(connection);

            if (connection.queueEntry) {
                // If the connection closed when sending, add the message to the queue again
                // if max number of requeues is not reached yet
                // Note that we must wait a bit.. because the callback of the 'error' handler might be called
                // in the next event loop
                setTimeout(() => {
                    if (connection.queueEntry) {
                        if (this._shouldRequeuOnConnectionClose(connection.queueEntry)) {
                            this._requeueEntryOnConnectionClose(connection);
                        } else {
                            this._failDeliveryOnConnectionClose(connection);
                        }
                    }
                    this._continueProcessing();
                }, 50);
            } else {
                if (!this._closed && this.idling && !this._connections.length) {
                    this.emit('clear');
                }

                this._continueProcessing();
            }
        });

        this._connections.push(connection);

        return connection;
    }

    _shouldRequeuOnConnectionClose(queueEntry: SMTPPoolQueueEntry): boolean {
        if (this.options.maxRequeues === undefined || this.options.maxRequeues < 0) {
            return true;
        }

        return queueEntry.requeueAttempts < this.options.maxRequeues;
    }

    _failDeliveryOnConnectionClose(connection: PoolResource): void {
        if (connection.queueEntry && connection.queueEntry.callback) {
            try {
                connection.queueEntry.callback(new Error('Reached maximum number of retries after connection was closed'));
            } catch (E: any) {
                this.logger.error(
                    {
                        err: E,
                        tnx: 'callback',
                        messageId: connection.queueEntry.messageId,
                        cid: connection.id
                    },
                    'Callback error for #%s: %s',
                    connection.id,
                    E.message
                );
            }
            connection.queueEntry = false;
        }
    }

    _requeueEntryOnConnectionClose(connection: PoolResource): void {
        (connection.queueEntry as SMTPPoolQueueEntry).requeueAttempts += 1;
        this.logger.debug(
            {
                tnx: 'pool',
                cid: connection.id,
                messageId: (connection.queueEntry as SMTPPoolQueueEntry).messageId,
                action: 'requeue'
            },
            'Re-queued message <%s> for #%s. Attempt: #%s',
            (connection.queueEntry as SMTPPoolQueueEntry).messageId,
            connection.id,
            (connection.queueEntry as SMTPPoolQueueEntry).requeueAttempts
        );
        this._queue.unshift(connection.queueEntry as SMTPPoolQueueEntry);
        connection.queueEntry = false;
    }

    /**
     * Continue to process message if the pool hasn't closed
     */
    _continueProcessing(): void {
        if (this._closed) {
            this.close();
        } else {
            setTimeout(() => this._processMessages(), 100);
        }
    }

    /**
     * Remove resource from pool
     *
     * @param connection The PoolResource to remove
     */
    _removeConnection(connection: PoolResource): void {
        const index = this._connections.indexOf(connection);

        if (index !== -1) {
            this._connections.splice(index, 1);
        }
    }

    /**
     * Checks if connections have hit current rate limit and if so, queues the availability callback
     *
     * @param callback Callback function to run once rate limiter has been cleared
     */
    _checkRateLimit(callback: () => void): void {
        if (!this._rateLimit.limit) {
            return callback();
        }

        const now = Date.now();

        if (this._rateLimit.counter < this._rateLimit.limit) {
            return callback();
        }

        this._rateLimit.waiting.push(callback);

        if ((this._rateLimit.checkpoint as number) <= now - this._rateLimit.delta) {
            return this._clearRateLimit();
        }

        if (!this._rateLimit.timeout) {
            this._rateLimit.timeout = setTimeout(
                () => this._clearRateLimit(),
                this._rateLimit.delta - (now - (this._rateLimit.checkpoint as number))
            );
            this._rateLimit.checkpoint = now;
        }
    }

    /**
     * Clears current rate limit limitation and runs paused callback
     */
    _clearRateLimit(): void {
        clearTimeout(this._rateLimit.timeout as NodeJS.Timeout);
        this._rateLimit.timeout = null;
        this._rateLimit.counter = 0;
        this._rateLimit.checkpoint = false;

        // resume all paused connections
        while (this._rateLimit.waiting.length) {
            const cb = this._rateLimit.waiting.shift();
            setImmediate(cb as () => void);
        }
    }

    /**
     * Returns true if there are free slots in the queue
     */
    isIdle(): boolean {
        return this.idling;
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

        const auth = new PoolResource(this).auth;

        this.getSocket(this.options, (err, socketOptions) => {
            if (err) {
                return callback!(err);
            }

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
                options = Object.assign(shared.assign(false, options), socketOptions);
            }

            const connection = new SMTPConnection(options);
            let returned = false;

            connection.once('error', err => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.close();
                return callback!(err);
            });

            connection.once('end', () => {
                if (returned) {
                    return;
                }
                returned = true;
                return callback!(new Error('Connection closed'));
            });

            const finalize = () => {
                if (returned) {
                    return;
                }
                returned = true;
                connection.quit();
                return callback!(null, true);
            };

            connection.connect(() => {
                if (returned) {
                    return;
                }

                if (auth && (connection.allowsAuth || options.forceAuth)) {
                    connection.login(auth as SMTPConnectionAuth, err => {
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
                } else if (!auth && connection.allowsAuth && options.forceAuth) {
                    const err: NodemailerError = new Error('Authentication info was not provided');
                    err.code = errors.ENOAUTH;

                    returned = true;
                    connection.close();
                    return callback!(err);
                } else {
                    finalize();
                }
            });
        });

        return promise;
    }
}
