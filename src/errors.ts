/**
 * Nodemailer Error Codes
 *
 * Centralized error code definitions for consistent error handling.
 *
 * Usage:
 *   import * as errors from './errors.js';
 *   const err: NodemailerError = new Error('Connection closed');
 *   err.code = errors.ECONNECTION;
 */

/**
 * Error code descriptions for documentation and debugging
 */
export const ERROR_CODES = {
    // Connection errors
    ECONNECTION: 'Connection closed unexpectedly',
    ETIMEDOUT: 'Connection or operation timed out',
    ESOCKET: 'Socket-level error',
    EDNS: 'DNS resolution failed',

    // TLS/Security errors
    ETLS: 'TLS handshake or STARTTLS failed',
    EREQUIRETLS: 'REQUIRETLS not supported by server (RFC 8689)',

    // Protocol errors
    EPROTOCOL: 'Invalid SMTP server response',
    EENVELOPE: 'Invalid mail envelope (sender or recipients)',
    EMESSAGE: 'Message delivery error',
    ESTREAM: 'Stream processing error',

    // Authentication errors
    EAUTH: 'Authentication failed',
    ENOAUTH: 'Authentication credentials not provided',
    EOAUTH2: 'OAuth2 token generation or refresh error',

    // Resource errors
    EMAXLIMIT: 'Pool resource limit reached (max messages per connection)',
    EMAXRECIPIENTS: 'Recipient count exceeds maxRecipients',

    // Transport-specific errors
    ESENDMAIL: 'Sendmail command error',
    ESES: 'AWS SES transport error',

    // Configuration and access errors
    ECONFIG: 'Invalid configuration',
    EPROXY: 'Proxy connection error',
    EFILEACCESS: 'File access rejected (disableFileAccess is set)',
    EURLACCESS: 'URL access rejected (disableUrlAccess is set)',
    EFETCH: 'HTTP fetch error'
} as const;

/**
 * Union of all known Nodemailer error codes
 */
export type ErrorCode = keyof typeof ERROR_CODES;

// Error codes as string constants
export const ECONNECTION = 'ECONNECTION' satisfies ErrorCode;
export const ETIMEDOUT = 'ETIMEDOUT' satisfies ErrorCode;
export const ESOCKET = 'ESOCKET' satisfies ErrorCode;
export const EDNS = 'EDNS' satisfies ErrorCode;
export const ETLS = 'ETLS' satisfies ErrorCode;
export const EREQUIRETLS = 'EREQUIRETLS' satisfies ErrorCode;
export const EPROTOCOL = 'EPROTOCOL' satisfies ErrorCode;
export const EENVELOPE = 'EENVELOPE' satisfies ErrorCode;
export const EMESSAGE = 'EMESSAGE' satisfies ErrorCode;
export const ESTREAM = 'ESTREAM' satisfies ErrorCode;
export const EAUTH = 'EAUTH' satisfies ErrorCode;
export const ENOAUTH = 'ENOAUTH' satisfies ErrorCode;
export const EOAUTH2 = 'EOAUTH2' satisfies ErrorCode;
export const EMAXLIMIT = 'EMAXLIMIT' satisfies ErrorCode;
export const EMAXRECIPIENTS = 'EMAXRECIPIENTS' satisfies ErrorCode;
export const ESENDMAIL = 'ESENDMAIL' satisfies ErrorCode;
export const ESES = 'ESES' satisfies ErrorCode;
export const ECONFIG = 'ECONFIG' satisfies ErrorCode;
export const EPROXY = 'EPROXY' satisfies ErrorCode;
export const EFILEACCESS = 'EFILEACCESS' satisfies ErrorCode;
export const EURLACCESS = 'EURLACCESS' satisfies ErrorCode;
export const EFETCH = 'EFETCH' satisfies ErrorCode;

/**
 * An Error together with the properties Nodemailer attaches to the errors it
 * hands to callers. Every property is optional, the set that is present
 * depends on where the error originated.
 */
export interface NodemailerError extends Error {
    /** Nodemailer error code, see ERROR_CODES */
    code?: string;
    /** SMTP command that was in flight when the server replied with an error */
    command?: string;
    /** Raw SMTP server response */
    response?: string;
    /** Numeric SMTP response code */
    responseCode?: number;
    /** URL of the resource that could not be fetched */
    sourceUrl?: string;
    /** Recipient address the error applies to */
    recipient?: string;
    /** Recipient addresses rejected by the server */
    rejected?: string[];
    /** Per-recipient errors for the rejected addresses */
    rejectedErrors?: NodemailerError[];
}

/**
 * Node style callback: called with an error, or with null and the result
 */
export type Callback<T> = (err: NodemailerError | null, result: T) => void;

/**
 * Callback as the library calls it on its error paths: with an error alone, or with null and
 * the result. The public signatures use Callback, internally the error paths cast to this
 */
export type ResultCallback<T> = (err: NodemailerError | null, result?: T) => void;
