import * as packageData from '../package-info.js';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import type { LookupOptions } from 'node:dns';
import os from 'node:os';
import crypto from 'node:crypto';
import DataStream from './data-stream.js';
import { PassThrough, type Readable } from 'node:stream';
import * as shared from '../shared/index.js';
import { ERR_ACCESS_DENIED, isTransientError, type Callback, type NodemailerError, type ResultCallback } from '../errors.js';
import type XOAuth2 from '../xoauth2/index.js';
import type { XOAuth2Options } from '../xoauth2/index.js';

// default timeout values in ms
const CONNECTION_TIMEOUT = 2 * 60 * 1000; // how much to wait for the connection to be established
const SOCKET_TIMEOUT = 10 * 60 * 1000; // how much to wait for socket inactivity before disconnecting the client
const GREETING_TIMEOUT = 30 * 1000; // how much to wait after connection is established but SMTP greeting is not receieved
const DNS_TIMEOUT = 30 * 1000; // how much to wait for resolveHostname
const CLOSE_TIMEOUT = 5 * 1000; // how much to wait for the server to close its side after we closed ours
const KEEPALIVE_DELAY = 30 * 1000; // idle time before TCP keepalive probes start, keeps NAT mappings of idle connections alive
const TEARDOWN_NOOP = () => {}; // reusable no-op handler for absorbing errors during socket teardown

