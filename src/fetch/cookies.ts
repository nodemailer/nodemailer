// module to handle cookies

import * as urllib from '../shared/url.js';

const SESSION_TIMEOUT = 1800; // 30 min

/**
 * Options for the Cookies jar
 */
export interface CookiesOptions {
    /** Lifetime in seconds for cookies that do not set their own expiration (default 1800) */
    sessionTimeout?: number | string;
}

/**
 * A cookie as parsed from a 'Set-Cookie:' header and kept in the jar
 */
export interface Cookie {
    name?: string;
    value?: string;
    domain?: string;
    path?: string;
    expires?: Date;
    secure?: boolean;
    httponly?: boolean;
}

/**
 * Creates a biskviit cookie jar for managing cookie values in memory
 *
 * @constructor
 * @param [options] Optional options object
 */
export default class Cookies {
    options: CookiesOptions;
    cookies: Cookie[];

    constructor(options?: CookiesOptions) {
        this.options = options || {};
        this.cookies = [];
    }

    /**
     * Stores a cookie string to the cookie storage
     *
     * @param cookieStr Value from the 'Set-Cookie:' header
     * @param url Current URL
     */
    set(cookieStr: string, url?: string): boolean {
        const urlparts = urllib.parse(url || '');
        const cookie = this.parse(cookieStr);
        let domain: string;

        if (cookie.domain) {
            domain = cookie.domain.replace(/^\./, '');

            // do not allow cross origin cookies
            if (
                // can't be valid if the requested domain is shorter than current hostname
                (urlparts.hostname as string).length < domain.length ||
                // prefix domains with dot to be sure that partial matches are not used
                ('.' + urlparts.hostname).substr(-domain.length + 1) !== '.' + domain
            ) {
                cookie.domain = urlparts.hostname as string;
            }
        } else {
            cookie.domain = urlparts.hostname as string;
        }

        if (!cookie.path) {
            cookie.path = this.getPath(urlparts.pathname);
        }

        // if no expire date, then use sessionTimeout value
        if (!cookie.expires) {
            cookie.expires = new Date(Date.now() + (Number(this.options.sessionTimeout || SESSION_TIMEOUT) || SESSION_TIMEOUT) * 1000);
        }

        return this.add(cookie);
    }

    /**
     * Returns cookie string for the 'Cookie:' header.
     *
     * @param url URL to check for
     * @returns Cookie header or empty string if no matches were found
     */
    get(url?: string): string {
        return this.list(url)
            .map(cookie => cookie.name + '=' + cookie.value)
            .join('; ');
    }

    /**
     * Lists all valied cookie objects for the specified URL
     *
     * @param url URL to check for
     * @returns An array of cookie objects
     */
    list(url?: string): Cookie[] {
        const result: Cookie[] = [];

        for (let i = this.cookies.length - 1; i >= 0; i--) {
            const cookie = this.cookies[i];

            if (this.isExpired(cookie)) {
                this.cookies.splice(i, 1);
                continue;
            }

            if (this.match(cookie, url)) {
                result.unshift(cookie);
            }
        }

        return result;
    }

    /**
     * Parses cookie string from the 'Set-Cookie:' header
     *
     * @param cookieStr String from the 'Set-Cookie:' header
     * @returns Cookie object
     */
    parse(cookieStr?: string): Cookie {
        const cookie: Cookie = {};

        (cookieStr || '')
            .toString()
            .split(';')
            .forEach(cookiePart => {
                const valueParts = cookiePart.split('=');
                const key = (valueParts.shift() as string).trim().toLowerCase();
                let value = valueParts.join('=').trim();
                let domain: string;

                if (!key) {
                    // skip empty parts
                    return;
                }

                switch (key) {
                    case 'expires': {
                        const expires = new Date(value);
                        // ignore date if can not parse it
                        if (expires.toString() !== 'Invalid Date') {
                            cookie.expires = expires;
                        }
                        break;
                    }

                    case 'path':
                        cookie.path = value;
                        break;

                    case 'domain':
                        domain = value.toLowerCase();
                        if (domain.length && domain.charAt(0) !== '.') {
                            domain = '.' + domain; // ensure preceeding dot for user set domains
                        }
                        cookie.domain = domain;
                        break;

                    case 'max-age':
                        cookie.expires = new Date(Date.now() + (Number(value) || 0) * 1000);
                        break;

                    case 'secure':
                        cookie.secure = true;
                        break;

                    case 'httponly':
                        cookie.httponly = true;
                        break;

                    default:
                        if (!cookie.name) {
                            cookie.name = key;
                            cookie.value = value;
                        }
                }
            });

        return cookie;
    }

    /**
     * Checks if a cookie object is valid for a specified URL
     *
     * @param cookie Cookie object
     * @param url URL to check for
     * @returns true if cookie is valid for specifiec URL
     */
    match(cookie: Cookie, url?: string): boolean {
        const urlparts = urllib.parse(url || '');

        // check if hostname matches
        // .foo.com also matches subdomains, foo.com does not
        if (
            urlparts.hostname !== cookie.domain &&
            ((cookie.domain as string).charAt(0) !== '.' ||
                ('.' + urlparts.hostname).substr(-(cookie.domain as string).length) !== cookie.domain)
        ) {
            return false;
        }

        // check if path matches
        const path = this.getPath(urlparts.pathname);
        if (path.substr(0, (cookie.path as string).length) !== cookie.path) {
            return false;
        }

        // check secure argument
        if (cookie.secure && urlparts.protocol !== 'https:') {
            return false;
        }

        return true;
    }

    /**
     * Adds (or updates/removes if needed) a cookie object to the cookie storage
     *
     * @param cookie Cookie value to be stored
     */
    add(cookie: Cookie): boolean {
        // nothing to do here
        if (!cookie || !cookie.name) {
            return false;
        }

        // overwrite if has same params
        for (let i = 0, len = this.cookies.length; i < len; i++) {
            if (this.compare(this.cookies[i], cookie)) {
                // check if the cookie needs to be removed instead
                if (this.isExpired(cookie)) {
                    this.cookies.splice(i, 1); // remove expired/unset cookie
                    return false;
                }

                this.cookies[i] = cookie;
                return true;
            }
        }

        // add as new if not already expired
        if (!this.isExpired(cookie)) {
            this.cookies.push(cookie);
        }

        return true;
    }

    /**
     * Checks if two cookie objects are the same
     *
     * @param a Cookie to check against
     * @param b Cookie to check against
     * @returns True, if the cookies are the same
     */
    compare(a: Cookie, b: Cookie): boolean {
        return a.name === b.name && a.path === b.path && a.domain === b.domain && a.secure === b.secure && a.httponly === b.httponly;
    }

    /**
     * Checks if a cookie is expired
     *
     * @param cookie Cookie object to check against
     * @returns True, if the cookie is expired
     */
    isExpired(cookie: Cookie): boolean {
        return (cookie.expires && cookie.expires < new Date()) || !cookie.value;
    }

    /**
     * Returns normalized cookie path for an URL path argument
     *
     * @param pathname
     * @returns Normalized path
     */
    getPath(pathname?: string | null): string {
        const pathParts = (pathname || '/').split('/');
        pathParts.pop(); // remove filename part
        let path = pathParts.join('/').trim();

        // ensure path prefix /
        if (path.charAt(0) !== '/') {
            path = '/' + path;
        }

        // ensure path suffix /
        if (path.substr(-1) !== '/') {
            path += '/';
        }

        return path;
    }
}
