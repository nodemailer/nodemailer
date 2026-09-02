/* eslint no-console: 0 */

import * as urllib from './url.js';
import util from 'node:util';
import fs from 'node:fs';
import nmfetch from '../fetch/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import { isProtoKey, copyOwnKeys } from './objects.js';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import type { Readable } from 'node:stream';
import type { OutgoingHttpHeaders } from 'node:http';

// re-exported for the callers that already depend on this module, see ./objects
export { isProtoKey, copyOwnKeys };

/**
 * Options for resolveHostname. The object is also handed to dns.Resolver, so its
 * `timeout` and `tries` settings apply to the lookups
 */
export interface ResolveHostnameOptions {
    /** Hostname or IP address to resolve */
    host?: string;
    /** Server name for TLS, used as the host when no host is set */
    servername?: string;
    /** Count loopback interfaces when checking which address families are usable */
    allowInternalNetworkInterfaces?: boolean;
    /** How long a resolved value stays cached, in milliseconds (default 5 minutes) */
    dnsTtl?: number;
    /** Query timeout in milliseconds, passed to dns.Resolver */
    timeout?: number;
    /** Number of query attempts, passed to dns.Resolver */
    tries?: number;
}

/**
 * Resolved value handed to the resolveHostname callback
 */
export interface ResolvedHostname {
    /** Server name to use for TLS, false when an IP literal was given without one */
    servername?: string | false;
    /** Address to connect to, picked at random from the resolved addresses */
    host?: string | null;
    /** All resolved addresses, for connection fallback support */
    _addresses?: string[];
    /** Whether the value came from the DNS cache */
    cached?: boolean;
    /** The resolver error when a cached value was used because of it */
    error?: Error;
}

/**
 * Resolved addresses as stored in the DNS cache
 */
export interface DnsCacheValue {
    addresses: string[];
    servername: string | false;
}

/**
 * A DNS cache entry
 */
export interface DnsCacheEntry {
    value: DnsCacheValue;
    /** Expiration time as a timestamp, entries without one never expire */
    expires?: number;
}

/**
 * Configuration object parsed from a connection url. Query parameters become
 * top level keys, `tls.*` parameters go into `tls`
 */
export interface ConnectionUrlOptions {
    secure?: boolean;
    direct?: boolean;
    port?: number;
    host?: string;
    /** Well-known service name from the ?service= query parameter */
    service?: string;
    auth?: {
        user: string;
        pass: string;
    };
    tls?: { [key: string]: unknown };
    [key: string]: unknown;
}

/**
 * Structured data attached to a log line. tnx, sid and cid drive the line prefix
 * of the default console logger
 */
