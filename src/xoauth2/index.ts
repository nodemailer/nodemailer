import { Stream } from 'node:stream';
import nmfetch, { type FetchOptions } from '../fetch/index.js';
import crypto from 'node:crypto';
import * as shared from '../shared/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import type { OutgoingHttpHeaders } from 'node:http';

/**
 * Receives the result of a provisionCallback run: an error, or the new access token and
 * an optional expire time in milliseconds
 */
export type XOAuth2ProvisionResultCallback = (err: Error | null, accessToken?: string, expires?: number) => void;

/**
 * Custom access token provider. `renew` is true when the existing token failed and a new
 * one is needed
 */
export type XOAuth2ProvisionCallback = (user: string, renew: boolean, callback: XOAuth2ProvisionResultCallback) => void;

/**
 * Receives an access token, or the error that prevented generating one
 */
export type XOAuth2TokenCallback = (err: Error | null, accessToken?: string) => void;

/**
 * A private key accepted by crypto.createSign().sign()
 */
export type XOAuth2PrivateKey = crypto.KeyLike | crypto.SignKeyObjectInput | crypto.SignPrivateKeyInput;

/**
 * Client information for token generation
 */
export interface XOAuth2Options {
    /** User e-mail address */
    user?: string;
    /** Client ID value */
    clientId?: string;
    /** Client secret value */
    clientSecret?: string;
    /** Refresh token for an user */
    refreshToken?: string;
    /** Endpoint for token generation, defaults to 'https://accounts.google.com/o/oauth2/token' */
    accessUrl?: string;
    /** An existing valid accessToken */
    accessToken?: string;
    /** Private key for JSW */
    privateKey?: XOAuth2PrivateKey;
    /** Optional Access Token expire time in ms */
    expires?: number;
    /** Optional TTL for Access Token in seconds */
    timeout?: number;
    /** Function to run when a new access token is required */
    provisionCallback?: XOAuth2ProvisionCallback;
    /** Optional TLS options forwarded to the HTTPS token request. Defaults to strict cert validation; supply { rejectUnauthorized: false } only for self-hosted OAuth providers on private CAs. */
    tls?: { [key: string]: any };
    /** Service account client id (the JWT issuer), switches to the JWT bearer flow */
    serviceClient?: string;
    /** Lifetime of the service account JWT in seconds, defaults to 5 minutes, capped at an hour */
    serviceRequestTimeout?: number;
    /** OAuth2 scope for the service account flow, defaults to 'https://mail.google.com/' */
    scope?: string;
    /** Logger component name, defaults to 'OAuth2' */
    component?: string;
    /** Extra headers for the token request */
    customHeaders?: OutgoingHttpHeaders;
    /** Extra form fields for the token request */
    customParams?: { [key: string]: any };
}

/**
 * The object emitted with the 'token' event once a new access token has been generated
 */
export interface XOAuth2Token {
    /** User e-mail address */
    user?: string;
    /** The new access token */
    accessToken: string;
    /** Expire time as a timestamp in milliseconds, 0 when unknown */
    expires: number;
}

/**
 * A getToken request waiting for an in-flight renewal to complete
 */
export interface XOAuth2QueuedRequest {
    renew: boolean;
    callback: XOAuth2TokenCallback;
}

/**
 * XOAUTH2 access_token generator for Gmail.
 * Create client ID for web applications in Google API console to use it.
 * See Offline Access for receiving the needed refreshToken for an user
 * https://developers.google.com/accounts/docs/OAuth2WebServer#offline
 *
 * Usage for generating access tokens with a custom method using provisionCallback:
 * provisionCallback(user, renew, callback)
 *   * user is the username to get the token for
 *   * renew is a boolean that if true indicates that existing token failed and needs to be renewed
 *   * callback is the callback to run with (error, accessToken [, expires])
 *     * accessToken is a string
 *     * expires is an optional expire time in milliseconds
 * If provisionCallback is used, then Nodemailer does not try to attempt generating the token by itself
 *
 * @constructor
 * @param options Client information for token generation
 * @param options.user User e-mail address
 * @param options.clientId Client ID value
 * @param options.clientSecret Client secret value
 * @param options.refreshToken Refresh token for an user
 * @param options.accessUrl Endpoint for token generation, defaults to 'https://accounts.google.com/o/oauth2/token'
 * @param options.accessToken An existing valid accessToken
 * @param options.privateKey Private key for JSW
 * @param options.expires Optional Access Token expire time in ms
 * @param options.timeout Optional TTL for Access Token in seconds
 * @param options.provisionCallback Function to run when a new access token is required
 * @param options.tls Optional TLS options forwarded to the HTTPS token request. Defaults to strict cert validation; supply { rejectUnauthorized: false } only for self-hosted OAuth providers on private CAs.
 */
