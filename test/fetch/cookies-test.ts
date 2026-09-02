import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

//let http = require('http');
import Cookies from '../../src/fetch/cookies.js';

describe('Cookie Tests', () => {
    let biskviit: Cookies;

    beforeEach(() => {
        biskviit = new Cookies();
    });

    describe('#getPath', () => {
        it('should return root path', () => {
            assert.strictEqual(biskviit.getPath('/'), '/');
            assert.strictEqual(biskviit.getPath(''), '/');
            assert.strictEqual(biskviit.getPath('/index.php'), '/');
        });

        it('should return without file', () => {
            assert.strictEqual(biskviit.getPath('/path/to/file'), '/path/to/');
        });
    });

    describe('#isExpired', () => {
        it('should match expired cookie', () => {
            assert.strictEqual(
                biskviit.isExpired({
                    name: 'a',
                    value: 'b',
                    expires: new Date(Date.now() + 10000)
                }),
                false
            );

            assert.strictEqual(
                biskviit.isExpired({
                    name: 'a',
                    value: '',
                    expires: new Date(Date.now() + 10000)
                }),
                true
            );

            assert.strictEqual(
                biskviit.isExpired({
                    name: 'a',
                    value: 'b',
                    expires: new Date(Date.now() - 10000)
                }),
                true
            );
        });
    });

    describe('#compare', () => {
        it('should match similar cookies', () => {
            assert.strictEqual(
                biskviit.compare(
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    },
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    }
                ),
                true
            );

            assert.strictEqual(
                biskviit.compare(
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    },
                    {
                        name: 'yyy',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    }
                ),
                false
            );

            assert.strictEqual(
                biskviit.compare(
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    },
                    {
                        name: 'zzz',
                        path: '/amp',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    }
                ),
                false
            );

            assert.strictEqual(
                biskviit.compare(
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    },
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'examples.com',
                        secure: false,
                        httponly: false
                    }
                ),
                false
            );

            assert.strictEqual(
                biskviit.compare(
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: false,
                        httponly: false
                    },
                    {
                        name: 'zzz',
                        path: '/',
                        domain: 'example.com',
                        secure: true,
                        httponly: false
                    }
                ),
                false
            );
        });
    });

    describe('#add', () => {
        it('should append new cookie', () => {
            assert.strictEqual(biskviit.cookies.length, 0);
            biskviit.add({
                name: 'zzz',
                value: 'abc',
                path: '/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            });
            assert.strictEqual(biskviit.cookies.length, 1);
            assert.strictEqual(biskviit.cookies[0].name, 'zzz');
            assert.strictEqual(biskviit.cookies[0].value, 'abc');
        });

        it('should update existing cookie', () => {
            assert.strictEqual(biskviit.cookies.length, 0);
            biskviit.add({
                name: 'zzz',
                value: 'abc',
                path: '/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            });
            biskviit.add({
                name: 'zzz',
                value: 'def',
                path: '/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            });
            assert.strictEqual(biskviit.cookies.length, 1);
            assert.strictEqual(biskviit.cookies[0].name, 'zzz');
            assert.strictEqual(biskviit.cookies[0].value, 'def');
        });

        it('should ignore a cookie without a name', () => {
            assert.strictEqual(biskviit.add({}), false);
            assert.strictEqual(biskviit.add({ value: 'abc', domain: 'example.com', path: '/' }), false);
            assert.strictEqual(biskviit.cookies.length, 0);
        });

        it('should remove an existing cookie when the update has expired', () => {
            biskviit.add({
                name: 'zzz',
                value: 'abc',
                path: '/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            });
            assert.strictEqual(biskviit.cookies.length, 1);

            // a Set-Cookie with a past expiry date is how a server deletes a cookie
            assert.strictEqual(
                biskviit.add({
                    name: 'zzz',
                    value: 'def',
                    path: '/',
                    expires: new Date(Date.now() - 10000),
                    domain: 'example.com',
                    secure: false,
                    httponly: false
                }),
                false
            );
            assert.strictEqual(biskviit.cookies.length, 0);
        });

        it('should not store a new cookie that has already expired', () => {
            assert.strictEqual(
                biskviit.add({
                    name: 'zzz',
                    value: 'abc',
                    path: '/',
                    expires: new Date(Date.now() - 10000),
                    domain: 'example.com'
                }),
                true
            );
            assert.strictEqual(biskviit.cookies.length, 0);
        });
    });

    describe('#match', () => {
        it('should check if a cookie matches particular domain and path', () => {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            };
            assert.strictEqual(biskviit.match(cookie, 'http://example.com/def/'), true);
            assert.strictEqual(biskviit.match(cookie, 'http://example.com/bef/'), false);
        });

        it('should check if a cookie matches particular domain and path', () => {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            };
            assert.strictEqual(biskviit.match(cookie, 'http://example.com/def/'), true);
            assert.strictEqual(biskviit.match(cookie, 'http://example.com/bef/'), false);
        });

        it('should check if a cookie is secure', () => {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: true,
                httponly: false
            };
            assert.strictEqual(biskviit.match(cookie, 'https://example.com/def/'), true);
            assert.strictEqual(biskviit.match(cookie, 'http://example.com/def/'), false);
        });
    });

    describe('#parse', () => {
        it('should parse Set-Cookie value', () => {
            assert.deepStrictEqual(biskviit.parse('theme=plain'), {
                name: 'theme',
                value: 'plain'
            });

            assert.deepStrictEqual(
                biskviit.parse('SSID=Ap4P….GTEq; Domain=foo.com; Path=/; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly'),
                {
                    name: 'ssid',
                    value: 'Ap4P….GTEq',
                    domain: '.foo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                }
            );
        });

        it('should ignore invalid expire header', () => {
            assert.deepStrictEqual(biskviit.parse('theme=plain; Expires=Wed, 13 Jan 2031 22:23:01 GMT'), {
                name: 'theme',
                value: 'plain',
                expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
            });

            assert.deepStrictEqual(biskviit.parse('theme=plain; Expires=ZZZZZZZZ GMT'), {
                name: 'theme',
                value: 'plain'
            });
        });

        it('should skip empty parts', () => {
            assert.deepStrictEqual(biskviit.parse('; theme=plain; ; Path=/;'), {
                name: 'theme',
                value: 'plain',
                path: '/'
            });
        });

        it('should derive the expiry date from max-age', () => {
            let before = Date.now();
            let cookie = biskviit.parse('theme=plain; Max-Age=60');
            let after = Date.now();

            assert.strictEqual(cookie.name, 'theme');
            assert.ok(cookie.expires instanceof Date);
            assert.ok(cookie.expires.getTime() >= before + 60 * 1000);
            assert.ok(cookie.expires.getTime() <= after + 60 * 1000);
        });

        it('should treat an unparseable max-age as an immediate expiry', () => {
            let before = Date.now();
            let cookie = biskviit.parse('theme=plain; Max-Age=soon');

            assert.ok(cookie.expires instanceof Date);
            assert.ok(cookie.expires.getTime() >= before);
            assert.ok(cookie.expires.getTime() <= Date.now());
        });
    });

    describe('Listing', () => {
        beforeEach(() => {
            biskviit.cookies = [
                {
                    name: 'ssid1',
                    value: 'Ap4P….GTEq1',
                    domain: '.foo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                },
                {
                    name: 'ssid2',
                    value: 'Ap4P….GTEq2',
                    domain: '.foo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 1900 22:23:01 GMT')
                },
                {
                    name: 'ssid3',
                    value: 'Ap4P….GTEq3',
                    domain: 'foo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                },
                {
                    name: 'ssid4',
                    value: 'Ap4P….GTEq4',
                    domain: 'www.foo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                },
                {
                    name: 'ssid5',
                    value: 'Ap4P….GTEq5',
                    domain: 'broo.com',
                    path: '/',
                    httponly: true,
                    secure: true,
                    expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                }
            ];
        });

        describe('#list', () => {
            it('should return matching cookies for an URL', () => {
                assert.deepStrictEqual(biskviit.list('https://www.foo.com'), [
                    {
                        name: 'ssid1',
                        value: 'Ap4P….GTEq1',
                        domain: '.foo.com',
                        path: '/',
                        httponly: true,
                        secure: true,
                        expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                    },
                    {
                        name: 'ssid4',
                        value: 'Ap4P….GTEq4',
                        domain: 'www.foo.com',
                        path: '/',
                        httponly: true,
                        secure: true,
                        expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
                    }
                ]);
            });
        });

        describe('#get', () => {
            it('should return matching cookies for an URL', () => {
                assert.strictEqual(biskviit.get('https://www.foo.com'), 'ssid1=Ap4P….GTEq1; ssid4=Ap4P….GTEq4');
            });
        });
    });

    describe('#set', () => {
        it('should set cookie', () => {
            // short
            biskviit.set('theme=plain', 'https://foo.com/');
            // long
            biskviit.set(
                'SSID=Ap4P….GTEq; Domain=foo.com; Path=/test; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly',
                'https://foo.com/'
            );
            // subdomains
            biskviit.set(
                'SSID=Ap4P….GTEq; Domain=.foo.com; Path=/; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly',
                'https://www.foo.com/'
            );
            // invalid cors
            biskviit.set('invalid_1=cors; domain=example.com', 'https://foo.com/');
            biskviit.set('invalid_2=cors; domain=www.foo.com', 'https://foo.com/');
            // invalid date
            biskviit.set('invalid_3=date; Expires=zzzz', 'https://foo.com/');
            // invalid tld
            biskviit.set('invalid_4=cors; domain=.co.uk', 'https://foo.co.uk/');
            // should not be added
            biskviit.set('expired_1=date; Expires=1999-01-01 01:01:01 GMT', 'https://foo.com/');

            assert.deepStrictEqual(
                biskviit.cookies.map(cookie => {
                    delete cookie.expires;
                    return cookie;
                }),
                [
                    {
                        name: 'theme',
                        value: 'plain',
                        domain: 'foo.com',
                        path: '/'
                    },
                    {
                        name: 'ssid',
                        value: 'Ap4P….GTEq',
                        domain: 'foo.com',
                        path: '/test',
                        secure: true,
                        httponly: true
                    },
                    {
                        name: 'ssid',
                        value: 'Ap4P….GTEq',
                        domain: 'www.foo.com',
                        path: '/',
                        secure: true,
                        httponly: true
                    },
                    {
                        name: 'invalid_1',
                        value: 'cors',
                        domain: 'foo.com',
                        path: '/'
                    },
                    {
                        name: 'invalid_2',
                        value: 'cors',
                        domain: 'foo.com',
                        path: '/'
                    },
                    {
                        name: 'invalid_3',
                        value: 'date',
                        domain: 'foo.com',
                        path: '/'
                    },
                    {
                        name: 'invalid_4',
                        value: 'cors',
                        domain: 'foo.co.uk',
                        path: '/'
                    }
                ]
            );
        });

        it('should use the sessionTimeout option for a cookie without an expiry date', () => {
            let jar = new Cookies({ sessionTimeout: 10 });
            let before = Date.now();

            jar.set('theme=plain', 'https://foo.com/');

            assert.strictEqual(jar.cookies.length, 1);
            let expires = (jar.cookies[0].expires as Date).getTime();
            assert.ok(expires >= before + 10 * 1000);
            assert.ok(expires <= Date.now() + 10 * 1000);
        });

        it('should drop a cookie that is set to an empty value', () => {
            biskviit.set('theme=plain', 'https://foo.com/');
            assert.strictEqual(biskviit.get('https://foo.com/'), 'theme=plain');

            assert.strictEqual(biskviit.set('theme=', 'https://foo.com/'), false);
            assert.strictEqual(biskviit.get('https://foo.com/'), '');
            assert.strictEqual(biskviit.cookies.length, 0);
        });
    });
});