export interface LogEntry {
    /** 'server' or 'client' for SMTP transaction lines */
    tnx?: string;
    /** Session id */
    sid?: string;
    /** Connection id */
    cid?: string | number;
    level?: string;
    [key: string]: any;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * A logger supplied by the caller, bunyan style. Any object works, a level it does not
 * implement is routed to one it does, see _logFunc
 */
export interface ExternalLogger {
    trace?(...args: any[]): any;
    debug?(...args: any[]): any;
    info?(...args: any[]): any;
    warn?(...args: any[]): any;
    error?(...args: any[]): any;
    fatal?(...args: any[]): any;
    log?(...args: any[]): any;
    [level: string]: any;
}

/**
 * Options for getLogger
 */
export interface GetLoggerOptions {
    /** A bunyan compatible logger, true for the default console logger, false or unset for no logging */
    logger?: ExternalLogger | boolean;
}

/**
 * The bunyan compatible logger interface returned by getLogger
 */
export interface Logger {
    trace(data?: LogEntry, message?: string, ...args: any[]): void;
    debug(data?: LogEntry, message?: string, ...args: any[]): void;
    info(data?: LogEntry, message?: string, ...args: any[]): void;
    warn(data?: LogEntry, message?: string, ...args: any[]): void;
    error(data?: LogEntry, message?: string, ...args: any[]): void;
    fatal(data?: LogEntry, message?: string, ...args: any[]): void;
}

/**
 * A parsed data URI
 */
export interface ParsedDataURI {
    /** Decoded payload */
    data: Buffer;
    /** 'base64', 'utf8' or 'utf-8' when the URI declared one, null otherwise */
    encoding: string | null;
    contentType: string;
    /** Further `key=value` parameters from the metadata section */
    params: { [key: string]: string };
}

/**
 * Access policy for resolveContent
 */
export interface ResolveContentOptions {
    /** Reject content that points to a file path */
    disableFileAccess?: boolean;
    /** Reject content that points to a URL */
    disableUrlAccess?: boolean;
}

/**
 * An object value resolveContent understands. A plain string or Buffer value is returned as
 * is and a readable stream is read into a Buffer, an object carries the content in `content`
 * or points to it with `path` or `href`
 */
export interface ContentDescriptor {
    /** The content itself, a string, a Buffer or a readable stream */
    content?: string | Buffer | Readable;
    /** Encoding of a string `content`, it is decoded into a Buffer unless it is utf8 or ascii */
    encoding?: string;
    /** File path, http(s) URL or data URI to read the content from */
    path?: string;
    /** URL to fetch the content from */
    href?: string;
    /** Request headers for a URL fetch */
    httpHeaders?: OutgoingHttpHeaders;
    /** TLS settings for a URL fetch, see nmfetch */
    tls?: { [key: string]: any };
}

export type ResolveContentCallback = (err: Error | null, value?: any) => void;

const DNS_TTL = 5 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL = 30 * 1000; // Minimum 30 seconds between cleanups
const MAX_CACHE_SIZE = 1000; // Maximum number of entries in cache

let lastCacheCleanup = 0;
export const _lastCacheCleanup = () => lastCacheCleanup;
export const _resetCacheCleanup = () => {
    lastCacheCleanup = 0;
};

export let networkInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> | undefined;
try {
    networkInterfaces = os.networkInterfaces();
} catch (_err) {
    // fails on some systems
}

const isFamilySupported = (family: number | string, allowInternal?: boolean): boolean => {
    const ifaces = networkInterfaces;
    if (!ifaces) {
        // hope for the best
        return true;
    }

    return Object.keys(ifaces)
        .map(key => ifaces[key] as os.NetworkInterfaceInfo[])
        .reduce((acc, val) => acc.concat(val), [] as os.NetworkInterfaceInfo[])
        .filter(i => !i.internal || allowInternal)
        .some(i => i.family === 'IPv' + family || i.family === family);
};

const resolve = (
    family: number,
    hostname: string,
    options: ResolveHostnameOptions | undefined,
    callback: (err: Error | null, addresses?: string[]) => void
) => {
    options = options || {};

    if (!isFamilySupported(family, options.allowInternalNetworkInterfaces)) {
        return callback(null, []);
    }

    const dnsResolver = dns.Resolver ? new dns.Resolver(options) : dns;
    (dnsResolver as any)['resolve' + family](hostname, (err: NodeJS.ErrnoException | null, addresses: string[]) => {
        if (err) {
            switch (err.code) {
                case dns.NODATA:
                case dns.NOTFOUND:
                case dns.NOTIMP:
                case dns.SERVFAIL:
                case dns.CONNREFUSED:
                case dns.REFUSED:
                case 'EAI_AGAIN':
                    return callback(null, []);
            }
            return callback(err);
        }
        return callback(null, Array.isArray(addresses) ? addresses : ([] as string[]).concat(addresses || []));
    });
};

export const dnsCache = new Map<string, DnsCacheEntry>();

const formatDNSValue = (value: DnsCacheValue | undefined, extra?: Partial<ResolvedHostname>): ResolvedHostname => {
    if (!value) {
        return Object.assign({}, extra || {});
    }

    const addresses = value.addresses || [];

    // Select a random address from available addresses, or null if none
    const host = addresses.length > 0 ? addresses[Math.floor(Math.random() * addresses.length)] : null;

    return Object.assign(
        {
            servername: value.servername,
            host,
            // Include all addresses for connection fallback support
            _addresses: addresses
        },
        extra || {}
    );
};

export const resolveHostname = (
    options: ResolveHostnameOptions | undefined,
    callback: (err: Error | null, result?: ResolvedHostname) => void
): void => {
    options = options || {};

    if (!options.host && options.servername) {
        options.host = options.servername;
    }

    if (!options.host || net.isIP(options.host)) {
        // nothing to do here
        const value: DnsCacheValue = {
            addresses: [options.host as string],
            servername: options.servername || false
        };
        return callback(
            null,
            formatDNSValue(value, {
                cached: false
            })
        );
    }

    const host = options.host;
    let cached: DnsCacheEntry | undefined;
    if (dnsCache.has(options.host)) {
        cached = dnsCache.get(options.host) as DnsCacheEntry;

        // Lazy cleanup with time throttling
        const now = Date.now();
        if (now - lastCacheCleanup > CACHE_CLEANUP_INTERVAL) {
            lastCacheCleanup = now;

            // Clean up expired entries
            for (const [host, entry] of dnsCache.entries()) {
                if (entry.expires && entry.expires < now) {
                    dnsCache.delete(host);
                }
            }

            // If cache is still too large, remove oldest entries
            if (dnsCache.size > MAX_CACHE_SIZE) {
                const toDelete = Math.floor(MAX_CACHE_SIZE * 0.1); // Remove 10% of entries
                const keys = Array.from(dnsCache.keys()).slice(0, toDelete);
                keys.forEach(key => dnsCache.delete(key));
            }
        }

        if (!cached.expires || cached.expires >= now) {
            return callback(
                null,
                formatDNSValue(cached.value, {
                    cached: true
                })
            );
        }
    }

    // Resolve both IPv4 and IPv6 addresses for fallback support
    let ipv4Addresses: string[] = [];
    let ipv6Addresses: string[] = [];
    let ipv4Error: Error | null = null;
    let ipv6Error: Error | null = null;

    resolve(4, options.host, options, (err, addresses) => {
        if (err) {
            ipv4Error = err;
        } else {
            ipv4Addresses = addresses || [];
        }

        resolve(6, host, options, (err, addresses) => {
            if (err) {
                ipv6Error = err;
            } else {
                ipv6Addresses = addresses || [];
            }

            // Combine addresses: IPv4 first, then IPv6
            const allAddresses = ipv4Addresses.concat(ipv6Addresses);

            if (allAddresses.length) {
                const value: DnsCacheValue = {
                    addresses: allAddresses,
                    servername: options.servername || host
                };

                dnsCache.set(host, {
                    value,
                    expires: Date.now() + (options.dnsTtl || DNS_TTL)
                });

                return callback(
                    null,
                    formatDNSValue(value, {
                        cached: false
                    })
                );
            }

            // No addresses from resolve4/resolve6, try dns.lookup as fallback
            if (ipv4Error && ipv6Error) {
                // Both resolvers had errors
                if (cached) {
                    dnsCache.set(host, {
                        value: cached.value,
                        expires: Date.now() + (options.dnsTtl || DNS_TTL)
                    });

                    return callback(
                        null,
                        formatDNSValue(cached.value, {
                            cached: true,
                            error: ipv4Error
                        })
                    );
                }
            }

            try {
                dns.lookup(host, { all: true }, (err, addresses) => {
                    if (err) {
                        if (cached) {
                            dnsCache.set(host, {
                                value: cached.value,
                                expires: Date.now() + (options.dnsTtl || DNS_TTL)
                            });

                            return callback(
                                null,
                                formatDNSValue(cached.value, {
                                    cached: true,
                                    error: err
                                })
                            );
                        }
                        return callback(err);
                    }

                    // Get all supported addresses from dns.lookup
                    const supportedAddresses = addresses
                        ? addresses.filter(addr => isFamilySupported(addr.family)).map(addr => addr.address)
                        : [];

                    if (addresses && addresses.length && !supportedAddresses.length) {
                        // there are addresses but none can be used
                        console.warn(`Failed to resolve IPv${addresses[0].family} addresses with current network`);
                    }

                    if (!supportedAddresses.length && cached) {
                        // nothing was found, fallback to cached value
                        return callback(
                            null,
                            formatDNSValue(cached.value, {
                                cached: true
                            })
                        );
                    }

                    const value: DnsCacheValue = {
                        addresses: supportedAddresses.length ? supportedAddresses : [host],
                        servername: options.servername || host
                    };

                    dnsCache.set(host, {
                        value,
                        expires: Date.now() + (options.dnsTtl || DNS_TTL)
                    });

                    return callback(
                        null,
                        formatDNSValue(value, {
                            cached: false
                        })
                    );
                });
            } catch (lookupErr: any) {
                if (cached) {
                    dnsCache.set(host, {
                        value: cached.value,
                        expires: Date.now() + (options.dnsTtl || DNS_TTL)
                    });

                    return callback(
                        null,
                        formatDNSValue(cached.value, {
                            cached: true,
                            error: lookupErr
                        })
                    );
                }
                return callback(ipv4Error || ipv6Error || lookupErr);
            }
        });
    });
};
/**
 * Parses connection url to a structured configuration object
 *
 * @param str Connection url
 * @return Configuration object
 */
export const parseConnectionUrl = (str?: string | null): ConnectionUrlOptions => {
    str = str || '';
    const options: ConnectionUrlOptions = {};
    const url = urllib.parse(str, true);

    switch (url.protocol) {
        case 'smtp:':
            options.secure = false;
            break;
        case 'smtps:':
            options.secure = true;
            break;
        case 'direct:':
            options.direct = true;
            break;
    }

    if (!isNaN(url.port as any) && Number(url.port)) {
        options.port = Number(url.port);
    }

    if (url.hostname) {
        options.host = url.hostname;
    }

    if (url.auth) {
        const auth = url.auth.split(':');
        options.auth = {
            user: auth.shift() as string,
            pass: auth.join(':')
        };
    }

    Object.keys(url.query || {}).forEach(key => {
        let obj: { [key: string]: unknown } = options;
        let lKey = key;
        let value: string | string[] | number | boolean = (url.query as { [key: string]: string | string[] })[key];

        if (!isNaN(value as any)) {
            value = Number(value);
        }

        switch (value) {
            case 'true':
                value = true;
                break;
            case 'false':
                value = false;
                break;
        }

        // tls is nested object
        if (key.indexOf('tls.') === 0) {
            lKey = key.substr(4);
            if (!options.tls) {
                options.tls = {};
            }
            obj = options.tls;
        } else if (key.indexOf('.') >= 0) {
            // ignore nested properties besides tls
            return;
        }

        // `in` already keeps "__proto__" out, but only as a side effect of it being an
        // Object.prototype member. Say it, so the protection survives a change to the check
        if (!isProtoKey(lKey) && !(lKey in obj)) {
            obj[lKey] = value;
        }
    });

    return options;
};

export const _logFunc = (
    logger: ExternalLogger,
    level: string,
    defaults: LogEntry | undefined,
    data: LogEntry | undefined,
    message?: string,
    ...args: any[]
): void => {
    const entry = Object.assign({}, defaults || {}, data || {});
    delete entry.level;

    let logLevel: string | undefined = level;
    if (typeof logger[logLevel] !== 'function') {
        // Provided logger does not implement this level. Fall back to a
        // lower-severity handler instead of throwing.
        logLevel = ['info', 'debug', 'log', 'trace', 'warn', 'error'].find(name => typeof logger[name] === 'function');
    }

    if (logLevel) {
        logger[logLevel](entry, message, ...args);
    }
};

/**
 * Returns a bunyan-compatible logger interface. Uses either provided logger or
 * creates a default console logger
 *
 * @param [options] Options object that might include 'logger' value
 * @return bunyan compatible logger
 */
export const getLogger = (options?: GetLoggerOptions, defaults?: LogEntry): Logger => {
    options = options || {};

    const response = {} as Logger;
    const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

    if (!options.logger) {
        // use vanity logger
        levels.forEach(level => {
            response[level] = () => false;
        });
        return response;
    }

    const logger = options.logger === true ? createDefaultLogger(levels) : options.logger;

    levels.forEach(level => {
        response[level] = (data, message, ...args) => {
            _logFunc(logger, level, defaults, data, message, ...args);
        };
    });

    return response;
};

/**
 * Wrapper for creating a callback that either resolves or rejects a promise
 * based on input
 *
 * @param resolve Function to run if callback is called
 * @param reject Function to run if callback ends with an error
 */
export const callbackPromise = (resolve: (...args: any[]) => void, reject: (reason?: any) => void) =>
    function (...args: any[]) {
        const err = args.shift();
        if (err) {
            reject(err);
        } else {
            resolve(...args);
        }
    };

export const parseDataURI = (uri: unknown): ParsedDataURI | null => {
    if (typeof uri !== 'string') {
        return null;
    }

    // Early return for non-data URIs to avoid unnecessary processing
    if (!uri.startsWith('data:')) {
        return null;
    }

    // Find the first comma safely - this prevents ReDoS
    const commaPos = uri.indexOf(',');
    if (commaPos === -1) {
        return null;
    }

    const data = uri.substring(commaPos + 1);
    const metaStr = uri.substring('data:'.length, commaPos);

    let encoding: string | undefined;
    const metaEntries = metaStr.split(';');

    if (metaEntries.length > 0) {
        const lastEntry = metaEntries[metaEntries.length - 1].toLowerCase().trim();
        // Only recognize valid encoding types to prevent manipulation
        if (['base64', 'utf8', 'utf-8'].includes(lastEntry) && lastEntry.indexOf('=') === -1) {
            encoding = lastEntry;
            metaEntries.pop();
        }
    }

    const contentType = metaEntries.length > 0 ? metaEntries.shift() : 'application/octet-stream';
    const params: { [key: string]: string } = {};

    for (let i = 0; i < metaEntries.length; i++) {
        const entry = metaEntries[i];
        const sepPos = entry.indexOf('=');
        if (sepPos > 0) {
            // Ensure there's a key before the '='
            const key = entry.substring(0, sepPos).trim();
            const value = entry.substring(sepPos + 1).trim();
            if (key && !isProtoKey(key)) {
                params[key] = value;
            }
        }
    }

    // Decode data based on encoding with proper error handling
    let bufferData: Buffer;
    try {
        if (encoding === 'base64') {
            bufferData = Buffer.from(data, 'base64');
        } else {
            try {
                bufferData = Buffer.from(decodeURIComponent(data));
            } catch (_decodeError) {
                bufferData = Buffer.from(data);
            }
        }
    } catch (_bufferError) {
        bufferData = Buffer.alloc(0);
    }

    return {
        data: bufferData,
        encoding: encoding || null,
        contentType: contentType || 'application/octet-stream',
        params
    };
};

/**
 * Resolves a String or a Buffer value for content value. Useful if the value
 * is a Stream or a file or an URL. If the value is a Stream, overwrites
 * the stream object with the resolved value (you can't stream a value twice).
 *
 * This is useful when you want to create a plugin that needs a content value,
 * for example the `html` or `text` value as a String or a Buffer but not as
 * a file path or an URL.
 *
 * @param data An object or an Array you want to resolve an element for, see ContentDescriptor for the values it understands
 * @param key Property name or an Array index
 * @param [options] Optional access policy: { disableFileAccess, disableUrlAccess }
 * @param callback Callback function with (err, value)
 */
export function resolveContent(data: { [key: string]: any }, key: string | number, callback: ResolveContentCallback): void;
export function resolveContent(
    data: { [key: string]: any },
    key: string | number,
    options: ResolveContentOptions | false | undefined,
    callback: ResolveContentCallback
): void;
export function resolveContent(data: { [key: string]: any }, key: string | number, options?: ResolveContentOptions | false): Promise<any>;
export function resolveContent(
    data: { [key: string]: any },
    key: string | number,
    options: ResolveContentOptions | false | undefined,
    callback: ResolveContentCallback | undefined
): Promise<any> | void;
export function resolveContent(
    data: { [key: string]: any },
    key: string | number,
    options?: ResolveContentOptions | ResolveContentCallback | false,
    callback?: ResolveContentCallback
): Promise<any> | void {
    // options is optional; support the legacy resolveContent(data, key, callback) signature
    if (!callback && typeof options === 'function') {
        callback = options;
        options = false;
    }
    options = options || {};

    let promise: Promise<any> | undefined;

    if (!callback) {
        promise = new Promise((resolve, reject) => {
            callback = callbackPromise(resolve, reject);
        });
    }

    resolveContentValue(data, key, options as ResolveContentOptions, callback as ResolveContentCallback);

    return promise;
}

function resolveContentValue(
    data: { [key: string]: any },
    key: string | number,
    options: ResolveContentOptions,
    callback: ResolveContentCallback
): void {
    let content = (data && data[key] && data[key].content) || data[key];
    const encoding = ((typeof data[key] === 'object' && data[key].encoding) || 'utf8')
        .toString()
        .toLowerCase()
        .replace(/[-_\s]/g, '');

    if (!content) {
        return callback(null, content);
    }

    if (typeof content === 'object') {
        if (typeof content.pipe === 'function') {
            return resolveStream(content, (err, value) => {
                if (err) {
                    return callback(err);
                }
                // we can't stream twice the same content, so we need
                // to replace the stream object with the streaming result
                if (data[key].content) {
                    data[key].content = value;
                } else {
                    data[key] = value;
                }
                callback(null, value);
            });
        } else if (/^data:/i.test(content.path || content.href)) {
            const parsedDataUri = parseDataURI(content.path || content.href);

            return callback(null, parsedDataUri && parsedDataUri.data ? parsedDataUri.data : Buffer.alloc(0));
        } else if (content.href || /^https?:\/\//i.test(content.path)) {
            // An href is always a URL, and so is a path that looks like one. Let nmfetch
            // decide whether it is fetchable, it validates the parsed URL. Testing the raw
            // string here instead would let a file: href fall through to the "return as is"
            // default below and travel on inside the resolved message.
            const url = content.href || content.path;
            if (options.disableUrlAccess) {
                setImmediate(() => {
                    const err: NodemailerError = new Error('Url access rejected for ' + url);
                    err.code = errors.EURLACCESS;
                    callback(err);
                });
                return;
            }
            return resolveStream(nmfetch(url, { headers: content.httpHeaders, tls: content.tls }), callback);
        } else if (content.path) {
            if (options.disableFileAccess) {
                setImmediate(() => {
                    const err: NodemailerError = new Error('File access rejected for ' + content.path);
                    err.code = errors.EFILEACCESS;
                    callback(err);
                });
                return;
            }
            return resolveStream(fs.createReadStream(content.path), callback);
        }
    }

    if (typeof data[key].content === 'string' && !['utf8', 'usascii', 'ascii'].includes(encoding)) {
        content = Buffer.from(data[key].content, encoding as BufferEncoding);
    }

    // default action, return as is
    setImmediate(() => callback(null, content));
}

/**
 * Copies properties from source objects to target objects
 */
export const assign = function (...args: ({ [key: string]: any } | false | null | undefined)[]): { [key: string]: any } {
    const target = args.shift() || {};

    args.forEach(source => {
        Object.keys(source || {}).forEach(key => {
            if (isProtoKey(key)) {
                return;
            }
            if (
                ['tls', 'auth'].includes(key) &&
                (source as { [key: string]: any })[key] &&
                typeof (source as { [key: string]: any })[key] === 'object'
            ) {
                // tls and auth are special keys that need to be enumerated separately
                // other objects are passed as is. Enumerating is a copy of user supplied
                // keys just like the loop above, so it gets the same treatment
                target[key] = copyOwnKeys(target[key] || {}, (source as { [key: string]: any })[key]);
            } else {
                target[key] = (source as { [key: string]: any })[key];
            }
        });
    });
    return target;
};

export const encodeXText = (str: string): string => {
    // ! 0x21
    // + 0x2B
    // = 0x3D
    // ~ 0x7E
    if (!/[^\x21-\x2A\x2C-\x3C\x3E-\x7E]/.test(str)) {
        return str;
    }
    const buf = Buffer.from(str);
    let result = '';
    for (let i = 0, len = buf.length; i < len; i++) {
        const c = buf[i];
        if (c < 0x21 || c > 0x7e || c === 0x2b || c === 0x3d) {
            result += '+' + (c < 0x10 ? '0' : '') + c.toString(16).toUpperCase();
        } else {
            result += String.fromCharCode(c);
        }
    }
    return result;
};

/**
 * Streams a stream value into a Buffer
 *
 * @param stream Readable stream
 * @param callback Callback function with (err, value)
 */
function resolveStream(stream: Readable, callback: (err: Error | null, value?: Buffer) => void): void {
    let responded = false;
    const chunks: Buffer[] = [];
    let chunklen = 0;

    stream.on('error', err => {
        if (responded) {
            return;
        }

        responded = true;
        callback(err);
    });

    stream.on('readable', () => {
        let chunk;
        while ((chunk = stream.read()) !== null) {
            chunks.push(chunk);
            chunklen += chunk.length;
        }
    });

    stream.on('end', () => {
        if (responded) {
            return;
        }
        responded = true;

        let value: Buffer;

        try {
            value = Buffer.concat(chunks, chunklen);
        } catch (E: any) {
            return callback(E);
        }
        callback(null, value);
    });
}

/**
 * Generates a bunyan-like logger that prints to console
 *
 * @returns Bunyan logger instance
 */
function createDefaultLogger(levels: LogLevel[]): ExternalLogger {
    const levelMaxLen = levels.reduce((max, level) => Math.max(max, level.length), 0);
    const levelNames = new Map<string, string>();

    levels.forEach(level => {
        let levelName = level.toUpperCase();
        if (levelName.length < levelMaxLen) {
            levelName += ' '.repeat(levelMaxLen - levelName.length);
        }
        levelNames.set(level, levelName);
    });

    const print = (level: string, entry: LogEntry | undefined, message: any, ...args: any[]) => {
        let prefix = '';
        if (entry) {
            if (entry.tnx === 'server') {
                prefix = 'S: ';
            } else if (entry.tnx === 'client') {
                prefix = 'C: ';
            }

            if (entry.sid) {
                prefix = '[' + entry.sid + '] ' + prefix;
            }

            if (entry.cid) {
                prefix = '[#' + entry.cid + '] ' + prefix;
            }
        }

        message = util.format(message, ...args);
        message.split(/\r?\n/).forEach((line: string) => {
            console.log('[%s] %s %s', new Date().toISOString().substr(0, 19).replace(/T/, ' '), levelNames.get(level), prefix + line);
        });
    };

    const logger: ExternalLogger = {};
    levels.forEach(level => {
        logger[level] = print.bind(null, level);
    });

    return logger;
}