class XOAuth2 extends Stream {
    options: XOAuth2Options;
    logger!: shared.Logger;
    provisionCallback!: XOAuth2ProvisionCallback | false;
    accessToken!: string | false;
    expires!: number;
    renewing!: boolean;
    renewalQueue!: XOAuth2QueuedRequest[];

    constructor(options?: XOAuth2Options, logger?: shared.ExternalLogger | boolean) {
        super();

        this.options = options || {};

        if (options && options.serviceClient) {
            if (!options.privateKey || !options.user) {
                const err: NodemailerError = new Error('Options "privateKey" and "user" are required for service account!');
                err.code = errors.EOAUTH2;
                setImmediate(() => this.emit('error', err));
                return;
            }

            const serviceRequestTimeout = Math.min(Math.max(Number(this.options.serviceRequestTimeout) || 0, 0), 3600);
            this.options.serviceRequestTimeout = serviceRequestTimeout || 5 * 60;
        }

        this.logger = shared.getLogger(
            {
                logger
            },
            {
                component: this.options.component || 'OAuth2'
            }
        );

        this.provisionCallback = typeof this.options.provisionCallback === 'function' ? this.options.provisionCallback : false;

        this.options.accessUrl = this.options.accessUrl || 'https://accounts.google.com/o/oauth2/token';
        this.options.customHeaders = this.options.customHeaders || {};
        this.options.customParams = this.options.customParams || {};

        this.accessToken = this.options.accessToken || false;

        if (this.options.expires && Number(this.options.expires)) {
            this.expires = this.options.expires;
        } else {
            const timeout = Math.max(Number(this.options.timeout) || 0, 0);
            this.expires = (timeout && Date.now() + timeout * 1000) || 0;
        }

        this.renewing = false; // Track if renewal is in progress
        this.renewalQueue = []; // Queue for pending requests during renewal
    }

    /**
     * Returns or generates (if previous has expired) a XOAuth2 token
     *
     * @param renew If false then use cached access token (if available)
     * @param callback Callback function with error object and token string
     */
    getToken(renew: boolean, callback: XOAuth2TokenCallback): void {
        if (!renew && this.accessToken && (!this.expires || this.expires > Date.now())) {
            this.logger.debug(
                {
                    tnx: 'OAUTH2',
                    user: this.options.user,
                    action: 'reuse'
                },
                'Reusing existing access token for %s',
                this.options.user
            );
            return callback(null, this.accessToken);
        }

        // check if it is possible to renew, if not, return the current token or error
        if (!this.provisionCallback && !this.options.refreshToken && !this.options.serviceClient) {
            if (this.accessToken) {
                this.logger.debug(
                    {
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'reuse'
                    },
                    'Reusing existing access token (no refresh capability) for %s',
                    this.options.user
                );
                return callback(null, this.accessToken);
            }
            this.logger.error(
                {
                    tnx: 'OAUTH2',
                    user: this.options.user,
                    action: 'renew'
                },
                'Cannot renew access token for %s: No refresh mechanism available',
                this.options.user
            );
            const err: NodemailerError = new Error("Can't create new access token for user");
            err.code = errors.EOAUTH2;
            return callback(err);
        }

        // If renewal already in progress, queue this request instead of starting another
        if (this.renewing) {
            this.renewalQueue.push({ renew, callback });
            return;
        }

        this.renewing = true;

        // Handles token renewal completion - processes queued requests and cleans up
        const generateCallback = (err: Error | null, accessToken?: string) => {
            this.renewalQueue.forEach(item => item.callback(err, accessToken));
            this.renewalQueue = [];
            this.renewing = false;

            if (err) {
                this.logger.error(
                    {
                        err,
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'renew'
                    },
                    'Failed generating new Access Token for %s',
                    this.options.user
                );
            } else {
                this.logger.info(
                    {
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'renew'
                    },
                    'Generated new Access Token for %s',
                    this.options.user
                );
            }
            // Complete original request
            callback(err, accessToken);
        };

        if (this.provisionCallback) {
            this.provisionCallback(this.options.user as string, !!renew, (err, accessToken, expires) => {
                if (!err && accessToken) {
                    this.accessToken = accessToken;
                    this.expires = expires || 0;
                }
                generateCallback(err, accessToken);
            });
        } else {
            this.generateToken(generateCallback);
        }
    }

