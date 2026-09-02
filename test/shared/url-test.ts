import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as urllib from '../../src/shared/url.js';
import * as shared from '../../src/shared/index.js';
import Cookies from '../../src/fetch/cookies.js';

describe('URL wrapper Tests', { timeout: 10 * 1000 }, () => {
    // hosts the legacy parser truncates (the rest becomes the path, so every one of these
    // would become a request to 'localhost'), keeps with a control character, or that the
    // WHATWG parser accepts as an opaque host of a non-special scheme and decodes badly
    const badHosts = [
        'localhost\u0000.example.com',
        'localhost%00.example.com',
        'localhost%2f.example.com',
        'localhost .example.com',
        'localhost<.example.com',
        'localhost|.example.com',
        'localhost:80abc.example.com',
        'local\x01host',
        'localhost\x7f',
        'localhost%3a80.example.com',
        'localhost%40.example.com'
    ];

    // the newer legacy parser rejects a bad port itself, with its own error code
    const rejected = (err: Error & { code?: string }) => ['ERR_INVALID_URL', 'ERR_INVALID_ARG_VALUE'].includes(err.code as string);

    describe('parse', () => {
        it('should map a full URL to legacy-shaped fields', () => {
            const parsed = urllib.parse('https://user:pass@example.com:8443/a/b?x=1&y=2#frag');
            assert.strictEqual(parsed.protocol, 'https:');
            assert.strictEqual(parsed.hostname, 'example.com');
            assert.strictEqual(parsed.host, 'example.com:8443');
            assert.strictEqual(parsed.port, '8443');
            assert.strictEqual(parsed.pathname, '/a/b');
            assert.strictEqual(parsed.search, '?x=1&y=2');
            assert.strictEqual(parsed.path, '/a/b?x=1&y=2');
            assert.strictEqual(parsed.auth, 'user:pass');
            assert.strictEqual(parsed.href, 'https://user:pass@example.com:8443/a/b?x=1&y=2#frag');
        });

        it('should expose path as pathname only when there is no query', () => {
            const parsed = urllib.parse('http://example.com/just/a/path');
            assert.strictEqual(parsed.path, '/just/a/path');
            assert.strictEqual(parsed.search, null);
        });

        it('should null an omitted explicit port', () => {
            assert.strictEqual(urllib.parse('http://example.com/').port, null);
        });

        it('should drop a default port to null (matches the no-port fallback)', () => {
            assert.strictEqual(urllib.parse('https://example.com:443/').port, null);
            assert.strictEqual(urllib.parse('http://example.com:80/').port, null);
        });

        it('should preset auth to null when there is no userinfo', () => {
            assert.strictEqual(urllib.parse('http://example.com/').auth, null);
        });

        it('should decode the auth component', () => {
            // legacy url.parse() returns auth percent-decoded
            const parsed = urllib.parse('smtps://user%40gmail.com:%3Apasswith%25Char@smtp.gmail.com');
            assert.strictEqual(parsed.auth, 'user@gmail.com::passwith%Char');
        });

        it('should not throw on a malformed percent sequence in auth', () => {
            const parsed = urllib.parse('http://user:%E0%A4%A@example.com/');
            assert.ok(typeof parsed.auth === 'string');
        });

        it('should parse a slash-less authority (legacy leniency)', () => {
            // legacy url.parse() parses user:pass@host:port without "//" for
            // non-special schemes; connection/proxy URLs rely on this.
            const parsed = urllib.parse('smtp:testuser:testpass@www.example.com:1234', true);
            assert.strictEqual(parsed.protocol, 'smtp:');
            assert.strictEqual(parsed.hostname, 'www.example.com');
            assert.strictEqual(parsed.port, '1234');
            assert.strictEqual(parsed.auth, 'testuser:testpass');
        });

        it('should handle non-special schemes (smtps:/direct:)', () => {
            const parsed = urllib.parse('smtps://user:pass@localhost:465/');
            assert.strictEqual(parsed.protocol, 'smtps:');
            assert.strictEqual(parsed.hostname, 'localhost');
            assert.strictEqual(parsed.port, '465');
            assert.strictEqual(parsed.auth, 'user:pass');

            assert.strictEqual(urllib.parse('direct:').protocol, 'direct:');
        });

        it('should reject a host the legacy parser would truncate or keep with a control character', () => {
            for (const host of badHosts) {
                assert.throws(() => urllib.parse('http://' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.parse('http://user:pass@' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.parse('smtps://' + host + ':465'), rejected, JSON.stringify(host));
                // the legacy parser skips leading whitespace before it reads the scheme
                assert.throws(() => urllib.parse(' \thttp://' + host + '/x'), rejected, JSON.stringify(host));
                // a scheme the legacy parser accepts but WHATWG does not, and an empty authority
                assert.throws(() => urllib.parse('1http://' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.parse('http:///' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.parse('http:/' + host + '/x'), rejected, JSON.stringify(host));
            }
        });

        it('should still fall back to the legacy parser when it reads the whole authority', () => {
            // an out-of-range port is refused by WHATWG but kept as is by the legacy parser
            let parsed = urllib.parse('http://user:pass@Example.com:99999/x?y=1');
            assert.strictEqual(parsed.hostname, 'example.com');
            assert.strictEqual(parsed.port, '99999');
            assert.strictEqual(parsed.auth, 'user:pass');
            assert.strictEqual(parsed.pathname, '/x');

            // the legacy parser lowercases and IDNA maps the host, the comparison must too
            parsed = urllib.parse('http://Müller.example.:99999/');
            assert.strictEqual(parsed.hostname, 'xn--mller-kva.example.');
            assert.strictEqual(parsed.port, '99999');

            parsed = urllib.parse('http://[::1]:99999/');
            assert.strictEqual(parsed.hostname, '::1');
            assert.strictEqual(parsed.port, '99999');
        });

        it('should reject a bracketed host that is not an IPv6 literal', () => {
            assert.throws(() => urllib.parse('http://[evil.example]:99999/'), rejected);
            assert.throws(() => urllib.parse('http://[1.2.3.4]:99999/'), rejected);
        });

        it('should IDNA map the host of a non-special scheme like the legacy parser did', () => {
            assert.strictEqual(urllib.parse('smtp://MÜLLER.example:25').hostname, 'xn--mller-kva.example');
            assert.strictEqual(urllib.parse('smtp://EXAMPLE.COM:25').hostname, 'example.com');
            assert.strictEqual(urllib.parse('smtps://ｅｘａｍｐｌｅ.com:465').hostname, 'example.com');
            assert.strictEqual(urllib.parse('smtp://[::1]:25').hostname, '::1');
            assert.throws(() => urllib.parse('smtps://localhost%2500.example.com:465'), rejected);
        });

        it('should keep the slash-less form of a value with surrounding whitespace', () => {
            for (const input of [
                'smtp:user:pass@mail.example.com:25\n',
                '\r\nsmtp:user:pass@mail.example.com:25\r\n',
                ' smtp:user:pass@mail.example.com:25 '
            ]) {
                const parsed = urllib.parse(input);
                assert.strictEqual(parsed.hostname, 'mail.example.com', JSON.stringify(input));
                assert.strictEqual(parsed.port, '25', JSON.stringify(input));
                assert.strictEqual(parsed.auth, 'user:pass', JSON.stringify(input));
            }
        });

        it('should not throw on empty input', () => {
            const parsed = urllib.parse('');
            assert.strictEqual(parsed.hostname, null);
            assert.strictEqual(parsed.protocol, null);
            assert.strictEqual(parsed.auth, null);
            assert.strictEqual(parsed.query, null);
        });

        it('should not throw on garbage input', () => {
            const parsed = urllib.parse('not a url');
            assert.strictEqual(parsed.hostname, null);
        });

        describe('parseQueryString', () => {
            it('should return the raw query string when not requested', () => {
                assert.strictEqual(urllib.parse('http://example.com/?a=1&b=2').query, 'a=1&b=2');
                assert.strictEqual(urllib.parse('http://example.com/').query, null);
            });

            it('should return a parsed object when requested', () => {
                const query = urllib.parse('http://example.com/?a=1&b=hello', true).query as Record<string, string | string[]>;
                assert.strictEqual(query.a, '1');
                assert.strictEqual(query.b, 'hello');
            });

            it('should preserve dotted keys', () => {
                const query = urllib.parse('smtps://localhost?tls.rejectUnauthorized=false&name=horizon', true).query as Record<
                    string,
                    string | string[]
                >;
                assert.strictEqual(query['tls.rejectUnauthorized'], 'false');
                assert.strictEqual(query.name, 'horizon');
            });

            it('should promote repeated keys to arrays', () => {
                const query = urllib.parse('http://example.com/?a=1&a=2&a=3', true).query as Record<string, string | string[]>;
                assert.deepStrictEqual(query.a, ['1', '2', '3']);
            });

            it('should return an empty object when there is no query', () => {
                const query = urllib.parse('http://example.com/', true).query as Record<string, string | string[]>;
                assert.deepStrictEqual(Object.keys(query), []);
            });
        });
    });

    describe('legacy-parity regressions (failure modes)', () => {
        it('should strip brackets from an IPv6 literal host so it can be dialed', () => {
            // WHATWG keeps the brackets ('[::1]'), which net/dns/http.request treat
            // as a DNS name and fail to resolve. Legacy returned the bare address.
            assert.strictEqual(urllib.parse('https://[::1]:8443/x').hostname, '::1');
            assert.strictEqual(urllib.parse('smtp://[fe80::1]:25').hostname, 'fe80::1');
        });

        it('should keep the auth when only the password is present', () => {
            // WHATWG splits userinfo into username/password; gating on username alone
            // would drop a password-only credential and connect unauthenticated.
            assert.strictEqual(urllib.parse('smtps://:my-api-key@smtp.host:465').auth, ':my-api-key');
        });

        it('should IDNA-map a non-special-scheme host to punycode', () => {
            // For smtp:/smtps:/socks: WHATWG percent-encodes a non-ASCII host
            // ('m%C3%BCller.example') instead of IDNA-mapping it; that is not
            // resolvable. Legacy returned the punycode form.
            assert.strictEqual(urllib.parse('smtps://müller.example:465').hostname, 'xn--mller-kva.example');
            // special schemes are already IDNA-mapped by WHATWG; the mapping is idempotent
            assert.strictEqual(urllib.parse('https://müller.example/').hostname, 'xn--mller-kva.example');
        });

        it('should return an empty-string hostname (not null) for a host-less URL', () => {
            // Cookies.set/match do `hostname.length` and `'.' + hostname`; a null here
            // would throw. Legacy returned '' for these.
            assert.strictEqual(urllib.parse('direct:').hostname, '');
        });

        it('should not throw in Cookies.set when the request URL is host-less', () => {
            const jar = new Cookies();
            assert.doesNotThrow(() => jar.set('sid=abc; Domain=example.com', 'direct:'));
        });

        // The two cases below are accepted WHATWG-standard divergences from the legacy
        // parser, pinned so any future change to them is deliberate. Both are reached
        // only through malformed/obfuscated input; the fetch redirect path that uses
        // them already strips credentials on a cross-host hop.
        it('pins WHATWG slash/backslash normalization in resolve()', () => {
            assert.strictEqual(urllib.resolve('https://origin.example/a/b', '///attacker.com/p'), 'https://attacker.com/p');
            assert.strictEqual(urllib.resolve('https://origin.example/a/b', '/\\attacker.com/p'), 'https://attacker.com/p');
        });

        it('pins WHATWG authority parsing for an empty-authority URL', () => {
            assert.strictEqual(urllib.parse('http:///some/path').hostname, 'some');
        });
    });

    describe('resolve', () => {
        it('should resolve a relative target against an absolute base', () => {
            assert.strictEqual(urllib.resolve('http://example.com/a/b', '/c/d'), 'http://example.com/c/d');
            assert.strictEqual(urllib.resolve('http://example.com/a/b', 'c'), 'http://example.com/a/c');
        });

        it('should return an absolute target unchanged', () => {
            assert.strictEqual(urllib.resolve('http://example.com/a', 'https://other.com/x'), 'https://other.com/x');
        });

        it('should reject a host the legacy resolver would truncate', () => {
            for (const host of badHosts) {
                assert.throws(() => urllib.resolve('http://example.com/a', 'http://' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.resolve('http://' + host + '/a', 'x'), rejected, JSON.stringify(host));
                // a scheme-relative or backslash target decides the host of the result as well
                assert.throws(() => urllib.resolve('http://example.com/a', '//' + host + '/x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.resolve('http://example.com/a', '\\\\' + host + '\\x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.resolve('http://example.com/a', 'https:///' + host + '/x'), rejected, JSON.stringify(host));
                // a scheme-relative base is read as a host by the legacy resolver as well
                assert.throws(() => urllib.resolve('//' + host + '/a', 'x'), rejected, JSON.stringify(host));
                assert.throws(() => urllib.resolve('http://example.com/a', ' http://' + host + '/x'), rejected, JSON.stringify(host));
            }
        });

        it('should still fall back to the legacy resolver for an out-of-range port', () => {
            assert.strictEqual(urllib.resolve('http://example.com:99999/a/b', 'c'), 'http://example.com:99999/a/c');
            assert.strictEqual(urllib.resolve('http://example.com/a/b', '//other.example:99999/c'), 'http://other.example:99999/c');
        });
    });

    describe('parity with shared.parseConnectionUrl', () => {
        it('should feed parseConnectionUrl the expected result (auth + query)', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtps://user:pass@localhost:123?tls.rejectUnauthorized=false&name=horizon'), {
                secure: true,
                port: 123,
                host: 'localhost',
                auth: {
                    user: 'user',
                    pass: 'pass'
                },
                tls: {
                    rejectUnauthorized: false
                },
                name: 'horizon'
            });
        });

        it('should feed parseConnectionUrl a slash-less connection url', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtp:testuser:testpass@www.example.com:1234'), {
                secure: false,
                port: 1234,
                host: 'www.example.com',
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                }
            });
        });

        it('should feed parseConnectionUrl decoded auth with special symbols', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtps://user%40gmail.com:%3Apasswith%25Char@smtp.gmail.com'), {
                secure: true,
                host: 'smtp.gmail.com',
                auth: {
                    user: 'user@gmail.com',
                    pass: ':passwith%Char'
                }
            });
        });

        it('should keep a password-only credential', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtps://:my-api-key@smtp.host:465'), {
                secure: true,
                port: 465,
                host: 'smtp.host',
                auth: {
                    user: '',
                    pass: 'my-api-key'
                }
            });
        });

        it('should resolve an IDN host to a punycode hostname', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtps://müller.example:465'), {
                secure: true,
                port: 465,
                host: 'xn--mller-kva.example'
            });
        });
    });
});
