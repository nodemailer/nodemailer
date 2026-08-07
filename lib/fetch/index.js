'use strict';

const http = require('http');
const https = require('https');
const urllib = require('../shared/url');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const Cookies = require('./cookies');
const packageData = require('../../package.json');
const net = require('net');
const errors = require('../errors');
const { isProtoKey } = require('../shared/objects');

const MAX_REDIRECTS = 5;

// Only genuine TLS settings are taken from options.tls. That object reaches us straight
// from a user supplied attachment (content.tls), so keys like host, port, path, socketPath
// or lookup would otherwise repoint the request at a destination that never went through
// the URL checks below.
//
// The source of truth is the tls.connect() option list in the Node docs. A key missing
// here is dropped silently, so extend this list rather than working around it.
const TLS_OPTION_KEYS = [
    'ALPNProtocols',
    'ca',
    'cert',
    'checkServerIdentity',
    'ciphers',
    'crl',
    'dhparam',
    'ecdhCurve',
    'honorCipherOrder',
    'key',
    'maxVersion',
    'minVersion',
    'passphrase',
    'pfx',
    'rejectUnauthorized',
    'secureContext',
    'secureOptions',
    'secureProtocol',
    'servername',
    'sessionIdContext',
    'sigalgs'
];

/**
 * Resolves a URL only if it is one this module is willing to request.
 *
 * urllib.parse throws for a host that contains forbidden bytes, and it is called for
 * every URL that reaches nmfetch, including ones that arrive from a message attachment
 * or from a redirect Location header. An uncaught throw here takes the process down,
 * so a URL that does not parse is reported the same way as one with a scheme we refuse.
 *
 * @param {String} url URL to parse
 * @returns {Object|Boolean} Parsed URL, or false if it is not a usable http(s) URL
 */
function parseFetchUrl(url) {
    let parsed;
    try {
        parsed = urllib.parse(url);
    } catch (_err) {
        return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
    }

    return parsed;
}

module.exports = function (url, options) {
    return nmfetch(url, options);
};

module.exports.Cookies = Cookies;

