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

import net from 'node:net';
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
    /** Decoded user name, null when the URL carries no credentials */
    username: string | null;
    /** Decoded password, null when the URL carries none */
    password: string | null;
    query: string | null | Record<string, string | string[]>;
}

// Matches a "scheme:" not followed by "//" (and with something after it), used
// to re-insert the authority separator the legacy parser did not require.
const SLASHLESS_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/\/)([\s\S]+)$/;

// Leading and trailing C0 controls and spaces, which the WHATWG parser strips before it
// looks at the input. Stripped up front so that the slash-less form is recognized in a
// value read from a file with a trailing newline as well.
const SURROUNDING_WHITESPACE = /^[\x00-\x20]+|[\x00-\x20]+$/g;

// Leading characters legacy url.parse() skips before it reads the scheme
const LEGACY_TRIM = /^[\x00-\x20\u00a0\ufeff]+/;

// The authority of a "scheme://authority/..." or a scheme-relative "//authority/..."
// string: the scheme, if any (anything the legacy parser takes for one, it is less strict
// than WHATWG about the first character), and what the legacy parser has to report as the
// host once the userinfo is removed, see legacyParse. The legacy parser treats a backslash
// as a slash.
const AUTHORITY = /^([a-zA-Z0-9+.-]+:)?[\\/]{2}([^\\/?#]*)/;

// The WHATWG forbidden domain code points, except '%' which an opaque host may carry: the
// C0 control characters, space, DEL and the URL delimiters. CONTROL_CHARS is the C0 and DEL
// subset, checked on its own in legacyParse where the host string still carries the port
// and IPv6 brackets.
const FORBIDDEN_HOST_CHARS = /[\x00-\x20#/:<>?@[\\\]^|\x7f]/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

// The error the WHATWG parser throws, for a host that only fails the checks in this module
function invalidUrl(input: string): Error {
    const err = new TypeError('Invalid URL') as Error & { code: string; input: string };
    err.code = 'ERR_INVALID_URL';
    err.input = input;
    return err;
}

// Legacy url.parse() for input the WHATWG parser refused. The legacy parser does not
// reject a host it can not represent: a NUL byte, a percent-encoded byte, a space or a
// '<' inside the host ends the host early and the rest becomes the path, so
// 'localhost%00.example.com' silently turns into a request to 'localhost'. When the
// input has an authority that the legacy parser reads as the host (always for
// "scheme://", for "//host" only when slashesDenoteHost is set, as url.resolve() does
// for its target), the legacy result is accepted only if that host is the whole written
// authority, lowercased and IDNA mapped the way the legacy parser does it, and carries
// no control character. A legacy result with a host (an empty one included, 'http:///x'
// is a request to localhost) that no such authority accounts for is refused as well.
// Otherwise the WHATWG error is reported. Relative input has no authority to check and
// keeps the legacy behavior.
function legacyParse(input: string, parseQueryString: boolean | undefined, whatwgError: unknown, slashesDenoteHost?: boolean): ParsedUrl {
    const parsed = urllib.parse(input, parseQueryString as false, slashesDenoteHost);
    const authority = AUTHORITY.exec(input.replace(LEGACY_TRIM, ''));
    if (authority && (authority[1] || parsed.hostname !== null)) {
        const written = authority[2].slice(authority[2].lastIndexOf('@') + 1);
        if (!written || CONTROL_CHARS.test(written) || (parsed.host || '').toLowerCase() !== punycode.toASCII(written.toLowerCase())) {
            throw whatwgError;
        }
        // the legacy parser takes any bracketed value for an IPv6 literal
        if (written.charAt(0) === '[' && !net.isIPv6(written.slice(1, written.indexOf(']')))) {
            throw whatwgError;
        }
    } else if (parsed.hostname !== null) {
        throw whatwgError;
    }
    // the legacy parser only offers the joined form, split it on the first colon
    const legacyAuth = parsed.auth === null || parsed.auth === undefined ? null : parsed.auth.split(':');
    const result = parsed as unknown as ParsedUrl;
    result.username = legacyAuth ? (legacyAuth.shift() as string) : null;
    result.password = legacyAuth && legacyAuth.length ? legacyAuth.join(':') : null;
    return result;
}

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
// address and the IDNA mapped (lowercased, punycode) form. Idempotent on plain
// ASCII and already-punycode hosts, so special-scheme hosts (already IDNA-mapped
// by WHATWG) pass through.
function normalizeHostname(raw: string, href: string): string {
    const hostname = raw || '';
    if (!hostname) {
        // Host-less URL (e.g. 'direct:'): legacy returned '' here, not null;
        // consumers do `hostname.length` / `'.' + hostname`, so keep it a string.
        return '';
    }
    if (hostname.charAt(0) === '[' && hostname.charAt(hostname.length - 1) === ']') {
        return hostname.slice(1, -1);
    }
    const decoded = safeDecode(hostname);
    // domainToASCII applies the WHATWG host rules (IDNA mapping included) and returns an
    // empty string for a host it refuses, the forbidden characters among them
    const mapped = FORBIDDEN_HOST_CHARS.test(decoded) ? '' : urllib.domainToASCII(decoded);
    if (!mapped) {
        throw invalidUrl(href);
    }
    return mapped;
}

export const parse = (input?: string | null, parseQueryString?: boolean): ParsedUrl => {
    input = (input || '').replace(SURROUNDING_WHITESPACE, '');

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
    } catch (err) {
        // WHATWG rejects some input the legacy parser tolerated (empty/relative
        // strings, scheme-relative '//host/path', out-of-range ports, ...). Fall
        // back to the legacy parser so behavior, including the downstream errors
        // callers rely on, is preserved. This is the only path that can still
        // emit a deprecation warning; it fires for anything WHATWG cannot
        // represent, including legitimate relative URLs, not just malformed input.
        return legacyParse(normalized, parseQueryString, err);
    }

    const hostname = normalizeHostname(u.hostname, u.href);
    const port = u.port || null;
    const pathname = u.pathname || null;
    const search = u.search || null;

    // Legacy `.auth` is the decoded "user[:pass]" string; WHATWG keeps the
    // username/password percent-encoded, so decode to stay byte-compatible with
    // existing consumers (parseConnectionUrl, Basic/Proxy-Authorization headers).
    let auth: string | null = null;
    let username: string | null = null;
    let password: string | null = null;
    if (u.username || u.password) {
        // Gate on password too: legacy url.parse('smtps://:pass@host').auth was
        // ':pass'. Dropping it would silently connect unauthenticated.
        username = safeDecode(u.username);
        password = u.password ? safeDecode(u.password) : null;
        // the joined form is ambiguous once the user name contains a colon, so
        // consumers that need the parts read username and password instead
        auth = username + (password !== null ? ':' + password : '');
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
        username,
        password,
        query
    };
};

export const resolve = (from: string, to: string): string => {
    try {
        return new URL(to, from).href;
    } catch (err) {
        // Malformed target, fall back to the legacy resolver, but only when the legacy
        // parser reads the same host out of both inputs that was written. The target
        // decides the host when it is absolute or scheme-relative, the base otherwise
        legacyParse(from, false, err, true);
        legacyParse(to, false, err, true);
        return urllib.resolve(from, to);
    }
};
