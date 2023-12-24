'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

//let http = require('http');
const Cookies = require('../../lib/fetch/cookies');

describe('Cookie Tests', () => {
    let biskviit;

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

            assert.deepStrictEqual(biskviit.parse('SSID=Ap4P….GTEq; Domain=foo.com; Path=/; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly'), {
                name: 'ssid',
                value: 'Ap4P….GTEq',
                domain: '.foo.com',
                path: '/',
                httponly: true,
                secure: true,
                expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
            });
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
            biskviit.set('SSID=Ap4P….GTEq; Domain=foo.com; Path=/test; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly', 'https://foo.com/');
            // subdomains
            biskviit.set('SSID=Ap4P….GTEq; Domain=.foo.com; Path=/; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly', 'https://www.foo.com/');
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
    });
});