// Random order, so that connections spread over the addresses of a host
function shuffle<T>(list: T[]): T[] {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// Every timeout is reported with the ETIMEDOUT code, timeoutType tells which one it was
function timeoutError(message: string, timeoutType: NonNullable<NodemailerError['timeoutType']>): NodemailerError {
    const err: NodemailerError = new Error(message);
    err.timeoutType = timeoutType;
    return err;
}

// how many bytes a single server response may occupy while it is still being received.
// Generous compared to any real reply, it only stops a peer that never completes one
const MAX_RESPONSE_SIZE = 1024 * 1024;

/**
 * Custom authentication handlers keyed by (case insensitive) SASL method name
 */
export type SMTPConnectionCustomAuthHandlers = { [method: string]: SMTPConnectionCustomAuthHandler };

/**
 * Options for the SMTP connection, see the SMTPConnection class description
 */
export interface SMTPConnectionOptions {
    /** Port to connect to, defaults to 587, or to 465 when secure is set */
    port?: number | string | undefined;
    /** Hostname or IP address to connect to, defaults to 'localhost' */
    host?: string | undefined;
    /** Use TLS from the start */
    secure?: boolean | undefined;
    /** Marks the provided socket as already upgraded to TLS */
    secured?: boolean | undefined;
    /** Server name for SNI, defaults to host when that is not an IP address */
    servername?: string | undefined;
    /** Ignore STARTTLS even when the server advertises it, has no effect when requireTLS is set */
    ignoreTLS?: boolean | undefined;
    /** Force STARTTLS, fail when the server does not support it. Takes precedence over ignoreTLS and opportunisticTLS */
    requireTLS?: boolean | undefined;
    /** Continue unencrypted when the STARTTLS upgrade fails, has no effect when requireTLS is set */
    opportunisticTLS?: boolean | undefined;
    /** Name of the client server, sent with EHLO/HELO, CRLF is stripped */
    name?: string | undefined;
    /** Outbound address to bind to */
    localAddress?: string | undefined;
    /** Time to wait in ms for the connection to establish, defaults to 2 minutes */
    connectionTimeout?: number | undefined;
    /** Time to wait in ms until the greeting is received, defaults to 30 seconds */
    greetingTimeout?: number | undefined;
    /** Time of inactivity in ms until the connection is closed, defaults to 10 minutes */
    socketTimeout?: number | undefined;
    /** Largest single server response to accept in bytes, defaults to 1 MB */
    maxResponseSize?: number | undefined;
    /** Time to wait in ms for the DNS requests to be resolved, defaults to 30 seconds */
    dnsTimeout?: number | undefined;
    /** Use LMTP instead of SMTP */
    lmtp?: boolean | undefined;
    /** Bunyan compatible logger interface, true for the default console logger */
    logger?: shared.ExternalLogger | boolean | undefined;
    /** Pass SMTP traffic, including the message data, to the logger */
    debug?: boolean | undefined;
    /** Pass SMTP commands and responses to the logger */
    transactionLog?: boolean | undefined;
    /** Options for tls.connect */
    tls?: tls.ConnectionOptions | undefined;
    /** Existing socket to use instead of creating a new one, not connected yet */
    socket?: net.Socket | undefined;
    /** Already opened connection to use instead of creating a new one */
    connection?: net.Socket | undefined;
    /** Count loopback interfaces when checking which address families are usable */
    allowInternalNetworkInterfaces?: boolean | undefined;
    /** Logger component name, defaults to 'smtp-connection' */
    component?: string | undefined;
    /** Custom authentication handlers keyed by method name */
    customAuth?: SMTPConnectionCustomAuthHandlers | undefined;
}

/**
 * User and password credentials resolved for a SASL mechanism
 */
export interface SMTPConnectionCredentials {
    user?: string | undefined;
    pass?: string | undefined;
    /** Extra options for the authentication method, copied from the auth object */
    options?: { [key: string]: any } | undefined;
}

/**
 * Authentication data for login()
 */
export interface SMTPConnectionAuth {
    /** Authentication type, informational */
    type?: string | undefined;
    /** SASL method to use, false or unset picks the first supported one (PLAIN if none is advertised) */
    method?: string | false | undefined;
    user?: string | undefined;
    pass?: string | undefined;
    /** Extra options for the authentication method */
    options?: { [key: string]: any } | undefined;
    /** XOAuth2 token generator, selects XOAUTH2 when no method is set */
    oauth2?: XOAuth2 | undefined;
    /** Credentials for the SASL mechanism, filled in from user and pass when missing */
    credentials?: SMTPConnectionCredentials | undefined;
    /** Custom authentication handlers receive the auth object as is, so it may carry any other value */
    [key: string]: any;
}

/**
 * A parsed server reply, handed to the sendCommand callback of a custom authentication handler
 */
export interface SMTPConnectionCustomAuthResponse {
    /** The command that was sent */
    command: string;
    /** Raw server response */
    response: string;
    /** Numeric status code, 0 if the response did not start with one */
    status: number;
    /** Enhanced status code, if any */
    code?: string | undefined;
    /** Response text without the status codes */
    text: string;
}

/**
 * Callback for a command sent by a custom authentication handler
 */
export type SMTPConnectionCustomAuthCommandCallback = (err: Error | null, data: SMTPConnectionCustomAuthResponse) => void;

/**
 * The auth object as a custom authentication handler sees it: the object handed to login()
 * with the credentials filled in from its user and pass values
 */
export interface SMTPConnectionCustomAuthData extends SMTPConnectionAuth {
    /** The user and pass values of the auth object, the way @types/nodemailer declared them */
    credentials: SMTPConnectionCredentials & { user: string; pass: string };
}

/**
 * The object a custom authentication handler is run with
 */
export interface SMTPConnectionCustomAuthContext {
    /** The auth object handed to login(), with the credentials filled in */
    auth: SMTPConnectionCustomAuthData;
    /** Selected authentication method name */
    method: string;
    /** SMTP extensions the server advertised */
    extensions: string[];
    /** SASL methods the server advertised */
    authMethods: string[];
    /** Maximum message size the server accepts, false when not advertised */
    maxAllowedSize: number | false;
    /** Sends a command to the server and resolves with the parsed reply */
    sendCommand(cmd: string): Promise<SMTPConnectionCustomAuthResponse>;
    /** Sends a command to the server and hands the parsed reply to the callback */
    sendCommand(cmd: string, done: SMTPConnectionCustomAuthCommandCallback): void;
    /** Marks the user as authenticated */
    resolve(): void;
    /** Fails the authentication with an error */
    reject(err: Error | string): void;
}

/**
 * A custom authentication handler. Calls resolve() or reject() on the context, or returns a
 * promise that settles the authentication. Any other return value is ignored
 */
export type SMTPConnectionCustomAuthHandler = (ctx: SMTPConnectionCustomAuthContext) => unknown;

/**
 * An envelope address, either a plain string or an object with an address property
 */
export interface SMTPEnvelopeAddress {
    address?: string | undefined;
    name?: string | undefined;
}

/**
 * DSN parameters for the envelope (RFC 3461)
 */
export interface SMTPEnvelopeDsn {
    /** Return either 'HDRS' (headers) or 'FULL' (body) with the notification */
    ret?: string | null | undefined;
    /** Alias of ret */
    return?: string | undefined;
    /** Envelope identifier, sent as ENVID */
    envid?: string | null | undefined;
    /** Alias of envid */
    id?: string | undefined;
    /** When to notify: 'NEVER', or any combination of 'SUCCESS', 'FAILURE' and 'DELAY' */
    notify?: string | string[] | null | undefined;
    /** Original recipient, sent as ORCPT */
    recipient?: string | undefined;
    /** Alias of recipient, in the 'rfc822;address' form */
    orcpt?: string | null | undefined;
}

/**
 * A single DSN notify value
 */
export type SMTPEnvelopeDsnNotify = 'NEVER' | 'SUCCESS' | 'FAILURE' | 'DELAY';

/**
 * Envelope object accepted by send()
 */
export interface SMTPEnvelope {
    /** Sender address, false for the null sender of a bounce message (MAIL FROM:<>) */
    from?: string | SMTPEnvelopeAddress | false | undefined;
    /** Recipient address or addresses */
    to?: string | SMTPEnvelopeAddress | Array<string | SMTPEnvelopeAddress> | undefined;
    /** Message size in bytes, sent as the SIZE parameter when the server supports it */
    size?: number | string | undefined;
    /** DSN parameters, sent when the server supports the DSN extension */
    dsn?: SMTPEnvelopeDsn | undefined;
    /** Declare BODY=8BITMIME when the server supports it */
    use8BitMime?: boolean | undefined;
    /** RFC 8689: send the REQUIRETLS parameter, requires a TLS connection and server support */
    requireTLSExtensionEnabled?: boolean | undefined;
}

/**
 * The envelope as tracked by the connection while a message is being sent. The from and to
 * values are normalized to strings and the recipient bookkeeping is added by _setEnvelope
 */
export interface SMTPConnectionEnvelope extends SMTPEnvelope {
    from?: string | undefined;
    to?: string[] | undefined;
    /** Recipients still waiting for RCPT TO */
    rcptQueue: string[];
    /** Recipients the server rejected */
    rejected: string[];
    /** Errors for the rejected recipients */
    rejectedErrors: NodemailerError[];
    /** Recipients the server accepted */
    accepted: string[];
    /** MAIL FROM, RCPT TO and DATA were sent at once, the replies are read afterwards @internal */
    pipelined?: boolean | undefined;
    /** The MAIL FROM failure of a pipelined envelope, reported once the DATA reply is in @internal */
    mailError?: NodemailerError | undefined;
}

/**
 * The recipient bookkeeping of a sent message, known once the envelope is accepted
 */
export interface SMTPConnectionEnvelopeInfo {
    /** Recipients the server accepted */
    accepted: string[];
    /** Recipients the server rejected */
    rejected: string[];
    /** EHLO response lines, without the greeting line */
    ehlo?: string[] | undefined;
    /** Errors for the rejected recipients */
    rejectedErrors?: NodemailerError[] | undefined;
}

/**
 * Result of a sent message
 */
export interface SMTPConnectionSendInfo extends SMTPConnectionEnvelopeInfo {
    /** Time in ms spent on the envelope commands */
    envelopeTime: number;
    /** Time in ms spent on streaming the message */
    messageTime: number;
    /** Size of the encoded message in bytes */
    messageSize: number;
    /** Final server response for the message */
    response: string;
}

/**
 * Callback for send(), receives the result once the server accepted the message. The error
 * path hands over the error alone
 */
export type SMTPConnectionSendCallback = Callback<SMTPConnectionSendInfo>;

/**
 * Callback for the envelope commands, receives the recipient bookkeeping once the server
 * accepted the DATA command @internal
 */
export type SMTPConnectionEnvelopeCallback = ResultCallback<SMTPConnectionEnvelopeInfo>;

/**
 * Callback for login() and reset(), the result is true on success
 */
export type SMTPConnectionCallback = (err: NodemailerError | null, result?: boolean) => void;

/**
 * Callback for the message data response, yields the server response text
 */
export type SMTPConnectionResponseCallback = (err: NodemailerError | null, response?: string) => void;

/**
 * Callback for connect(), run once the SMTP handshake is finished
 */
export type SMTPConnectionConnectCallback = (err?: NodemailerError) => void;

/**
 * State of the send() in flight
 * @internal
 */
interface SMTPConnectionPendingSend {
    callback: ResultCallback<SMTPConnectionSendInfo>;
    stream: Readable | false;
    onStreamError: (err: Error) => void;
}

/**
 * Options handed to net.connect or tls.connect, resolved hostname values are merged in
 */
export interface SMTPConnectionConnectOptions extends tls.ConnectionOptions {
    port: number;
    host: string;
    /** Outbound address to bind to */
    localAddress?: string | undefined;
    /** Count loopback interfaces when resolving the hostname */
    allowInternalNetworkInterfaces?: boolean | undefined;
    /** DNS lookup timeout in ms */
    timeout?: number | undefined;
    /** Try the resolved addresses in turn, see net.connect */
    autoSelectFamily?: boolean | undefined;
    /** Time in ms an address gets before the next one is tried, see net.connect */
    autoSelectFamilyAttemptTimeout?: number | undefined;
    /** Hands the resolved addresses to net.connect */
    lookup?: net.LookupFunction | undefined;
}

/**
 * A queued handler for the next server response
 */
export type SMTPConnectionResponseAction = (str: string) => void;

/**
 * Re-interpret a server response stored in fake 8-bit byte-container form
 * (the result of chunk.toString('binary') in _onData) as UTF-8.
 *
 * Server reply text has no formally defined charset (RFC 5321 §4.2.1), but
 * modern MTAs commonly use UTF-8. The byte-container plumbing in _onData is
 * required to reassemble multi-byte sequences split across socket chunks;
 * this helper performs the actual decode at the line boundary, falling back
 * to the byte-container form when the bytes are not valid UTF-8 so that
 * legacy 8-bit replies are still recoverable byte-for-byte.
 */
function decodeServerResponse(str: string): string {
    if (!str) {
        return str;
    }
    const utf8 = Buffer.from(str, 'binary').toString('utf8');
    // The input is a byte container (each char is in U+0000..U+00FF) so it can never
    // already contain U+FFFD; any \uFFFD in the result was inserted by Node's UTF-8
    // decoder for invalid bytes, which means we should return the original bytes intact.
    return utf8.includes('\uFFFD') ? str : utf8;
}

/**
 * True when the last line of a queued reply is a continuation ("250-..."), which means
 * the rest of the reply is still on its way.
 *
 * Called with the byte-container form the queue holds (see _onData): the check only looks
 * at leading ASCII digits and '-' of the last line, and a UTF-8 continuation byte is never
 * 0x0A, so line boundaries and the tested prefix are the same before and after decoding.
 * The last line is read with lastIndexOf rather than split() because a queue entry may hold
 * a whole multiline reply and only its final line matters.
 */
function isPartialResponse(str: string): boolean {
    return isPartialLine(str.slice(str.lastIndexOf('\n') + 1));
}

/**
 * True when a single reply line is a continuation ("250-..."). Used where the line is
 * already known to be one line, which skips the scan isPartialResponse needs to find the
 * last line of a whole reply.
 */
function isPartialLine(line: string): boolean {
    return /^\d+-/.test(line);
}

/**
 * Generates a SMTP connection object
 *
 * Optional options object takes the following possible properties:
 *
 *  * **port** - is the port to connect to (defaults to 587 or 465)
 *  * **host** - is the hostname or IP address to connect to (defaults to 'localhost')
 *  * **secure** - use SSL
 *  * **ignoreTLS** - ignore server support for STARTTLS (has no effect when requireTLS is set)
 *  * **requireTLS** - forces the client to use STARTTLS, takes precedence over ignoreTLS and opportunisticTLS
 *  * **name** - the name of the client server
 *  * **localAddress** - outbound address to bind to (see: http://nodejs.org/api/net.html#net_net_connect_options_connectionlistener)
 *  * **greetingTimeout** - Time to wait in ms until greeting message is received from the server (defaults to 30 seconds)
 *  * **connectionTimeout** - how many milliseconds to wait for the connection to establish (defaults to 2 minutes)
 *  * **socketTimeout** - Time of inactivity until the connection is closed (defaults to 10 minutes)
 *  * **maxResponseSize** - Largest single server response to accept in bytes (defaults to 1 MB)
 *  * **dnsTimeout** - Time to wait in ms for the DNS requests to be resolved (defaults to 30 seconds)
 *  * **lmtp** - if true, uses LMTP instead of SMTP protocol
 *  * **logger** - bunyan compatible logger interface
 *  * **debug** - if true pass SMTP traffic to the logger
 *  * **tls** - options for createCredentials
 *  * **socket** - existing socket to use instead of creating a new one (see: http://nodejs.org/api/net.html#net_class_net_socket)
 *  * **secured** - boolean indicates that the provided socket has already been upgraded to tls
 *
 * @constructor
 * @namespace SMTP Client module
 * @param [options] Option properties
 */
class SMTPConnection extends EventEmitter {
    id: string;
    stage: 'init' | 'connected';
    options: SMTPConnectionOptions;
    secureConnection: boolean;
    alreadySecured: boolean;
    port: number;
    host: string;
    servername: string | false;
    allowInternalNetworkInterfaces: boolean;
    name: string;
    logger: shared.Logger;
    customAuth: Map<string, SMTPConnectionCustomAuthHandler>;

    /**
     * Expose version nr, just for the reference
     */
    version: string;

    /**
     * If true, then the user is authenticated
     */
    authenticated: boolean;

    /**
     * If set to true, this instance is no longer active
     * @private
     */
    destroyed: boolean;

    /**
     * Defines if the current connection is secure or not. If not,
     * STARTTLS can be used if available
     * @private
     */
    secure: boolean;

    /**
     * Store incomplete messages coming from the server
     * @internal
     */
    _remainder: string;

    /**
     * Unprocessed responses from the server
     * @internal
     */
    _responseQueue: string[];

    /**
     * True while the last entry of _responseQueue is a partial reply that is still
     * being assembled from continuation lines
     * @internal
     */
    _responsePartial: boolean;

    lastServerResponse: string | false;

    /**
     * The socket connecting to the server
     * @public
     */
    _socket: net.Socket | false | null;

    /**
     * Lists supported auth mechanisms
     * @internal
     */
    _supportedAuth: string[];

    /**
     * Set to true, if EHLO response includes "AUTH".
     * If false then authentication is not tried
     */
    allowsAuth: boolean;

    /**
     * Includes current envelope (from, to)
     * @internal
     */
    _envelope: SMTPConnectionEnvelope | false;

    /**
     * Lists supported extensions
     * @internal
     */
    _supportedExtensions: string[];

    /**
     * Defines the maximum allowed size for a single message
     * @internal
     */
    _maxAllowedSize: number;

    /**
     * Function queue to run if a data chunk comes from the server
     * @internal
     */
    _responseActions: SMTPConnectionResponseAction[];
    /** @internal */
    _recipientQueue: string[];

    /**
     * Timer of the connection phase in progress: connecting, the greeting or a TLS upgrade
     * @internal
     */
    _phaseTimer: NodeJS.Timeout | false;

    /**
     * EHLO response received before STARTTLS, applied only if the session stays in plaintext
     * @internal
     */
    _plaintextEhlo: string | false;

    /**
     * If the socket is deemed already closed
     * @internal
     */
    _destroyed: boolean;

    /**
     * If the socket is already being closed
     * @internal
     */
    _closing: boolean;

    /**
     * Message DATA stream currently piped to the socket, if any. Tracked so
     * close() can unpipe it before tearing the socket down.
     * @internal
     */
    _currentDataStream: DataStream | false;
    /**
     * The send() in flight: its callback, settled by _onError(), and the message stream with its
     * 'error' listener, detached by close()
     * @internal
     */
    _pendingSend: SMTPConnectionPendingSend | false;

    /**
     * Callback handed to connect(), cleared once the handshake finishes
     * @internal
     */
    _connectCallback: SMTPConnectionConnectCallback | false;

    /**
     * Callbacks for socket's listeners
     * @internal
     */
    _onSocketData: (chunk: Buffer) => void;
    /** @internal */
    _onSocketError: (error: Error) => void;
    /** @internal */
    _onSocketClose: () => void;
    /** @internal */
    _onSocketEnd: () => void;
    /** @internal */
    _onSocketTimeout: () => void;

    /**
     * Connection-phase error handler (supports fallback to alternative addresses)
     * @internal
     */
    _onConnectionSocketError: (err: Error) => void;

    /** Time by which the connection has to be established, DNS lookup included @internal */
    _connectionDeadline?: number | undefined;
    /** When connecting started, set by a transport that connected a proxy for this connection first @internal */
    _connectStartedAt?: number | undefined;
    /** connect() was called, it may be called only once @internal */
    _connectCalled?: boolean | undefined;
    /** When the wait for the greeting started @internal */
    _greetingWaitStarted?: number | undefined;

    /**
     * Authentication data, set by login()
     * @internal
     */
    _auth!: SMTPConnectionAuth;

    /**
     * Selected SASL method, set by login()
     * @internal
     */
    _authMethod!: string | false;

    /**
     * True while the STARTTLS upgrade is in progress
     * @private
     */
    upgrading?: boolean | undefined;

    /**
     * EHLO response lines, without the greeting line
     * @internal
     */
    _ehloLines?: string[] | undefined;

    /**
     * True if SMTPUTF8 was declared for the current envelope
     * @internal
     */
    _usingSmtpUtf8?: boolean | undefined;

    /**
     * True if BODY=8BITMIME was declared for the current envelope
     * @internal
     */
    _using8BitMime?: boolean | undefined;

    constructor(options?: SMTPConnectionOptions) {
        super(options as ConstructorParameters<typeof EventEmitter>[0]);

        this.id = crypto.randomBytes(8).toString('base64').replace(/\W/g, '');
        this.stage = 'init';

        this.options = options || {};

        if (this.options.requireTLS && (this.options.ignoreTLS || this.options.opportunisticTLS)) {
            // requireTLS wins, a contradictory configuration must not quietly fall back to plaintext.
            // Copied so the caller's (possibly shared) options object is left as it was
            this.options = Object.assign({}, this.options, { ignoreTLS: false, opportunisticTLS: false });
        }

        this.secureConnection = !!this.options.secure;
        this.alreadySecured = !!this.options.secured;

        this.port = Number(this.options.port) || (this.secureConnection ? 465 : 587);
        this.host = this.options.host || 'localhost';

        this.servername = this.options.servername ? this.options.servername : !net.isIP(this.host) ? this.host : false;

        this.allowInternalNetworkInterfaces = this.options.allowInternalNetworkInterfaces || false;

        if (typeof this.options.secure === 'undefined' && this.port === 465) {
            // if secure option is not set but port is 465, then default to secure
            this.secureConnection = true;
        }

        this.name = (this.options.name || this._getHostname()).toString().replace(/[\r\n]+/g, '');

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'smtp-connection',
            sid: this.id
        });

        this.customAuth = new Map();
        for (const key of Object.keys(this.options.customAuth || {})) {
            const mapKey = (key || '').toString().trim().toUpperCase();
            if (mapKey) {
                this.customAuth.set(mapKey, (this.options.customAuth as SMTPConnectionCustomAuthHandlers)[key]);
            }
        }

        this.version = packageData.version;

        this.authenticated = false;

        this.destroyed = false;

        this.secure = !!this.secureConnection;

        this._remainder = '';

        this._responseQueue = [];

        this._responsePartial = false;

        this.lastServerResponse = false;

        this._socket = false;

        this._supportedAuth = [];

        this.allowsAuth = false;

        this._envelope = false;

        this._supportedExtensions = [];

        this._maxAllowedSize = 0;

        this._responseActions = [];
        this._recipientQueue = [];

        this._phaseTimer = false;

        this._plaintextEhlo = false;

        this._destroyed = false;

        this._closing = false;

        this._currentDataStream = false;
        this._pendingSend = false;
        this._connectCallback = false;

        this._onSocketData = chunk => this._onData(chunk);
        this._onSocketError = error => this._onError(error, 'ESOCKET', false, 'CONN');
        this._onSocketClose = () => this._onClose();
        this._onSocketEnd = () => this._onEnd();
        this._onSocketTimeout = () => this._onTimeout();

        this._onConnectionSocketError = err => this._onError(err, 'ESOCKET', false, 'CONN');
    }

    /**
     * Creates a connection to a SMTP server and sets up connection
     * listener
     */
    connect(connectCallback?: SMTPConnectionConnectCallback): void {
        if (this._connectCalled && !this._destroyed) {
            // A connection is opened once. A second call would open a second socket over the
            // first one and run the session handlers of both against the same state
            const err = this._formatError('Cannot connect - connect() was already called for this connection', 'ECONNECTION', false, 'API');
            if (typeof connectCallback === 'function') {
                setImmediate(() => connectCallback(err));
                return;
            }
            this.logger.warn({ tnx: 'smtp' }, '%s', err.message);
            return;
        }
        this._connectCalled = true;

        if (typeof connectCallback === 'function') {
            this._connectCallback = connectCallback;
            this.once('connect', () => {
                this._connectCallback = false;
                this.logger.debug(
                    {
                        tnx: 'smtp'
                    },
                    'SMTP handshake finished'
                );
                connectCallback();
            });

            const isDestroyedMessage = this._isDestroyedMessage('connect');
            if (isDestroyedMessage) {
                return connectCallback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'CONN'));
            }
        }

        // connectionTimeout covers the whole of connecting: the DNS lookup and every address tried
        const connectionTimeout = this.options.connectionTimeout || CONNECTION_TIMEOUT;
        // a transport that first opened a proxy connection for this one sets when that started
        this._connectionDeadline = (this._connectStartedAt || Date.now()) + connectionTimeout;

        let opts: SMTPConnectionConnectOptions = {
            port: this.port,
            host: this.host,
            allowInternalNetworkInterfaces: this.allowInternalNetworkInterfaces,
            timeout: Math.min(this.options.dnsTimeout || DNS_TIMEOUT, connectionTimeout)
        };

        if (this.options.localAddress) {
            opts.localAddress = this.options.localAddress;
        }

        if (this.options.connection) {
            // connection is already opened
            this._socket = this.options.connection;
            this._setupConnectionHandlers();

            if (this.secureConnection && !this.alreadySecured) {
                setImmediate(() =>
                    this._upgradeConnection(err => {
                        if (err) {
                            this._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'CONN');
                            return;
                        }
                        this._onConnect();
                    })
                );
            } else {
                setImmediate(() => this._onConnect());
            }
            return;
        } else if (this.options.socket) {
            // socket object is set up but not yet connected
            this._socket = this.options.socket;
            return this._resolveAndConnect(opts, _resolved => {
                try {
                    (this._socket as net.Socket).connect(this.port, this.host, () => {
                        // a `secure` connection over a caller-provided socket must still
                        // perform the TLS handshake, otherwise AUTH and the message body
                        // would be sent in cleartext despite the caller requesting TLS
                        if (this.secureConnection && !this.alreadySecured) {
                            return this._upgradeConnection(err => {
                                if (err) {
                                    this._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'CONN');
                                    return;
                                }
                                this._onConnect();
                            });
                        }

                        this._onConnect();
                    });
                    this._setupConnectionHandlers();
                } catch (E: any) {
                    setImmediate(() => this._onError(E, 'ECONNECTION', false, 'CONN'));
                    return;
                }
            });
        } else {
            if (this.secureConnection) {
                Object.assign(opts, this.options.tls || {});

                // ensure servername for SNI
                if (this.servername && !opts.servername) {
                    opts.servername = this.servername;
                }
            }

            return this._resolveAndConnect(opts, resolved => {
                let addresses = resolved._addresses || [];
                if (opts.localAddress) {
                    // a socket bound to an address of one family can not reach the other one
                    const localFamily = net.isIPv6(opts.localAddress) ? 6 : 4;
                    const sameFamily = addresses.filter(addr => net.isIP(addr) === localFamily);
                    addresses = sameFamily.length ? sameFamily : addresses;
                }

                if (addresses.length > 1) {
                    // net.connect tries the addresses in turn and moves on to the next one when an
                    // attempt fails or takes too long. With both families it starts on IPv6 and
                    // alternates (RFC 8305), so a host with a broken IPv6 path costs a fraction of
                    // a second instead of a whole connection timeout
                    const ipv6 = addresses.filter(addr => net.isIPv6(addr));
                    const ipv4 = addresses.filter(addr => !net.isIPv6(addr));
                    const ordered = shuffle(ipv6).concat(shuffle(ipv4));
                    opts.host = this.host;
                    opts.autoSelectFamily = true;
                    if (!ipv6.length || !ipv4.length) {
                        // a slow address of the only family gets its share of the time, not the
                        // quarter second meant for an address family that does not work
                        const remaining = (this._connectionDeadline as number) - Date.now();
                        opts.autoSelectFamilyAttemptTimeout = Math.max(Math.floor(remaining / ordered.length), 10);
                    }
                    opts.lookup = ((hostname: string, lookupOptions: LookupOptions, callback: (...args: any[]) => void) => {
                        if (lookupOptions && lookupOptions.all) {
                            const all = ordered.map(address => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
                            return setImmediate(() => callback(null, all));
                        }
                        setImmediate(() => callback(null, ordered[0], net.isIPv6(ordered[0]) ? 6 : 4));
                    }) as net.LookupFunction;
                } else if (addresses.length) {
                    opts.host = addresses[0];
                }

                this._connectToHost(opts, this.secureConnection);
            });
        }
    }

    /**
     * Resolves the hostname and applies resolved values to opts,
     * then calls the provided callback with the resolved data
     *
     * @param opts Connection options (modified in place)
     * @param callback Called with resolved data on success
     * @internal
     */
    _resolveAndConnect(opts: SMTPConnectionConnectOptions, callback: (resolved: shared.ResolvedHostname) => void): void {
        return shared.resolveHostname(opts, (err, resolved) => {
            if (err) {
                return setImmediate(() => this._onError(err, 'EDNS', false, 'CONN'));
            }
            this.logger.debug(
                {
                    tnx: 'dns',
                    source: opts.host,
                    resolved: resolved!.host,
                    cached: !!resolved!.cached
                },
                'Resolved %s as %s [cache %s]',
                opts.host,
                resolved!.host,
                resolved!.cached ? 'hit' : 'miss'
            );
            for (const key of Object.keys(resolved!)) {
                if (key.charAt(0) !== '_' && (resolved as { [key: string]: any })[key]) {
                    (opts as { [key: string]: any })[key] = (resolved as { [key: string]: any })[key];
                }
            }
            callback(resolved!);
        });
    }

    /**
     * Attempts to connect to the specified host address
     *
     * @param opts Connection options
     * @param secure Whether to use TLS
     * @internal
     */
    _connectToHost(opts: SMTPConnectionConnectOptions, secure: boolean): void {
        // If the client was closed while DNS resolution was in flight, do not open
        // a socket here: close() ran with this._socket still unset and so had
        // nothing to tear down, and _onConnect's remedial close() is a no-op once
        // _closing is set, the freshly connected socket would leak.
        if (this._destroyed || this._closing) {
            return;
        }

        const connectFn: (options: SMTPConnectionConnectOptions, connectionListener: () => void) => net.Socket = secure
            ? tls.connect
            : net.connect;
        try {
            this._socket = connectFn(opts, () => this._onConnect());
            this._setupConnectionHandlers();
        } catch (E: any) {
            setImmediate(() => this._onError(E, 'ECONNECTION', false, 'CONN'));
            return;
        }
    }

    /**
     * Sets up connection timeout and error handlers
     * @internal
     */
    _setupConnectionHandlers(): void {
        this._startPhase(
            Math.max((this._connectionDeadline || Date.now()) - Date.now(), 0),
            timeoutError('Connection timeout', 'CONNECT_TIMEOUT')
        );

        (this._socket as net.Socket).on('error', this._onConnectionSocketError);
    }

    /**
     * Starts the timer of a connection phase: connecting, waiting for the greeting or a TLS
     * upgrade. The phases follow one another, so starting one ends the one before
     *
     * @param timeout Time the phase may take
     * @param err Error to fail with when it takes longer
     * @internal
     */
    _startPhase(timeout: number, err: NodemailerError): void {
        this._clearPhase();
        this._phaseTimer = setTimeout(() => {
            this._phaseTimer = false;
            this._onError(err, 'ETIMEDOUT', false, 'CONN');
        }, timeout);
    }

    /** @internal */
    _clearPhase(): void {
        clearTimeout(this._phaseTimer as NodeJS.Timeout);
        this._phaseTimer = false;
    }

    /**
     * Sends QUIT
     */
    quit(): void {
        this._sendCommand('QUIT');
        this._responseActions.push(this.close);
    }

    /**
     * Closes the connection to the server
     */
    close(): void {
        this._clearPhase();
        this._responseActions = [];

        // allow to run this function only once
        if (this._closing) {
            return;
        }
        this._closing = true;

        const closeMethod = this.stage === 'init' ? 'destroy' : 'end';

        this.logger.debug(
            {
                tnx: 'smtp'
            },
            'Closing connection to the server using "%s"',
            closeMethod
        );

        const socket = (this._socket && (this._socket as net.Socket & { socket?: net.Socket }).socket) || this._socket;

        // Detach any in-flight DATA stream from the socket so the source stream
        // can be garbage-collected once the socket is gone.
        if (this._currentDataStream) {
            try {
                this._currentDataStream.unpipe(this._socket as net.Socket);
            } catch (_E) {
                // ignore
            }
            this._currentDataStream = false;
        }

        // Detach from the message stream as well and release whatever it reads from, the message
        // can not be sent over this connection anymore. The listener is swapped for a no-op rather
        // than removed, a stream destroyed with an error would otherwise throw it as unhandled
        if (this._pendingSend) {
            const { stream, onStreamError } = this._pendingSend;
            if (stream) {
                stream.removeListener('error', onStreamError);
                stream.on('error', TEARDOWN_NOOP);
                stream.destroy();
            }
            this._pendingSend = false;
        }

        if (socket && !socket.destroyed) {
            try {
                // Clear socket timeout to prevent timer leaks
                socket.setTimeout(0);
                // Remove all listeners to allow proper garbage collection
                socket.removeListener('data', this._onSocketData);
                socket.removeListener('timeout', this._onSocketTimeout);
                socket.removeListener('close', this._onSocketClose);
                socket.removeListener('end', this._onSocketEnd);
                socket.removeListener('error', this._onSocketError);
                socket.removeListener('error', this._onConnectionSocketError);
                // Absorb errors that may fire during socket teardown (e.g. server
                // sending cleartext after TLS shutdown triggers ERR_SSL_BAD_RECORD_TYPE)
                socket.on('error', TEARDOWN_NOOP);
                socket[closeMethod]();
                if (closeMethod === 'end') {
                    // end() only closes our side, a server that never closes its own would keep
                    // the socket, and the process with it, around for good
                    const closeTimer = setTimeout(() => socket.destroy(), CLOSE_TIMEOUT);
                    if (typeof closeTimer.unref === 'function') {
                        closeTimer.unref();
                    }
                    socket.once('close', () => clearTimeout(closeTimer));
                }
            } catch (_E) {
                // just ignore
            }
        }

        this._destroy();
    }

    /**
     * Authenticate user
     */
    login(authData: SMTPConnectionAuth | undefined, callback: SMTPConnectionCallback): void {
        const isDestroyedMessage = this._isDestroyedMessage('login');
        if (isDestroyedMessage) {
            return callback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'API'));
        }

        this._auth = authData || {};
        // Select SASL authentication method
        this._authMethod = (this._auth.method || '').toString().trim().toUpperCase() || false;

        // XOAUTH2 needs a token generator or a custom handler, without either the method
        // can not be run even when it is the only one the server advertised
        const canUseXOAuth2 = !!this._auth.oauth2 || this.customAuth.has('XOAUTH2');

        if (!this._authMethod && this._auth.oauth2 && !this._auth.credentials) {
            this._authMethod = 'XOAUTH2';
        } else if (!this._authMethod || (this._authMethod === 'XOAUTH2' && !this._auth.oauth2)) {
            // use the first supported method that can be run
            const supported = this._supportedAuth.find(method => method !== 'XOAUTH2' || canUseXOAuth2);
            this._authMethod = (supported || 'PLAIN').toUpperCase().trim();
        }

        // a token login needs no credentials, every other method and every custom handler
        // gets them filled in from the user and pass values
        if (
            (this._authMethod !== 'XOAUTH2' || this.customAuth.has('XOAUTH2')) &&
            (!this._auth.credentials || !this._auth.credentials.user || !this._auth.credentials.pass)
        ) {
            if ((this._auth.user && this._auth.pass) || this.customAuth.has(this._authMethod)) {
                this._auth.credentials = {
                    user: this._auth.user,
                    pass: this._auth.pass,
                    options: this._auth.options
                };
            } else {
                return callback(this._formatError('Missing credentials for "' + this._authMethod + '"', 'EAUTH', false, 'API'));
            }
        }

        if (this.customAuth.has(this._authMethod)) {
            const handler = this.customAuth.get(this._authMethod) as SMTPConnectionCustomAuthHandler;
            let lastResponse: string | undefined;
            let returned = false;

            const resolve = () => {
                if (returned) {
                    return;
                }
                returned = true;
                this.logger.info(
                    {
                        tnx: 'smtp',
                        username: this._auth.user,
                        action: 'authenticated',
                        method: this._authMethod
                    },
                    'User %s authenticated',
                    JSON.stringify(this._auth.user)
                );
                this.authenticated = true;
                callback(null, true);
            };

            const reject = (err: Error | string) => {
                if (returned) {
                    return;
                }
                returned = true;
                callback(this._formatError(err, 'EAUTH', lastResponse, 'AUTH ' + this._authMethod));
            };

            // one implementation serves both sendCommand overloads, the promise is returned
            // exactly when no callback was given
            const sendCommand = (
                cmd: string,
                done?: SMTPConnectionCustomAuthCommandCallback
            ): Promise<SMTPConnectionCustomAuthResponse> | undefined => {
                let promise: Promise<SMTPConnectionCustomAuthResponse> | undefined;

                if (!done) {
                    promise = new Promise((resolve, reject) => {
                        done = shared.callbackPromise(resolve, reject);
                    });
                }

                this._responseActions.push(str => {
                    lastResponse = str;

                    let codes = str.match(/^(\d+)(?:\s(\d+\.\d+\.\d+))?\s/);
                    let data = {
                        command: cmd,
                        response: str
                    } as SMTPConnectionCustomAuthResponse;
                    if (codes) {
                        data.status = Number(codes[1]) || 0;
                        if (codes[2]) {
                            data.code = codes[2];
                        }
                        data.text = str.substr(codes[0].length);
                    } else {
                        data.text = str;
                        data.status = 0; // just in case we need to perform numeric comparisons
                    }
                    (done as SMTPConnectionCustomAuthCommandCallback)(null, data);
                });
                setImmediate(() => this._sendCommand(cmd));

                return promise;
            };

            const handlerResponse = handler({
                auth: this._auth as SMTPConnectionCustomAuthData,
                method: this._authMethod,

                extensions: ([] as string[]).concat(this._supportedExtensions),
                authMethods: ([] as string[]).concat(this._supportedAuth),
                maxAllowedSize: this._maxAllowedSize || false,

                sendCommand: sendCommand as SMTPConnectionCustomAuthContext['sendCommand'],

                resolve,
                reject
            }) as Promise<unknown> | undefined;

            if (handlerResponse && typeof handlerResponse.catch === 'function') {
                // a promise was returned
                handlerResponse.then(resolve).catch(reject);
            }

            return;
        }

        switch (this._authMethod) {
            case 'XOAUTH2':
                this._handleXOauth2Token(false, callback);
                return;
            case 'LOGIN':
                this._responseActions.push(str => {
                    this._actionAUTH_LOGIN_USER(str, callback);
                });
                this._sendCommand('AUTH LOGIN');
                return;
            case 'PLAIN':
                this._responseActions.push(str => {
                    this._actionAUTHComplete(str, callback);
                });
                this._sendCommand(
                    'AUTH PLAIN ' +
                        Buffer.from(
                            //this._auth.user+'\u0000'+
                            '\u0000' + // skip authorization identity as it causes problems with some servers
                                (this._auth.credentials as SMTPConnectionCredentials).user +
                                '\u0000' +
                                (this._auth.credentials as SMTPConnectionCredentials).pass,
                            'utf-8'
                        ).toString('base64'),
                    // log entry without passwords
                    'AUTH PLAIN ' +
                        Buffer.from(
                            //this._auth.user+'\u0000'+
                            '\u0000' + // skip authorization identity as it causes problems with some servers
                                (this._auth.credentials as SMTPConnectionCredentials).user +
                                '\u0000' +
                                '/* secret */',
                            'utf-8'
                        ).toString('base64')
                );
                return;
            case 'CRAM-MD5':
                this._responseActions.push(str => {
                    this._actionAUTH_CRAM_MD5(str, callback);
                });
                this._sendCommand('AUTH CRAM-MD5');
                return;
        }

        return callback(this._formatError('Unknown authentication method "' + this._authMethod + '"', 'EAUTH', false, 'API'));
    }

    /**
     * Sends a message
     *
     * @param envelope Envelope object, {from: addr, to: [addr]}
     * @param message String, Buffer or a Stream
     * @param done Callback to return once sending is completed
     */
    send(envelope: SMTPEnvelope, message: string | Buffer | Readable, done: SMTPConnectionSendCallback): void {
        // ensure that the callback is only called once. The public callback type has a
        // required result, the error paths hand over the error alone
        let returned = false;
        const callback: ResultCallback<SMTPConnectionSendInfo> = (err, info) => {
            if (returned) {
                return;
            }
            returned = true;
            if (this._pendingSend && this._pendingSend.callback === callback) {
                this._pendingSend = false;
            }

            (done as ResultCallback<SMTPConnectionSendInfo>)(err, info);
        };

        if (!message) {
            return callback(this._formatError('Empty message', 'EMESSAGE', false, 'API'));
        }

        const isDestroyedMessage = this._isDestroyedMessage('send message');
        if (isDestroyedMessage) {
            return callback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'API'));
        }

        // reject larger messages than allowed
        if (this._maxAllowedSize && (envelope.size as number) > this._maxAllowedSize) {
            setImmediate(() => {
                callback(this._formatError('Message size larger than allowed ' + this._maxAllowedSize, 'EMESSAGE', false, 'MAIL FROM'));
            });
            return;
        }

        const pendingSend: SMTPConnectionPendingSend = {
            callback,
            stream: false,
            onStreamError: err => callback(this._formatError(err, 'ESTREAM', false, 'API'))
        };
        if (typeof (message as Readable).on === 'function') {
            pendingSend.stream = message as Readable;
            pendingSend.stream.on('error', pendingSend.onStreamError);
        }
        this._pendingSend = pendingSend;

        const startTime = Date.now();
        this._setEnvelope(envelope, (err, info) => {
            if (err) {
                // the message is not going to be sent, release whatever the stream reads from
                if (typeof (message as Readable).destroy === 'function') {
                    (message as Readable).destroy();
                }

                return callback(err);
            }
            const envelopeTime = Date.now();
            const stream = this._createSendStream((err, str) => {
                if (err) {
                    return callback(err);
                }

                // the envelope info becomes the send result once the timings are on it
                const result = info as SMTPConnectionSendInfo;
                result.envelopeTime = envelopeTime - startTime;
                result.messageTime = Date.now() - envelopeTime;
                result.messageSize = stream.outByteCount;
                result.response = str as string;

                return callback(null, result);
            });
            if (typeof (message as Readable).pipe === 'function') {
                (message as Readable).pipe(stream);
            } else {
                stream.write(message);
                stream.end();
            }
        });
    }

    /**
     * Resets connection state
     *
     * @param callback Callback to return once connection is reset
     */
    reset(callback: SMTPConnectionCallback): void {
        const isDestroyedMessage = this._isDestroyedMessage('reset');
        if (isDestroyedMessage) {
            return callback(this._formatError(isDestroyedMessage, 'ECONNECTION', false, 'API'));
        }

        this._sendCommand('RSET');
        this._responseActions.push(str => {
            if (str.charAt(0) !== '2') {
                return callback(this._formatError('Could not reset session state. response=' + str, 'EPROTOCOL', str, 'RSET'));
            }
            this._envelope = false;
            return callback(null, true);
        });
    }

    /**
     * Connection listener that is run when the connection to
     * the server is opened
     *
     * @event
     * @internal
     */
    _onConnect(): void {
        const socket = this._socket as net.Socket;
        this._clearPhase();

        this.logger.info(
            {
                tnx: 'network',
                localAddress: socket.localAddress,
                localPort: socket.localPort,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort
            },
            '%s established to %s:%s',
            this.secure ? 'Secure connection' : 'Connection',
            socket.remoteAddress,
            socket.remotePort
        );

        if (this._destroyed) {
            // Connection was established after we already had canceled it
            this.close();
            return;
        }

        this.stage = 'connected';

        // clear existing listeners for the socket
        socket.removeListener('data', this._onSocketData);
        socket.removeListener('timeout', this._onSocketTimeout);
        socket.removeListener('close', this._onSocketClose);
        socket.removeListener('end', this._onSocketEnd);
        // Switch from connection-phase error handler to normal error handler
        socket.removeListener('error', this._onConnectionSocketError);
        // _upgradeConnection (options.connection + secure) may already have attached
        // the normal handler; remove it first so we never end up with a duplicate
        socket.removeListener('error', this._onSocketError);

        socket.on('error', this._onSocketError);
        socket.on('data', this._onSocketData);
        socket.once('close', this._onSocketClose);
        socket.once('end', this._onSocketEnd);

        socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT);
        socket.on('timeout', this._onSocketTimeout);

        // keepalive also covers sockets handed over by a proxy or by the caller
        if (typeof socket.setKeepAlive === 'function') {
            socket.setKeepAlive(true, KEEPALIVE_DELAY);
        }
        // Commands are written in the batches they belong to (see cork() for PIPELINING), Nagle
        // would only hold a write back until the server acknowledged the previous one. Against a
        // server that delays its ACKs that costs 40ms on every message
        if (typeof socket.setNoDelay === 'function') {
            socket.setNoDelay(true);
        }

        this._greetingWaitStarted = Date.now();
        this._startPhase(this.options.greetingTimeout || GREETING_TIMEOUT, timeoutError('Greeting never received', 'GREETING_TIMEOUT'));

        this._responseActions.push(this._actionGreeting);

        // we have a 'data' listener set up so resume socket if it was paused
        socket.resume();
    }

    /**
     * Ends the session after a 421 reply. The replies queued for commands sent along with the
     * answered one are not going to come, so the message in flight is failed here
     *
     * @param str The 421 reply
     * @internal
     */
    _onServerClosing(str: string): void {
        if (this._destroyed) {
            return;
        }
        const pendingSend = this._pendingSend;
        const envelope = this._envelope as SMTPConnectionEnvelope | false;
        this._responseActions = [];
        this.close();
        if (pendingSend) {
            pendingSend.callback(
                (envelope && envelope.mailError) || this._formatError('Server closed the connection', 'ECONNECTION', str, 'CONN')
            );
        }
    }

    /**
     * 'data' listener for data coming from the server
     *
     * @event
     * @param chunk Data chunk coming from the server
     * @internal
     */
    _onData(chunk: Buffer): void {
        if (this._destroyed || !chunk || !chunk.length) {
            return;
        }

        const maxResponseSize = this.options.maxResponseSize || MAX_RESPONSE_SIZE;
        const data = chunk.toString('binary');

        // A chunk without a line break only extends the line currently being received, so
        // keep it in the remainder and leave that string unflattened. Splitting the whole
        // remainder again on every chunk would rescan everything buffered for that line so
        // far, which is quadratic in the length of a line the peer never terminates
        if (!data.includes('\n')) {
            this._remainder += data;
            if (this._remainder.length > maxResponseSize) {
                return this._onResponseTooLarge();
            }
            return;
        }

        const lines = (this._remainder + data).split(/\r?\n/);

        this._remainder = lines.pop() as string;

        for (let i = 0, len = lines.length; i < len; i++) {
            if (this._responsePartial) {
                this._responseQueue[this._responseQueue.length - 1] += '\n' + lines[i];
            } else {
                this._responseQueue.push(lines[i]);
            }

            // The line just added is the last line of that queue entry, so it alone decides
            // whether the reply is still partial. Looking for the last line of the accumulated
            // entry instead would rescan a string that grows with every continuation line,
            // which is quadratic in the size of the reply
            this._responsePartial = isPartialLine(lines[i]);

            // Checked as each line lands, so a peer that never completes a reply cannot keep
            // buffering, and the limit does not depend on how it split its bytes into chunks
            if (this._responsePartial && this._responseQueue[this._responseQueue.length - 1].length > maxResponseSize) {
                return this._onResponseTooLarge();
            }
        }

        if (this._remainder.length > maxResponseSize) {
            return this._onResponseTooLarge();
        }

        if (this._responsePartial) {
            return;
        }

        this._processResponse();
    }

    /**
     * Drops a connection whose peer keeps extending a reply it never completes, releasing
     * whatever was buffered for that reply
     * @internal
     */
    _onResponseTooLarge(): void {
        this._remainder = '';
        this._responseQueue = [];
        this._responsePartial = false;
        this._onError(new Error('Server response exceeds maximum allowed size'), 'EPROTOCOL', false, 'CONN');
    }

    /**
     * 'error' listener for the socket
     *
     * @event
     * @param err Error object
     * @param type Error name
     * @param data Server response that triggered the error, false if there is none
     * @param command SMTP command that was in flight
     * @internal
     */
    _onError(err: NodemailerError | string, type: string | false, data: string | false, command: string | false): void {
        this._clearPhase();

        if (this._destroyed) {
            // just ignore, already closed
            // this might happen when a socket is canceled because of reached timeout
            // but the socket timeout error itself receives only after
            return;
        }

        err = this._formatError(err, type, data, command);

        // the message carries the server response, it is an argument and not the format string
        if (isTransientError(err)) {
            this.logger.warn({ tnx: 'smtp', err }, '%s', err.message);
        } else {
            this.logger.error({ tnx: 'smtp', err }, '%s', err.message);
        }

        // close() forgets the send in flight, it is completed with this same error afterwards so
        // a late message stream error has nothing left to report
        const pendingSend = this._pendingSend;
        this.emit('error', err);
        this.close();
        if (pendingSend) {
            pendingSend.callback(err);
        }
    }

    /** @internal */
    _formatError(message: Error | string, type?: string | false, response?: string | false, command?: string | false): NodemailerError {
        let err: NodemailerError;

        if (/Error\]$/i.test(Object.prototype.toString.call(message))) {
            err = message as NodemailerError;
        } else {
            err = new Error(message as string);
        }

        // a permission model denial keeps its own code, see ERR_ACCESS_DENIED
        if (type && type !== 'Error' && err.code !== ERR_ACCESS_DENIED) {
            // the code of a system error, such as ECONNREFUSED, still tells what happened
            if (err.code && err.code !== type && !err.originalCode) {
                err.originalCode = err.code;
            }
            err.code = type;
        }

        if (response) {
            err.response = response;
            err.message += ': ' + response;
        }

        const responseCode = (typeof response === 'string' && Number((response.match(/^\d+/) || [])[0])) || false;
        if (responseCode) {
            err.responseCode = responseCode;
        }

        if (command) {
            err.command = command;
        }

        return err;
    }

    /**
     * 'close' listener for the socket
     *
     * @event
     * @internal
     */
    _onClose(): void {
        let serverResponse: string | false = false;

        if (this._remainder && this._remainder.trim()) {
            this.lastServerResponse = serverResponse = decodeServerResponse(this._remainder.trim());
            if (this.options.debug || this.options.transactionLog) {
                this.logger.debug(
                    {
                        tnx: 'server'
                    },
                    serverResponse
                );
            }
        }

        this.logger.info(
            {
                tnx: 'network'
            },
            'Connection closed'
        );

        // the unterminated remainder is only reported as a reply (and so gives the error a responseCode)
        // when it starts like a complete failure reply, not for a fragment such as "55" or a 250
        const failureResponse = typeof serverResponse === 'string' && /^[45]\d{2}[ -]/.test(serverResponse) ? serverResponse : false;

        if (this.upgrading && !this._destroyed) {
            return this._onError(new Error('Connection closed unexpectedly'), 'ETLS', failureResponse, 'CONN');
        }

        if (!failureResponse && this._responseActions[0] === this._actionGreeting && this._connectCallback && !this._destroyed) {
            // A silent close before the greeting is handed to the connect() callback rather than
            // emitted as 'error', callers that never saw an error for it must not start throwing one
            const connectCallback = this._connectCallback;
            this._connectCallback = false;
            const err = this._formatError(new Error('Connection closed unexpectedly'), 'ECONNECTION', false, 'CONN');
            this.logger.warn({ tnx: 'network' }, err.message);
            connectCallback(err);
            this.close();
            return;
        }

        if (
            !failureResponse &&
            this.stage === 'connected' &&
            !this._responseActions.length &&
            !this._pendingSend &&
            !this._destroyed &&
            !this._closing
        ) {
            // nothing was waiting for the server, so this is the server ending an idle session
            // (usually after its idle timeout), not a failure
            this.logger.info(
                {
                    tnx: 'network'
                },
                'Server closed the idle connection'
            );
            return this._destroy();
        }

        if (failureResponse || (this._responseActions[0] !== this.close && !this._destroyed)) {
            return this._onError(new Error('Connection closed unexpectedly'), 'ECONNECTION', failureResponse, 'CONN');
        }

        this._destroy();
    }

    /**
     * 'end' listener for the socket
     *
     * @event
     * @internal
     */
    _onEnd(): void {
        if (this._socket && !this._socket.destroyed) {
            // Peer sent FIN, finish our half of the close gracefully rather
            // than destroying. 'close' fires after the OS finalizes teardown.
            this._socket.end();
        }
    }

    /**
     * 'timeout' listener for the socket
     *
     * @event
     * @internal
     */
    _onTimeout(): void {
        return this._onError(timeoutError('Timeout', 'SOCKET_TIMEOUT'), 'ETIMEDOUT', false, 'CONN');
    }

    /**
     * Destroys the client, emits 'end'
     * @internal
     */
    _destroy(): void {
        if (this._destroyed) {
            return;
        }
        this._destroyed = true;
        // keep the documented public flag in sync with the private state
        this.destroyed = true;
        // a connection the server dropped before the greeting would otherwise keep
        // the greeting timer, and with it the process, alive until it fires
        this._clearPhase();
        this.emit('end');
    }

    /**
     * Upgrades the connection to TLS
     *
     * @param callback Callback function to run when the connection
     *        has been secured
     * @internal
     */
    _upgradeConnection(callback: (err: Error | null, secured?: boolean) => void): void {
        // RFC 3207 section 6: the client MUST discard any knowledge obtained from
        // the server that was not received over the TLS-protected session. Drop any
        // buffered input received before the handshake so a man-in-the-middle cannot
        // inject plaintext bytes after the "220" reply (e.g. a CRLF-free fragment that
        // would otherwise be prepended to the first post-TLS response and parsed as
        // part of the secured EHLO capabilities). STARTTLS response injection.
        const discarded = this._remainder.length + this._responseQueue.reduce((total, response) => total + response.length, 0);
        if (discarded) {
            // a server does not send anything here on its own, this is worth knowing about
            this.logger.warn(
                {
                    tnx: 'smtp',
                    discarded
                },
                'Discarded %s bytes received in plaintext after the STARTTLS response',
                discarded
            );
        }
        this._plaintextEhlo = false;
        this._remainder = '';
        this._responseQueue = [];
        this._responsePartial = false;

        // do not remove all listeners or it breaks node v0.10 as there's
        // apparently a 'finish' event set that would be cleared as well

        // we can safely keep 'error', 'end', 'close' etc. events
        const socketPlain = this._socket as net.Socket;
        socketPlain.removeListener('data', this._onSocketData); // incoming data is going to be gibberish from this point onwards
        socketPlain.removeListener('timeout', this._onSocketTimeout); // timeout will be re-set for the new socket object
        socketPlain.setTimeout(0);

        const opts: tls.ConnectionOptions = Object.assign(
            {
                socket: socketPlain,
                host: this.host
            },
            this.options.tls || {}
        );

        // ensure servername for SNI
        if (this.servername && !opts.servername) {
            opts.servername = this.servername;
        }

        // Remove all listeners from the plain socket to allow proper garbage
        // collection. Used on both the TLS-success path and the synchronous
        // tls.connect() throw path; either way the plain socket is done.
        const removePlainSocketListeners = () => {
            socketPlain.removeListener('close', this._onSocketClose);
            socketPlain.removeListener('end', this._onSocketEnd);
            socketPlain.removeListener('error', this._onSocketError);
            // the connection-phase handler is attached when upgrading a pre-opened
            // options.connection socket; strip it so nothing lingers on the plain socket
            socketPlain.removeListener('error', this._onConnectionSocketError);
        };

        this.upgrading = true;

        // the socket timeout only notices a server that sends nothing at all, a handshake that
        // trickles along would otherwise hold the connection for as long as the server likes
        // bounded by greetingTimeout and by what is left of connectionTimeout, STARTTLS is the last
        // step of connecting
        const upgradeTimeout = Math.min(
            this.options.greetingTimeout || GREETING_TIMEOUT,
            Math.max((this._connectionDeadline || Infinity) - Date.now(), 1)
        );
        this._startPhase(upgradeTimeout, timeoutError('TLS handshake timed out', 'UPGRADE_TIMEOUT'));

        // tls.connect is not an asynchronous function however it may still throw errors and requires to be wrapped with try/catch
        try {
            this._socket = tls.connect(opts, () => {
                this._clearPhase();
                this.secure = true;
                this.upgrading = false;
                (this._socket as net.Socket).on('data', this._onSocketData);

                removePlainSocketListeners();

                return callback(null, true);
            });
        } catch (err: any) {
            this._clearPhase();
            removePlainSocketListeners();
            return callback(err);
        }

        this._socket.on('error', this._onSocketError);
        this._socket.once('close', this._onSocketClose);
        this._socket.once('end', this._onSocketEnd);

        this._socket.setTimeout(this.options.socketTimeout || SOCKET_TIMEOUT); // 10 min.
        this._socket.on('timeout', this._onSocketTimeout);

        // resume in case the socket was paused
        socketPlain.resume();
    }

    /**
     * Processes queued responses from the server
     * @internal
     */
    _processResponse(): boolean | void {
        if (!this._responseQueue.length) {
            return false;
        }

        const raw = (this._responseQueue.shift() || '').toString();

        // Skip unexpected empty lines without consuming a response action or
        // overwriting lastServerResponse; reprocess whatever else is queued.
        if (!raw.trim()) {
            setImmediate(() => this._processResponse());
            return;
        }

        if (isPartialResponse(raw)) {
            // the rest of the reply is still on its way: put it back on the queue and wait
            // rather than dropping it. It has not been received in full, so it must not be
            // reported as the last server response either
            this._responseQueue.unshift(raw);
            return;
        }

        const str = (this.lastServerResponse = decodeServerResponse(raw));

        if (this.options.debug || this.options.transactionLog) {
            this.logger.debug(
                {
                    tnx: 'server'
                },
                str.replace(/\r?\n$/, '')
            );
        }

        const action = this._responseActions.shift();
        // RFC 5321 4.2: 421 means the server is about to close the connection, whatever it answers
        const closing = /^421[ -]/.test(str);

        if (typeof action === 'function') {
            // the command gets its own error first, the code tells which step failed
            action.call(this, str);
            if (closing) {
                return this._onServerClosing(str);
            }
            setImmediate(() => this._processResponse());
        } else if (closing && !this._pendingSend && this.stage === 'connected') {
            // RFC 5321 4.2: a server may send 421 at any time when it is about to close the
            // connection. Nothing was waiting for a reply, so this ends an idle session
            this.logger.info(
                {
                    tnx: 'smtp'
                },
                'Server closed the idle connection: %s',
                str
            );
            this.close();
        } else {
            return this._onError(new Error('Unexpected Response'), 'EPROTOCOL', str, 'CONN');
        }
    }

    /**
     * Send a command to the server, append \r\n
     *
     * @param str String to be sent to the server
     * @param logStr Optional string to be used for logging instead of the actual string
     * @internal
     */
    _sendCommand(str: string, logStr?: string): void {
        if (this._destroyed) {
            // Connection already closed, can't send any more data
            return;
        }

        const socket = this._socket as net.Socket;
        if (socket.destroyed) {
            return this.close();
        }

        if (this.options.debug || this.options.transactionLog) {
            this.logger.debug(
                {
                    tnx: 'client'
                },
                (logStr || str || '').toString().replace(/\r?\n$/, '')
            );
        }

        socket.write(Buffer.from(str + '\r\n', 'utf-8'));
    }

    /**
     * Initiates a new message by submitting envelope data, starting with
     * MAIL FROM: command
     *
     * @param envelope Envelope object in the form of
     *        {from:'...', to:['...']}
     *        or
     *        {from:{address:'...',name:'...'}, to:[address:'...',name:'...']}
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _setEnvelope(envelope: SMTPEnvelope | undefined, callback: SMTPConnectionEnvelopeCallback): void {
        const args: string[] = [];
        let useSmtpUtf8 = false;

        this._envelope = (envelope || {}) as SMTPConnectionEnvelope;
        this._envelope.from = ((this._envelope.from && (this._envelope.from as SMTPEnvelopeAddress).address) || this._envelope.from || '')
            .toString()
            .trim();

        this._envelope.to = ([] as Array<string | SMTPEnvelopeAddress>)
            .concat((this._envelope.to as SMTPEnvelope['to']) || [])
            .map(to => ((to && (to as SMTPEnvelopeAddress).address) || to || '').toString().trim());

        if (!this._envelope.to.length) {
            return callback(this._formatError('No recipients defined', 'EENVELOPE', false, 'API'));
        }

        if (this._envelope.from && /[\r\n<>]/.test(this._envelope.from)) {
            return callback(this._formatError('Invalid sender ' + JSON.stringify(this._envelope.from), 'EENVELOPE', false, 'API'));
        }

        // check if the sender address uses only ASCII characters,
        // otherwise require usage of SMTPUTF8 extension
        if (/[\x80-\uFFFF]/.test(this._envelope.from)) {
            useSmtpUtf8 = true;
        }

        for (let i = 0, len = this._envelope.to.length; i < len; i++) {
            if (!this._envelope.to[i] || /[\r\n<>]/.test(this._envelope.to[i])) {
                return callback(this._formatError('Invalid recipient ' + JSON.stringify(this._envelope.to[i]), 'EENVELOPE', false, 'API'));
            }

            // check if the recipients addresses use only ASCII characters,
            // otherwise require usage of SMTPUTF8 extension
            if (/[\x80-\uFFFF]/.test(this._envelope.to[i])) {
                useSmtpUtf8 = true;
            }
        }

        // clone the recipients array for latter manipulation
        this._envelope.rcptQueue = ([] as string[]).concat(this._envelope.to || []);
        this._envelope.rejected = [];
        this._envelope.rejectedErrors = [];
        this._envelope.accepted = [];

        if (this._envelope.dsn) {
            try {
                this._envelope.dsn = this._setDsnEnvelope(this._envelope.dsn);
            } catch (err: any) {
                return callback(this._formatError('Invalid DSN ' + err.message, 'EENVELOPE', false, 'API'));
            }
        }

        // RFC 8689: validate REQUIRETLS eligibility before queuing the MAIL FROM
        // response action, so a rejection here cannot leave an orphaned action in
        // _responseActions (which would consume the next reply and desync a reused
        // connection).
        if (this._envelope.requireTLSExtensionEnabled) {
            if (!this.secure) {
                return callback(
                    this._formatError('REQUIRETLS can only be used over TLS connections (RFC 8689)', 'EREQUIRETLS', false, 'MAIL FROM')
                );
            }
            if (!this._supportedExtensions.includes('REQUIRETLS')) {
                return callback(
                    this._formatError('Server does not support REQUIRETLS extension (RFC 8689)', 'EREQUIRETLS', false, 'MAIL FROM')
                );
            }
        }

        // RFC 2920: with PIPELINING the whole envelope and DATA go out without waiting for the
        // replies in between, which saves two round trips for every message
        this._envelope.pipelined = this._supportedExtensions.includes('PIPELINING');

        this._responseActions.push(str => {
            this._actionMAIL(str, callback);
        });

        // If the server supports SMTPUTF8 and the envelope includes an internationalized
        // email address then append SMTPUTF8 keyword to the MAIL FROM command
        if (useSmtpUtf8 && this._supportedExtensions.includes('SMTPUTF8')) {
            args.push('SMTPUTF8');
            this._usingSmtpUtf8 = true;
        }

        // If the server supports 8BITMIME and the message might contain non-ascii bytes
        // then append the 8BITMIME keyword to the MAIL FROM command
        if (this._envelope.use8BitMime && this._supportedExtensions.includes('8BITMIME')) {
            args.push('BODY=8BITMIME');
            this._using8BitMime = true;
        }

        if (this._envelope.size && this._supportedExtensions.includes('SIZE')) {
            const sizeValue = Number(this._envelope.size) || 0;
            if (sizeValue > 0) {
                args.push('SIZE=' + sizeValue);
            }
        }

        // If the server supports DSN and the envelope includes an DSN prop
        // then append DSN params to the MAIL FROM command
        if (this._envelope.dsn && this._supportedExtensions.includes('DSN')) {
            if (this._envelope.dsn.ret) {
                args.push('RET=' + shared.encodeXText(this._envelope.dsn.ret));
            }
            if (this._envelope.dsn.envid) {
                args.push('ENVID=' + shared.encodeXText(this._envelope.dsn.envid));
            }
        }

        // RFC 8689: append the REQUIRETLS keyword to MAIL FROM. Eligibility
        // (TLS connection + server support) was already validated above, before
        // the response action was queued.
        if (this._envelope.requireTLSExtensionEnabled) {
            args.push('REQUIRETLS');
        }

        const mailFrom = 'MAIL FROM:<' + this._envelope.from + '>' + (args.length ? ' ' + args.join(' ') : '');
        this._recipientQueue = [];
        if (!this._envelope.pipelined) {
            this._sendCommand(mailFrom);
            return;
        }

        // corked, so the batch leaves in one segment instead of the first command alone
        const socket = this._socket as net.Socket;
        socket.cork();
        this._sendCommand(mailFrom);
        while (this._envelope.rcptQueue.length) {
            this._sendRcpt(this._envelope.rcptQueue.shift() as string, callback);
        }
        this._responseActions.push(str => {
            this._actionDATA(str, callback);
        });
        this._sendCommand('DATA');
        socket.uncork();
    }

    /**
     * Sends RCPT TO for a recipient and queues the handler for the reply
     *
     * @param recipient Recipient address
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _sendRcpt(recipient: string, callback: SMTPConnectionEnvelopeCallback): void {
        this._recipientQueue.push(recipient);
        this._responseActions.push(str => {
            this._actionRCPT(str, callback);
        });
        this._sendCommand('RCPT TO:<' + recipient + '>' + this._getDsnRcptToArgs());
    }

    /** @internal */
    _setDsnEnvelope(params: SMTPEnvelopeDsn): SMTPEnvelopeDsn {
        let ret = (params.ret || params.return || '').toString().toUpperCase() || null;
        if (ret) {
            switch (ret) {
                case 'HDRS':
                case 'HEADERS':
                    ret = 'HDRS';
                    break;
                case 'FULL':
                case 'BODY':
                    ret = 'FULL';
                    break;
            }
        }

        if (ret && !['FULL', 'HDRS'].includes(ret)) {
            throw new Error('ret: ' + JSON.stringify(ret));
        }

        const envid = (params.envid || params.id || '').toString() || null;

        let notify = params.notify || null;
        if (notify) {
            if (typeof notify === 'string') {
                notify = notify.split(',');
            }
            notify = notify.map(n => n.trim().toUpperCase());
            const validNotify = ['NEVER', 'SUCCESS', 'FAILURE', 'DELAY'];
            const invalidNotify = notify.filter(n => !validNotify.includes(n));
            if (invalidNotify.length || (notify.length > 1 && notify.includes('NEVER'))) {
                throw new Error('notify: ' + JSON.stringify(notify.join(',')));
            }
            notify = notify.join(',');
        }

        let orcpt = (params.recipient || params.orcpt || '').toString() || null;
        if (orcpt && orcpt.indexOf(';') < 0) {
            orcpt = 'rfc822;' + orcpt;
        }

        return {
            ret,
            envid,
            notify,
            orcpt
        };
    }

    /** @internal */
    _getDsnRcptToArgs(): string {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        const args: string[] = [];
        // If the server supports DSN and the envelope includes an DSN prop
        // then append DSN params to the RCPT TO command
        if (envelope.dsn && this._supportedExtensions.includes('DSN')) {
            if (envelope.dsn.notify) {
                args.push('NOTIFY=' + shared.encodeXText(envelope.dsn.notify as string));
            }
            if (envelope.dsn.orcpt) {
                args.push('ORCPT=' + shared.encodeXText(envelope.dsn.orcpt as string));
            }
        }
        return args.length ? ' ' + args.join(' ') : '';
    }

    /** @internal */
    _createSendStream(callback: SMTPConnectionResponseCallback): DataStream {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        const dataStream = new DataStream();

        if (this.options.lmtp) {
            envelope.accepted.forEach((recipient, i) => {
                const final = i === envelope.accepted.length - 1;
                this._responseActions.push(str => {
                    this._actionLMTPStream(recipient, final, str, callback);
                });
            });
        } else {
            this._responseActions.push(str => {
                this._actionSMTPStream(str, callback);
            });
        }

        this._currentDataStream = dataStream;
        dataStream.pipe(this._socket as net.Socket, {
            end: false
        });

        if (this.options.debug) {
            const logStream = new PassThrough();
            logStream.on('readable', () => {
                let chunk: Buffer;
                while ((chunk = logStream.read())) {
                    this.logger.debug(
                        {
                            tnx: 'message'
                        },
                        chunk.toString('binary').replace(/\r?\n$/, '')
                    );
                }
            });
            dataStream.pipe(logStream);
        }

        dataStream.once('end', () => {
            if (this._currentDataStream === dataStream) {
                this._currentDataStream = false;
            }
            this.logger.info(
                {
                    tnx: 'message',
                    inByteCount: dataStream.inByteCount,
                    outByteCount: dataStream.outByteCount
                },
                '<%s bytes encoded mime message (source size %s bytes)>',
                dataStream.outByteCount,
                dataStream.inByteCount
            );
        });

        return dataStream;
    }

    /** ACTIONS **/

    /**
     * Will be run after the connection is created and the server sends
     * a greeting. If the incoming message starts with 220 initiate
     * SMTP session by sending EHLO command
     *
     * @param str Message from the server
     * @internal
     */
    _actionGreeting(str: string): void {
        this._clearPhase();
        // the wait for the greeting has a limit of its own (greetingTimeout), it does not use up
        // the time connectionTimeout leaves for setting the session up
        if (this._connectionDeadline && this._greetingWaitStarted) {
            this._connectionDeadline += Date.now() - this._greetingWaitStarted;
        }

        if (str.substr(0, 3) !== '220') {
            this._onError(new Error('Invalid greeting. response=' + str), 'EPROTOCOL', str, 'CONN');
            return;
        }

        if (this.options.lmtp) {
            this._responseActions.push(this._actionLHLO);
            this._sendCommand('LHLO ' + this.name);
        } else {
            this._responseActions.push(this._actionEHLO);
            this._sendCommand('EHLO ' + this.name);
        }
    }

    /**
     * Handles server response for LHLO command. If it yielded in
     * error, emit 'error', otherwise treat this as an EHLO response
     *
     * @param str Message from the server
     * @internal
     */
    _actionLHLO(str: string): void {
        if (str.charAt(0) !== '2') {
            this._onError(new Error('Invalid LHLO. response=' + str), 'EPROTOCOL', str, 'LHLO');
            return;
        }

        this._actionEHLO(str);
    }

    /**
     * Handles server response for EHLO command. If it yielded in
     * error, try HELO instead, otherwise initiate TLS negotiation
     * if STARTTLS is supported by the server or move into the
     * authentication phase.
     *
     * @param str Message from the server
     * @internal
     */
    _actionEHLO(str: string): void {
        if (str.substr(0, 3) === '421') {
            this._onError(new Error('Server terminates connection. response=' + str), 'ECONNECTION', str, 'EHLO');
            return;
        }

        if (str.charAt(0) !== '2') {
            if (this.options.requireTLS) {
                this._onError(
                    new Error('EHLO failed but HELO does not support required STARTTLS. response=' + str),
                    'ECONNECTION',
                    str,
                    'EHLO'
                );
                return;
            }

            // Try HELO instead
            this._responseActions.push(this._actionHELO);
            this._sendCommand('HELO ' + this.name);
            return;
        }

        // Detect if the server supports STARTTLS
        if (!this.secure && !this.options.ignoreTLS && (/[ -]STARTTLS\b/im.test(str) || this.options.requireTLS)) {
            // kept for opportunisticTLS, a session that stays in plaintext still has these extensions
            this._plaintextEhlo = str;
            this._sendCommand('STARTTLS');
            this._responseActions.push(this._actionSTARTTLS);
            return;
        }

        this._parseEhloExtensions(str);
        this.emit('connect');
    }

    /**
     * Reads the extensions and the authentication mechanisms out of an EHLO response
     *
     * @param str EHLO response from the server
     * @internal
     */
    _parseEhloExtensions(str: string): void {
        let match: RegExpMatchArray | null;

        this._ehloLines = str
            .split(/\r?\n/)
            .map(line => line.replace(/^\d+[ -]/, '').trim())
            .filter(line => line)
            .slice(1);

        // Detect if the server supports SMTPUTF8
        if (/[ -]SMTPUTF8\b/im.test(str)) {
            this._supportedExtensions.push('SMTPUTF8');
        }

        // Detect if the server supports DSN
        if (/[ -]DSN\b/im.test(str)) {
            this._supportedExtensions.push('DSN');
        }

        // Detect if the server supports 8BITMIME
        if (/[ -]8BITMIME\b/im.test(str)) {
            this._supportedExtensions.push('8BITMIME');
        }

        // Detect if the server supports REQUIRETLS (RFC 8689)
        if (/[ -]REQUIRETLS\b/im.test(str)) {
            this._supportedExtensions.push('REQUIRETLS');
        }

        // Detect if the server supports PIPELINING
        if (/[ -]PIPELINING\b/im.test(str)) {
            this._supportedExtensions.push('PIPELINING');
        }

        // Detect if the server supports AUTH
        if (/[ -]AUTH\b/i.test(str)) {
            this.allowsAuth = true;
        }

        // Detect the advertised SASL mechanisms. The list is split into whole tokens rather
        // than searched for each name with a pattern: the patterns this replaced let two
        // whitespace runs overlap and backtracked quadratically over an AUTH line padded with
        // spaces, so a hostile server could stall the event loop from its EHLO reply
        // (GHSA-4ffr-jq9g-5ffx).
        const authMechanisms = new Set<string>();
        for (const line of this._ehloLines) {
            const authMatch = /^AUTH[\s=](.*)/i.exec(line);
            if (authMatch) {
                for (const mechanism of authMatch[1].split(/[\s=]+/)) {
                    authMechanisms.add(mechanism.toUpperCase());
                }
            }
        }
        // listed in order of preference, the first one the credentials allow is used
        for (const mechanism of ['PLAIN', 'LOGIN', 'CRAM-MD5', 'XOAUTH2']) {
            if (authMechanisms.has(mechanism)) {
                this._supportedAuth.push(mechanism);
            }
        }

        // Detect if the server supports SIZE extensions (and the max allowed size)
        if ((match = str.match(/[ -]SIZE(?:[ \t]+(\d+))?/im))) {
            this._supportedExtensions.push('SIZE');
            this._maxAllowedSize = Number(match[1]) || 0;
        }
    }

    /**
     * Handles server response for HELO command. If it yielded in
     * error, emit 'error', otherwise move into the authentication phase.
     *
     * @param str Message from the server
     * @internal
     */
    _actionHELO(str: string): void {
        if (str.charAt(0) !== '2') {
            this._onError(new Error('Invalid HELO. response=' + str), 'EPROTOCOL', str, 'HELO');
            return;
        }

        // assume that authentication is enabled (most probably is not though)
        this.allowsAuth = true;

        this.emit('connect');
    }

    /**
     * Handles server response for STARTTLS command. If there's an error
     * try HELO instead, otherwise initiate TLS upgrade. If the upgrade
     * succeedes restart the EHLO
     *
     * @param str Message from the server
     * @internal
     */
    _actionSTARTTLS(str: string): void {
        if (str.charAt(0) !== '2') {
            if (this.options.opportunisticTLS) {
                this.logger.info(
                    {
                        tnx: 'smtp'
                    },
                    'Failed STARTTLS upgrade, continuing unencrypted'
                );
                // the plaintext session goes on with what the server announced for it, except for
                // AUTH: credentials are not sent over a connection that failed to encrypt
                if (this._plaintextEhlo) {
                    this._parseEhloExtensions(this._plaintextEhlo);
                    this._plaintextEhlo = false;
                    this.allowsAuth = false;
                    this._supportedAuth = [];
                }
                this.emit('connect');
                return;
            }
            this._onError(new Error('Error upgrading connection with STARTTLS'), 'ETLS', str, 'STARTTLS');
            return;
        }

        this._upgradeConnection((err, secured) => {
            if (err) {
                this._onError(new Error('Error initiating TLS - ' + (err.message || err)), 'ETLS', false, 'STARTTLS');
                return;
            }

            this.logger.info(
                {
                    tnx: 'smtp'
                },
                'Connection upgraded with STARTTLS'
            );

            if (secured) {
                // restart session
                if (this.options.lmtp) {
                    this._responseActions.push(this._actionLHLO);
                    this._sendCommand('LHLO ' + this.name);
                } else {
                    this._responseActions.push(this._actionEHLO);
                    this._sendCommand('EHLO ' + this.name);
                }
            } else {
                this.emit('connect');
            }
        });
    }

    /**
     * Handle the response for AUTH LOGIN command. We are expecting
     * '334 VXNlcm5hbWU6' (base64 for 'Username:'). Data to be sent as
     * response needs to be base64 encoded username. We do not need
     * exact match but settle with 334 response in general as some
     * hosts invalidly use a longer message than VXNlcm5hbWU6
     *
     * @param str Message from the server
     * @param callback Callback to run once the authentication sequence completes
     * @internal
     */
    _actionAUTH_LOGIN_USER(str: string, callback: SMTPConnectionCallback): void {
        if (!/^334[ -]/.test(str)) {
            // expecting '334 VXNlcm5hbWU6'
            callback(this._formatError('Invalid login sequence while waiting for "334 VXNlcm5hbWU6"', 'EAUTH', str, 'AUTH LOGIN'));
            return;
        }

        this._responseActions.push(str => {
            this._actionAUTH_LOGIN_PASS(str, callback);
        });

        this._sendCommand(Buffer.from((this._auth.credentials as SMTPConnectionCredentials).user + '', 'utf-8').toString('base64'));
    }

    /**
     * Handle the response for AUTH CRAM-MD5 command. We are expecting
     * '334 <challenge string>'. Data to be sent as response needs to be
     * base64 decoded challenge string, MD5 hashed using the password as
     * a HMAC key, prefixed by the username and a space, and finally all
     * base64 encoded again.
     *
     * @param str Message from the server
     * @param callback Callback to run once the authentication sequence completes
     * @internal
     */
    _actionAUTH_CRAM_MD5(str: string, callback: SMTPConnectionCallback): void {
        const challengeMatch = str.match(/^334\s+(.+)$/);

        if (!challengeMatch) {
            return callback(
                this._formatError('Invalid login sequence while waiting for server challenge string', 'EAUTH', str, 'AUTH CRAM-MD5')
            );
        }

        // Decode from base64
        const base64decoded = Buffer.from(challengeMatch[1], 'base64').toString('ascii');
        const hmacMD5 = crypto.createHmac('md5', (this._auth.credentials as SMTPConnectionCredentials).pass as string);

        hmacMD5.update(base64decoded);

        const prepended = (this._auth.credentials as SMTPConnectionCredentials).user + ' ' + hmacMD5.digest('hex');

        this._responseActions.push(str => {
            this._actionAUTH_CRAM_MD5_PASS(str, callback);
        });

        this._sendCommand(
            Buffer.from(prepended).toString('base64'),
            // hidden hash for logs
            Buffer.from((this._auth.credentials as SMTPConnectionCredentials).user + ' /* secret */').toString('base64')
        );
    }

    /**
     * Handles the response to CRAM-MD5 authentication, if there's no error,
     * the user can be considered logged in. Start waiting for a message to send
     *
     * @param str Message from the server
     * @param callback Callback to run once the authentication sequence completes
     * @internal
     */
    _actionAUTH_CRAM_MD5_PASS(str: string, callback: SMTPConnectionCallback): void {
        if (!str.match(/^235\s+/)) {
            return callback(this._formatError('Invalid login sequence while waiting for "235"', 'EAUTH', str, 'AUTH CRAM-MD5'));
        }

        this.logger.info(
            {
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            },
            'User %s authenticated',
            JSON.stringify(this._auth.user)
        );
        this.authenticated = true;
        callback(null, true);
    }

    /**
     * Handle the response for AUTH LOGIN command. We are expecting
     * '334 UGFzc3dvcmQ6' (base64 for 'Password:'). Data to be sent as
     * response needs to be base64 encoded password.
     *
     * @param str Message from the server
     * @param callback Callback to run once the authentication sequence completes
     * @internal
     */
    _actionAUTH_LOGIN_PASS(str: string, callback: SMTPConnectionCallback): void {
        if (!/^334[ -]/.test(str)) {
            // expecting '334 UGFzc3dvcmQ6'
            return callback(this._formatError('Invalid login sequence while waiting for "334 UGFzc3dvcmQ6"', 'EAUTH', str, 'AUTH LOGIN'));
        }

        this._responseActions.push(str => {
            this._actionAUTHComplete(str, callback);
        });

        this._sendCommand(
            Buffer.from(((this._auth.credentials as SMTPConnectionCredentials).pass || '').toString(), 'utf-8').toString('base64'),
            // Hidden pass for logs
            Buffer.from('/* secret */', 'utf-8').toString('base64')
        );
    }

    /**
     * Handles the response for authentication, if there's no error,
     * the user can be considered logged in. Start waiting for a message to send
     *
     * @param str Message from the server
     * @param isRetry True if this is a retry after a failed login, or the callback itself
     * @param [callback] Callback to run once the authentication sequence completes
     * @internal
     */
    _actionAUTHComplete(str: string, isRetry: boolean | SMTPConnectionCallback, callback?: SMTPConnectionCallback): void {
        if (!callback && typeof isRetry === 'function') {
            callback = isRetry;
            isRetry = false;
        }

        if (str.substr(0, 3) === '334') {
            this._responseActions.push(str => {
                if (isRetry || this._authMethod !== 'XOAUTH2') {
                    this._actionAUTHComplete(str, true, callback);
                } else {
                    // fetch a new OAuth2 access token
                    setImmediate(() => this._handleXOauth2Token(true, callback!));
                }
            });
            this._sendCommand('');
            return;
        }

        if (str.charAt(0) !== '2') {
            this.logger.info(
                {
                    tnx: 'smtp',
                    username: this._auth.user,
                    action: 'authfail',
                    method: this._authMethod
                },
                'User %s failed to authenticate',
                JSON.stringify(this._auth.user)
            );
            return callback!(this._formatError('Invalid login', 'EAUTH', str, 'AUTH ' + this._authMethod));
        }

        this.logger.info(
            {
                tnx: 'smtp',
                username: this._auth.user,
                action: 'authenticated',
                method: this._authMethod
            },
            'User %s authenticated',
            JSON.stringify(this._auth.user)
        );
        this.authenticated = true;
        callback!(null, true);
    }

    /**
     * Handle response for a MAIL FROM: command
     *
     * @param str Message from the server
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _actionMAIL(str: string, callback: SMTPConnectionEnvelopeCallback): void {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        if (Number(str.charAt(0)) !== 2) {
            const message =
                this._usingSmtpUtf8 && /^550 /.test(str) && /[\x80-\uFFFF]/.test(envelope.from as string)
                    ? 'Internationalized mailbox name not allowed'
                    : 'Mail command failed';
            envelope.mailError = this._formatError(message, 'EENVELOPE', str, 'MAIL FROM');
        }

        this._advanceEnvelope(str, callback);
    }

    /**
     * Handle response for a RCPT TO: command
     *
     * @param str Message from the server
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _actionRCPT(str: string, callback: SMTPConnectionEnvelopeCallback): void {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        let err: NodemailerError;
        const curRecipient = this._recipientQueue.shift() as string;
        if (Number(str.charAt(0)) !== 2) {
            // this is a soft error
            const message =
                this._usingSmtpUtf8 && /^553 /.test(str) && /[\x80-\uFFFF]/.test(curRecipient)
                    ? 'Internationalized mailbox name not allowed'
                    : 'Recipient command failed';
            envelope.rejected.push(curRecipient);
            // store error for the failed recipient
            err = this._formatError(message, 'EENVELOPE', str, 'RCPT TO');
            err.recipient = curRecipient;
            envelope.rejectedErrors.push(err);
        } else {
            envelope.accepted.push(curRecipient);
        }

        this._advanceEnvelope(str, callback);
    }

    /**
     * Moves the envelope on after a reply to MAIL FROM or RCPT TO. A pipelined envelope sent every
     * command at once and is decided by the reply to DATA. Otherwise the commands go one at a
     * time: the next recipient, or once every reply is in, DATA or the error that ends the message
     *
     * @param str The reply that was handled
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _advanceEnvelope(str: string, callback: SMTPConnectionEnvelopeCallback): void {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        if (envelope.pipelined) {
            return;
        }

        if (envelope.mailError) {
            return callback(envelope.mailError);
        }

        if (envelope.rcptQueue.length) {
            return this._sendRcpt(envelope.rcptQueue.shift() as string, callback);
        }

        if (this._recipientQueue.length) {
            // replies still to come
            return;
        }

        const err = this._envelopeError(str);
        if (err) {
            return callback(err);
        }
        this._responseActions.push(str => {
            this._actionDATA(str, callback);
        });
        this._sendCommand('DATA');
    }

    /**
     * Decides how the envelope went once every reply to MAIL FROM and RCPT TO is in. Called after
     * the last RCPT TO reply, or with PIPELINING on the reply to the DATA command sent along
     *
     * @param str The reply being handled
     * @returns The error to fail the message with, or null when DATA can go ahead
     * @internal
     */
    _envelopeError(str: string): NodemailerError | null {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        if (envelope.mailError) {
            return envelope.mailError;
        }
        if (envelope.accepted.length) {
            return null;
        }
        // report a temporary rejection when there is one, taking the last reply would mark the
        // whole message as permanently failed although some recipients were only deferred
        const deferred = envelope.rejectedErrors.find(rejectedErr => rejectedErr.responseCode && rejectedErr.responseCode < 500);
        const lastRejected = envelope.rejectedErrors[envelope.rejectedErrors.length - 1];
        const reply = deferred?.response ?? (envelope.pipelined && lastRejected ? lastRejected.response : str);
        // every recipient was rejected
        const err = this._formatError("Can't send mail - all recipients were rejected", 'EENVELOPE', reply as string, 'RCPT TO');
        err.rejected = envelope.rejected;
        err.rejectedErrors = envelope.rejectedErrors;
        return err;
    }

    /**
     * Handle response for a DATA command
     *
     * @param str Message from the server
     * @param callback Callback to run once the envelope is processed
     * @internal
     */
    _actionDATA(str: string, callback: SMTPConnectionEnvelopeCallback): void {
        const envelope = this._envelope as SMTPConnectionEnvelope;

        if (envelope.pipelined) {
            const err = this._envelopeError(str);
            if (err) {
                if (/^3/.test(str)) {
                    // A server must refuse DATA without an accepted recipient, this one took it
                    // anyway. End the empty message, it has nobody to go to, so the session
                    // stays usable
                    this._responseActions.push(() => callback(err));
                    this._sendCommand('.');
                    return;
                }
                return callback(err);
            }
        }

        // response should be 354 but according to this issue https://github.com/eleith/emailjs/issues/24
        // some servers might use 250 instead, so lets check for 2 or 3 as the first digit
        if (!/^[23]/.test(str)) {
            return callback(this._formatError('Data command failed', 'EENVELOPE', str, 'DATA'));
        }

        const response: SMTPConnectionEnvelopeInfo = {
            accepted: envelope.accepted as string[],
            rejected: envelope.rejected as string[]
        };

        if (this._ehloLines && this._ehloLines.length) {
            response.ehlo = this._ehloLines;
        }

        if (envelope.rejectedErrors.length) {
            response.rejectedErrors = envelope.rejectedErrors;
        }

        callback(null, response);
    }

    /**
     * Handle response for a DATA stream when using SMTP
     * We expect a single response that defines if the sending succeeded or failed
     *
     * @param str Message from the server
     * @param callback Callback to run with the final send result
     * @internal
     */
    _actionSMTPStream(str: string, callback: SMTPConnectionResponseCallback): void {
        if (Number(str.charAt(0)) !== 2) {
            return callback(this._formatError('Message failed', 'EMESSAGE', str, 'DATA'));
        }
        return callback(null, str);
    }

    /**
     * Handle response for a DATA stream
     * We expect a separate response for every recipient. All recipients can either
     * succeed or fail separately
     *
     * @param recipient The recipient this response applies to
     * @param final Is this the final recipient?
     * @param str Message from the server
     * @param callback Callback to run with the final send result
     * @internal
     */
    _actionLMTPStream(recipient: string, final: boolean, str: string, callback: SMTPConnectionResponseCallback): void {
        const envelope = this._envelope as SMTPConnectionEnvelope;
        let err: NodemailerError;
        if (Number(str.charAt(0)) !== 2) {
            // Message failed
            err = this._formatError('Message failed for recipient ' + recipient, 'EMESSAGE', str, 'DATA');
            err.recipient = recipient;
            envelope.rejected.push(recipient);
            envelope.rejectedErrors.push(err);
            for (let i = 0, len = envelope.accepted.length; i < len; i++) {
                if (envelope.accepted[i] === recipient) {
                    envelope.accepted.splice(i, 1);
                }
            }
        }
        if (final) {
            return callback(null, str);
        }
    }

    /** @internal */
    _handleXOauth2Token(isRetry: boolean, callback: SMTPConnectionCallback): void {
        (this._auth.oauth2 as XOAuth2).getToken(isRetry, (err, accessToken) => {
            if (err) {
                this.logger.info(
                    {
                        tnx: 'smtp',
                        username: this._auth.user,
                        action: 'authfail',
                        method: this._authMethod
                    },
                    'User %s failed to authenticate',
                    JSON.stringify(this._auth.user)
                );
                return callback(this._formatError(err, 'EAUTH', false, 'AUTH XOAUTH2'));
            }
            this._responseActions.push(str => {
                this._actionAUTHComplete(str, isRetry, callback);
            });
            this._sendCommand(
                'AUTH XOAUTH2 ' + (this._auth.oauth2 as XOAuth2).buildXOAuth2Token(accessToken),
                //  Hidden for logs
                'AUTH XOAUTH2 ' + (this._auth.oauth2 as XOAuth2).buildXOAuth2Token('/* secret */')
            );
        });
    }

    /**
     *
     * @param command
     * @internal
     */
    _isDestroyedMessage(command: string): string | undefined {
        if (this._destroyed) {
            return 'Cannot ' + command + ' - smtp connection is already destroyed.';
        }

        if (this._socket) {
            if (this._socket.destroyed) {
                return 'Cannot ' + command + ' - smtp connection socket is already destroyed.';
            }

            if (!this._socket.writable) {
                return 'Cannot ' + command + ' - smtp connection socket is already half-closed.';
            }
        }
    }

    /** @internal */
    _getHostname(): string {
        // defaul hostname is machine hostname or [IP]
        let defaultHostname: string;
        try {
            defaultHostname = os.hostname() || '';
        } catch (_err) {
            // fails on windows 7
            defaultHostname = 'localhost';
        }

        // ignore if not FQDN
        if (!defaultHostname || defaultHostname.indexOf('.') < 0) {
            defaultHostname = '[127.0.0.1]';
        }

        // IP should be enclosed in []
        if (defaultHostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
            defaultHostname = '[' + defaultHostname + ']';
        }

        return defaultHostname;
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `SMTPConnection.Options` style references keep working
 */
declare namespace SMTPConnection {
    export type Options = SMTPConnectionOptions;
    export type AuthenticationType = SMTPConnectionAuth;
    export type AuthenticationTypeLogin = SMTPConnectionAuth;
    export type AuthenticationTypeOAuth2 = SMTPConnectionAuth;
    export type AuthenticationTypeCustom = SMTPConnectionAuth;
    export type AuthenticationCredentials = SMTPConnectionAuth;
    export type AuthenticationOAuth2 = SMTPConnectionAuth;
    export type Credentials = SMTPConnectionCredentials;
    export type OAuth2 = XOAuth2Options;
    export type Envelope = SMTPEnvelope;
    export type DSNOptions = SMTPEnvelopeDsn;
    export type DSNOption = SMTPEnvelopeDsnNotify;
    export type SentMessageInfo = SMTPConnectionSendInfo;
    export type SMTPError = NodemailerError;
    export type CustomAuthenticationContext = SMTPConnectionCustomAuthContext;
    export type CustomAuthenticationResponse = SMTPConnectionCustomAuthResponse;
    export type CustomAuthenticationHandlers = SMTPConnectionCustomAuthHandlers;
}

/** The same aliases as module level exports, for `import * as SMTPConnection` and `import SMTPConnection = require()` */
export type {
    SMTPConnectionOptions as Options,
    SMTPConnectionAuth as AuthenticationType,
    SMTPConnectionAuth as AuthenticationTypeLogin,
    SMTPConnectionAuth as AuthenticationTypeOAuth2,
    SMTPConnectionAuth as AuthenticationTypeCustom,
    SMTPConnectionAuth as AuthenticationCredentials,
    SMTPConnectionAuth as AuthenticationOAuth2,
    SMTPConnectionCredentials as Credentials,
    XOAuth2Options as OAuth2,
    SMTPEnvelope as Envelope,
    SMTPEnvelopeDsn as DSNOptions,
    SMTPEnvelopeDsnNotify as DSNOption,
    SMTPConnectionSendInfo as SentMessageInfo,
    NodemailerError as SMTPError,
    SMTPConnectionCustomAuthContext as CustomAuthenticationContext,
    SMTPConnectionCustomAuthResponse as CustomAuthenticationResponse,
    SMTPConnectionCustomAuthHandlers as CustomAuthenticationHandlers
};

export default SMTPConnection;