function nmfetch(url, options) {
    options = options || {};

    options.fetchRes = options.fetchRes || new PassThrough();
    options.cookies = options.cookies || new Cookies();
    options.redirects = options.redirects || 0;
    options.maxRedirects = isNaN(options.maxRedirects) ? MAX_REDIRECTS : options.maxRedirects;

    const fetchRes = options.fetchRes;
    const parsed = parseFetchUrl(url);

    if (!parsed) {
        // Only http(s) URLs can be fetched. Any other scheme (file:, gopher:, a
        // protocol-relative redirect target etc.) would otherwise be silently served over
        // plain HTTP, possibly against an unintended host. Bail out before the cookie jar
        // is touched so a refused URL can not seed it, and release a caller supplied body:
        // this is the one exit that runs before the error handler below is attached to it,
        // so an error on that stream would have nowhere to go and the fd or socket behind
        // it would never be released.
        if (options.body && typeof options.body.destroy === 'function') {
            options.body.on('error', () => false);
            options.body.destroy();
        }
        setImmediate(() => {
            const err = new Error('Unsupported protocol for URL ' + url);
            err.code = errors.EFETCH;
            err.sourceUrl = url;
            fetchRes.emit('error', err);
        });
        return fetchRes;
    }

    if (options.cookie) {
        [].concat(options.cookie || []).forEach(cookie => {
            options.cookies.set(cookie, url);
        });
        options.cookie = false;
    }

    let method = (options.method || '').toString().trim().toUpperCase() || 'GET';
    let finished = false;
    let cookies;
    let body;

    const handler = parsed.protocol === 'https:' ? https : http;

    const headers = {
        'accept-encoding': 'gzip,deflate',
        'user-agent': 'nodemailer/' + packageData.version
    };

    Object.keys(options.headers || {}).forEach(key => {
        // options.headers is the caller's httpHeaders, straight off an attachment
        if (isProtoKey(key.toLowerCase().trim())) {
            return;
        }
        headers[key.toLowerCase().trim()] = options.headers[key];
    });

    if (options.userAgent) {
        headers['user-agent'] = options.userAgent;
    }

    if (parsed.auth) {
        headers.Authorization = 'Basic ' + Buffer.from(parsed.auth).toString('base64');
    }

    if ((cookies = options.cookies.get(url))) {
        headers.cookie = cookies;
    }

    if (options.body) {
        if (options.contentType !== false) {
            headers['Content-Type'] = options.contentType || 'application/x-www-form-urlencoded';
        }

        if (typeof options.body.pipe === 'function') {
            // it's a stream
            headers['Transfer-Encoding'] = 'chunked';
            body = options.body;
            body.on('error', err => {
                if (finished) {
                    return;
                }
                finished = true;
                err.code = errors.EFETCH;
                err.sourceUrl = url;
                fetchRes.emit('error', err);
            });
        } else {
            if (options.body instanceof Buffer) {
                body = options.body;
            } else if (typeof options.body === 'object') {
                try {
                    // encodeURIComponent can fail on invalid input (partial emoji etc.)
                    body = Buffer.from(
                        Object.keys(options.body)
                            .map(key => {
                                const value = options.body[key].toString().trim();
                                return encodeURIComponent(key) + '=' + encodeURIComponent(value);
                            })
                            .join('&')
                    );
                } catch (E) {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    E.code = errors.EFETCH;
                    E.sourceUrl = url;
                    fetchRes.emit('error', E);
                    return;
                }
            } else {
                body = Buffer.from(options.body.toString().trim());
            }

            headers['Content-Type'] = options.contentType || 'application/x-www-form-urlencoded';
            headers['Content-Length'] = body.length;
        }
        // if method is not provided, use POST instead of GET
        method = (options.method || '').toString().trim().toUpperCase() || 'POST';
    }

    let req;
    const reqOptions = {
        method,
        host: parsed.hostname,
        path: parsed.path,
        port: parsed.port ? parsed.port : parsed.protocol === 'https:' ? 443 : 80,
        headers,
        // Validate TLS certificates by default. Callers that genuinely need to
        // reach a self-signed/internal host opt out explicitly with
        // options.tls = { rejectUnauthorized: false }.
        rejectUnauthorized: true,
        agent: false
    };

    if (options.tls) {
        // see TLS_OPTION_KEYS
        Object.keys(options.tls).forEach(key => {
            if (TLS_OPTION_KEYS.includes(key)) {
                reqOptions[key] = options.tls[key];
            }
        });
    }

    if (
        parsed.protocol === 'https:' &&
        parsed.hostname &&
        parsed.hostname !== reqOptions.host &&
        !net.isIP(parsed.hostname) &&
        !reqOptions.servername
    ) {
        reqOptions.servername = parsed.hostname;
    }

    try {
        req = handler.request(reqOptions);
    } catch (E) {
        finished = true;
        setImmediate(() => {
            E.code = errors.EFETCH;
            E.sourceUrl = url;
            fetchRes.emit('error', E);
        });
        return fetchRes;
    }

    if (options.timeout) {
        req.setTimeout(options.timeout, () => {
            if (finished) {
                return;
            }
            finished = true;
            req.abort();
            const err = new Error('Request Timeout');
            err.code = errors.EFETCH;
            err.sourceUrl = url;
            fetchRes.emit('error', err);
        });
    }

    req.on('error', err => {
        if (finished) {
            return;
        }
        finished = true;
        err.code = errors.EFETCH;
        err.sourceUrl = url;
        fetchRes.emit('error', err);
    });

    req.on('response', res => {
        let inflate;

        if (finished) {
            return;
        }

        switch (res.headers['content-encoding']) {
            case 'gzip':
            case 'deflate':
                inflate = zlib.createUnzip();
                break;
        }

        if (res.headers['set-cookie']) {
            [].concat(res.headers['set-cookie'] || []).forEach(cookie => {
                options.cookies.set(cookie, url);
            });
        }

        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            // redirect
            options.redirects++;
            if (options.redirects > options.maxRedirects) {
                finished = true;
                const err = new Error('Maximum redirect count exceeded');
                err.code = errors.EFETCH;
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                req.abort();
                return;
            }
            // redirect does not include POST body
            options.method = 'GET';
            options.body = false;

            let redirectUrl;
            try {
                redirectUrl = urllib.resolve(url, res.headers.location);
            } catch (_err) {
                // the legacy resolver throws on a Location the WHATWG parser also refused,
                // so fall through to the check below with what the server actually sent
                redirectUrl = res.headers.location;
            }
            const redirectParsed = parseFetchUrl(redirectUrl);

            if (!redirectParsed) {
                // Refuse the redirect target here rather than leaving it to the recursive
                // call: that call gets its own `finished` flag and no handle on this
                // request, so this one would stay open and could emit a second error on
                // the shared fetchRes once it times out. Callers listen with req.once().
                finished = true;
                const err = new Error('Unsupported protocol for URL ' + redirectUrl);
                err.code = errors.EFETCH;
                err.sourceUrl = redirectUrl;
                fetchRes.emit('error', err);
                req.abort();
                return;
            }

            // Do not forward credentials when the redirect leaves the original
            // security context: a different host, or a downgrade from https to
            // http (which would otherwise put them on the wire in cleartext).
            // Strip sensitive request headers so an attacker who controls the
            // redirect target cannot harvest them.
            const crossHost = redirectParsed.hostname !== parsed.hostname;
            const downgrade = parsed.protocol === 'https:' && redirectParsed.protocol === 'http:';
            if (options.headers && (crossHost || downgrade)) {
                const sensitive = ['authorization', 'cookie', 'proxy-authorization'];
                Object.keys(options.headers).forEach(key => {
                    if (sensitive.includes(key.toLowerCase())) {
                        delete options.headers[key];
                    }
                });
            }

            return nmfetch(redirectUrl, options);
        }

        fetchRes.statusCode = res.statusCode;
        fetchRes.headers = res.headers;

        if (res.statusCode >= 300 && !options.allowErrorResponse) {
            finished = true;
            const err = new Error('Invalid status code ' + res.statusCode);
            err.code = errors.EFETCH;
            err.sourceUrl = url;
            fetchRes.emit('error', err);
            req.abort();
            return;
        }

        res.on('error', err => {
            if (finished) {
                return;
            }
            finished = true;
            err.code = errors.EFETCH;
            err.sourceUrl = url;
            fetchRes.emit('error', err);
            req.abort();
        });

        if (inflate) {
            res.pipe(inflate).pipe(fetchRes);
            inflate.on('error', err => {
                if (finished) {
                    return;
                }
                finished = true;
                err.code = errors.EFETCH;
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                req.abort();
            });
        } else {
            res.pipe(fetchRes);
        }
    });

    setImmediate(() => {
        if (body) {
            try {
                if (typeof body.pipe === 'function') {
                    return body.pipe(req);
                }
                req.write(body);
            } catch (err) {
                finished = true;
                err.code = errors.EFETCH;
                err.sourceUrl = url;
                fetchRes.emit('error', err);
                return;
            }
        }
        req.end();
    });

    return fetchRes;
}
