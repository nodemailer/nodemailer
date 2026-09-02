// URL parsing wrapper around the WHATWG `URL` class. It only falls back to the
// legacy, deprecation-warning-emitting `url.parse()` / `url.resolve()` for input
// the WHATWG parser rejects.
//
// The WHATWG `URL` exposes a different shape than the legacy parser, so results
// are normalized back into the legacy field names the rest of the codebase reads
// (`protocol`, `hostname`, `port`, `pathname`, `path`, `search`, `auth`, `query`,
// `href`). This keeps every existing call site unchanged.
//
// Known, accepted divergences from the legacy parser:
//  - non-special schemes (smtp:/smtps:/direct:) are not host-lowercased by
//    WHATWG; cosmetic only, SMTP/DNS hosts are case-insensitive. (IDNA mapping
//    and IPv6 brackets are normalized back by normalizeHostname below.)
//  - a literal unescaped ':' inside a password is percent-encoded by WHATWG;
//    such passwords should be percent-encoded by the caller anyway.

import urllib from 'node:url';
import * as punycode from '../punycode/index.js';

/**
 * Parsed URL in the shape of the legacy `url.parse()` result
 */
export interface ParsedUrl {
    protocol: string | null;
    host: string | null;
    hostname: string | null;
    port: string | null;
    pathname: string | null;
    search: string | null;
    path: string | null;
    href: string;
    auth: string | null;
    query: string | null | Record<string, string | string[]>;
}

// Matches a "scheme:" not followed by "//" (and with something after it), used
// to re-insert the authority separator the legacy parser did not require.
const SLASHLESS_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/\/)(.+)$/;

// decodeURIComponent that never throws. Legacy url.parse() decodes the auth
// component but tolerates malformed percent sequences, so mirror that.
function safeDecode(str: string): string {
    try {
        return decodeURIComponent(str);
    } catch (_err) {
        return str;
    }
}

// Derives the legacy-shaped bare hostname from a WHATWG URL. WHATWG keeps IPv6
// literals bracketed ('[::1]') and, for non-special schemes (smtp:/smtps:/socks:),
// percent-encodes a non-ASCII host instead of IDNA-mapping it. Both forms are
// un-resolvable when handed to net/dns/http.request, which is what every call
// site does, so map them back to what legacy url.parse() returned: the bare
// address and the punycode form. Idempotent on plain ASCII and already-punycode
// hosts, so special-scheme hosts (already IDNA-mapped by WHATWG) pass through.
function normalizeHostname(raw: string): string {
    const hostname = raw || '';
    if (!hostname) {
        // Host-less URL (e.g. 'direct:'): legacy returned '' here, not null;
        // consumers do `hostname.length` / `'.' + hostname`, so keep it a string.
        return '';
    }
    if (hostname.charAt(0) === '[' && hostname.charAt(hostname.length - 1) === ']') {
        return hostname.slice(1, -1);
    }
    return punycode.toASCII(safeDecode(hostname));
}

export const parse = (input?: string | null, parseQueryString?: boolean): ParsedUrl => {
    input = input || '';

    // Legacy url.parse() parses a "user:pass@host:port" authority that follows
    // the scheme even without the "//" separator, for schemes outside its
    // built-in slashed-protocol list (smtp:/smtps:/socks:/...). The WHATWG
    // parser instead treats a scheme not followed by "//" as an opaque path.
    // Re-insert the "//" so slash-less connection/proxy URLs keep resolving to
    // an authority, as they did before. This assumes a slash-authority scheme,
    // which every consumer here uses (http/https/smtp/smtps/socks/direct); an
    // opaque scheme like mailto:/data:/tel: would be mis-split, but none reach
    // this module.
    const slashless = SLASHLESS_AUTHORITY.exec(input);
    const normalized = slashless ? slashless[1] + '//' + slashless[2] : input;

    let u: URL;
    try {
        u = new URL(normalized);
    } catch (_err) {
        // WHATWG rejects some input the legacy parser tolerated (empty/relative
        // strings, scheme-relative '//host/path', out-of-range ports, ...). Fall
        // back to the legacy parser so behavior, including the downstream errors
        // callers rely on, is preserved. This is the only path that can still
        // emit a deprecation warning; it fires for anything WHATWG cannot
        // represent, including legitimate relative URLs, not just malformed input.
        return urllib.parse(input, parseQueryString as false);
    }

    const hostname = normalizeHostname(u.hostname);
    const port = u.port || null;
    const pathname = u.pathname || null;
    const search = u.search || null;

    // Legacy `.auth` is the decoded "user[:pass]" string; WHATWG keeps the
    // username/password percent-encoded, so decode to stay byte-compatible with
    // existing consumers (parseConnectionUrl, Basic/Proxy-Authorization headers).
    let auth: string | null = null;
    if (u.username || u.password) {
        // Gate on password too: legacy url.parse('smtps://:pass@host').auth was
        // ':pass'. Dropping it would silently connect unauthenticated.
        auth = safeDecode(u.username) + (u.password ? ':' + safeDecode(u.password) : '');
    }

    let query: ParsedUrl['query'];
    if (parseQueryString) {
        // Mirror querystring.parse(): null-prototype object, repeated keys become an array.
        const parsed: Record<string, string | string[]> = Object.create(null);
        u.searchParams.forEach((value, key) => {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                const existing = parsed[key];
                if (Array.isArray(existing)) {
                    existing.push(value);
                } else {
                    parsed[key] = [existing, value];
                }
            } else {
                parsed[key] = value;
            }
        });
        query = parsed;
    } else {
        query = search ? search.slice(1) : null;
    }

    return {
        protocol: u.protocol || null,
        host: u.host || null,
        hostname,
        port,
        pathname,
        search,
        path: (pathname || '') + (search || '') || null,
        href: u.href,
        auth,
        query
    };
};

export const resolve = (from: string, to: string): string => {
    try {
        return new URL(to, from).href;
    } catch (_err) {
        // Malformed target, fall back to the legacy resolver.
        return urllib.resolve(from, to);
    }
};