    /**
     * Updates token values
     *
     * @param accessToken New access token
     * @param timeout Access token lifetime in seconds
     *
     * Emits 'token': { user: User email-address, accessToken: the new accessToken, timeout: TTL in seconds}
     */
    updateToken(accessToken: string, timeout?: number | string): void {
        this.accessToken = accessToken;
        timeout = Math.max(Number(timeout) || 0, 0);
        this.expires = (timeout && Date.now() + timeout * 1000) || 0;

        this.emit('token', {
            user: this.options.user,
            accessToken: accessToken || '',
            expires: this.expires
        } as XOAuth2Token);
    }

    /**
     * Generates a new XOAuth2 token with the credentials provided at initialization
     *
     * @param callback Callback function with error object and token string
     */
    generateToken(callback: XOAuth2TokenCallback): void {
        let urlOptions: { [key: string]: any };
        let loggedUrlOptions: { [key: string]: any };
        if (this.options.serviceClient) {
            // service account - https://developers.google.com/identity/protocols/OAuth2ServiceAccount
            const iat = Math.floor(Date.now() / 1000); // unix time
            const tokenData = {
                iss: this.options.serviceClient,
                scope: this.options.scope || 'https://mail.google.com/',
                sub: this.options.user,
                aud: this.options.accessUrl,
                iat,
                exp: iat + (this.options.serviceRequestTimeout as number)
            };
            let token: string;
            try {
                token = this.jwtSignRS256(tokenData);
            } catch (_err) {
                const err: NodemailerError = new Error("Can't generate token. Check your auth options");
                err.code = errors.EOAUTH2;
                return callback(err);
            }

            urlOptions = {
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: token
            };

            loggedUrlOptions = {
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: tokenData
            };
        } else {
            if (!this.options.refreshToken) {
                const err: NodemailerError = new Error("Can't create new access token for user");
                err.code = errors.EOAUTH2;
                return callback(err);
            }

            // web app - https://developers.google.com/identity/protocols/OAuth2WebServer
            urlOptions = {
                client_id: this.options.clientId || '',
                client_secret: this.options.clientSecret || '',
                refresh_token: this.options.refreshToken,
                grant_type: 'refresh_token'
            };

            loggedUrlOptions = {
                client_id: this.options.clientId || '',
                client_secret: (this.options.clientSecret || '').substr(0, 6) + '...',
                refresh_token: (this.options.refreshToken || '').substr(0, 6) + '...',
                grant_type: 'refresh_token'
            };
        }

        Object.assign(urlOptions, this.options.customParams);
        Object.assign(loggedUrlOptions, this.options.customParams);

        this.logger.debug(
            {
                tnx: 'OAUTH2',
                user: this.options.user,
                action: 'generate'
            },
            'Requesting token using: %s',
            JSON.stringify(loggedUrlOptions)
        );

        this.postRequest(this.options.accessUrl as string, urlOptions, this.options, (error, body) => {
            let data: any;

            if (error) {
                return callback(error);
            }

            try {
                data = JSON.parse((body as Buffer).toString());
            } catch (E: any) {
                return callback(E);
            }

            if (!data || typeof data !== 'object') {
                this.logger.debug(
                    {
                        tnx: 'OAUTH2',
                        user: this.options.user,
                        action: 'post'
                    },
                    'Response: %s',
                    (body || '').toString()
                );
                const err: NodemailerError = new Error('Invalid authentication response');
                err.code = errors.EOAUTH2;
                return callback(err);
            }

            const logData = Object.assign({}, data);
            if (logData.access_token) {
                logData.access_token = (logData.access_token || '').toString().substr(0, 6) + '...';
            }

            this.logger.debug(
                {
                    tnx: 'OAUTH2',
                    user: this.options.user,
                    action: 'post'
                },
                'Response: %s',
                JSON.stringify(logData)
            );

            if (data.error) {
                // Error Response : https://tools.ietf.org/html/rfc6749#section-5.2
                let errorMessage = data.error;
                if (data.error_description) {
                    errorMessage += ': ' + data.error_description;
                }
                if (data.error_uri) {
                    errorMessage += ' (' + data.error_uri + ')';
                }
                const err: NodemailerError = new Error(errorMessage);
                err.code = errors.EOAUTH2;
                return callback(err);
            }

            if (data.access_token) {
                this.updateToken(data.access_token, data.expires_in);
                return callback(null, this.accessToken as string);
            }

            const err: NodemailerError = new Error('No access token');
            err.code = errors.EOAUTH2;
            return callback(err);
        });
    }

    /**
     * Converts an access_token and user id into a base64 encoded XOAuth2 token
     *
     * @param [accessToken] Access token string
     * @return Base64 encoded token for IMAP or SMTP login
     */
    buildXOAuth2Token(accessToken?: string): string {
        const authData = ['user=' + (this.options.user || ''), 'auth=Bearer ' + (accessToken || this.accessToken), '', ''];
        return Buffer.from(authData.join('\x01'), 'utf-8').toString('base64');
    }

    /**
     * Custom POST request handler.
     * This is only needed to keep paths short in Windows, usually this module
     * is a dependency of a dependency and if it tries to require something
     * like the request module the paths get way too long to handle for Windows.
     * As we do only a simple POST request we do not actually require complicated
     * logic support (no redirects, no nothing) anyway.
     *
     * @param url Url to POST to
     * @param payload Payload to POST
     * @param params Client options, the customHeaders and tls values are used for the request
     * @param callback Callback function with (err, buff)
     */
    postRequest(
        url: string,
        payload: { [key: string]: any } | string | Buffer,
        params: XOAuth2Options,
        callback: (err: Error | null, buff?: Buffer) => void
    ): void {
        let returned = false;

        const chunks: Buffer[] = [];
        let chunklen = 0;

        const fetchOptions: FetchOptions = {
            method: 'post',
            headers: params.customHeaders,
            body: payload,
            allowErrorResponse: true
        };

        // OAuth2 token endpoints are credential-bearing. src/fetch already
        // validates certs by default; pin rejectUnauthorized:true here so the
        // token fetch stays strict, while still layering params.tls (the
        // user's options.tls) on top so callers with a self-hosted provider on
        // a private CA can override.
        if (/^https:/i.test(url)) {
            fetchOptions.tls = Object.assign({ rejectUnauthorized: true }, params.tls || {});
        }

        const req = nmfetch(url, fetchOptions);

        req.on('readable', () => {
            let chunk: Buffer;
            while ((chunk = req.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });

        req.once('error', err => {
            if (returned) {
                return;
            }
            returned = true;
            return callback(err);
        });

        req.once('end', () => {
            if (returned) {
                return;
            }
            returned = true;
            return callback(null, Buffer.concat(chunks, chunklen));
        });
    }

    /**
     * Encodes a buffer or a string into Base64url format
     *
     * @param data The data to convert
     * @return The encoded string
     */
    toBase64URL(data: Buffer | string): string {
        if (typeof data === 'string') {
            data = Buffer.from(data);
        }

        return data
            .toString('base64')
            .replace(/[=]+/g, '') // remove '='s
            .replace(/\+/g, '-') // '+' → '-'
            .replace(/\//g, '_'); // '/' → '_'
    }

    /**
     * Creates a JSON Web Token signed with RS256 (SHA256 + RSA)
     *
     * @param payload The payload to include in the generated token
     * @return The generated and signed token
     */
    jwtSignRS256(payload: { [key: string]: any }): string {
        const signedPayload = ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(payload)].map(val => this.toBase64URL(val)).join('.');
        const signature = crypto
            .createSign('RSA-SHA256')
            .update(signedPayload)
            .sign(this.options.privateKey as XOAuth2PrivateKey);
        return signedPayload + '.' + this.toBase64URL(signature);
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `XOAuth2.Options` style references keep working
 */
declare namespace XOAuth2 {
    export type Options = XOAuth2Options;
    export type Token = XOAuth2Token;
}

export default XOAuth2;
