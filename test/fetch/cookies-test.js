/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals beforeEach, describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

//let http = require('http');
const Cookies = require('../../lib/fetch/cookies');

chai.config.includeStack = true;

describe('Cookie Tests', function () {
    let biskviit;

    beforeEach(function () {
        biskviit = new Cookies();
    });

    describe('#getPath', function () {
        it('should return root path', function () {
            expect(biskviit.getPath('/')).to.equal('/');
            expect(biskviit.getPath('')).to.equal('/');
            expect(biskviit.getPath('/index.php')).to.equal('/');
        });

        it('should return without file', function () {
            expect(biskviit.getPath('/path/to/file')).to.equal('/path/to/');
        });
    });

    describe('#isExpired', function () {
        it('should match expired cookie', function () {
            expect(
                biskviit.isExpired({
                    name: 'a',
                    value: 'b',
                    expires: new Date(Date.now() + 10000)
                })
            ).to.be.false;

            expect(
                biskviit.isExpired({
                    name: 'a',
                    value: '',
                    expires: new Date(Date.now() + 10000)
                })
            ).to.be.true;

            expect(
                biskviit.isExpired({
                    name: 'a',
                    value: 'b',
                    expires: new Date(Date.now() - 10000)
                })
            ).to.be.true;
        });
    });

    describe('#compare', function () {
        it('should match similar cookies', function () {
            expect(
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
                )
            ).to.be.true;

            expect(
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
                )
            ).to.be.false;

            expect(
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
                )
            ).to.be.false;

            expect(
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
                )
            ).to.be.false;

            expect(
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
                )
            ).to.be.false;
        });
    });

    describe('#add', function () {
        it('should append new cookie', function () {
            expect(biskviit.cookies.length).to.equal(0);
            biskviit.add({
                name: 'zzz',
                value: 'abc',
                path: '/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            });
            expect(biskviit.cookies.length).to.equal(1);
            expect(biskviit.cookies[0].name).to.equal('zzz');
            expect(biskviit.cookies[0].value).to.equal('abc');
        });

        it('should update existing cookie', function () {
            expect(biskviit.cookies.length).to.equal(0);
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
            expect(biskviit.cookies.length).to.equal(1);
            expect(biskviit.cookies[0].name).to.equal('zzz');
            expect(biskviit.cookies[0].value).to.equal('def');
        });
    });

    describe('#match', function () {
        it('should check if a cookie matches particular domain and path', function () {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            };
            expect(biskviit.match(cookie, 'http://example.com/def/')).to.be.true;
            expect(biskviit.match(cookie, 'http://example.com/bef/')).to.be.false;
        });

        it('should check if a cookie matches particular domain and path', function () {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: false,
                httponly: false
            };
            expect(biskviit.match(cookie, 'http://example.com/def/')).to.be.true;
            expect(biskviit.match(cookie, 'http://example.com/bef/')).to.be.false;
        });

        it('should check if a cookie is secure', function () {
            let cookie = {
                name: 'zzz',
                value: 'abc',
                path: '/def/',
                expires: new Date(Date.now() + 10000),
                domain: 'example.com',
                secure: true,
                httponly: false
            };
            expect(biskviit.match(cookie, 'https://example.com/def/')).to.be.true;
            expect(biskviit.match(cookie, 'http://example.com/def/')).to.be.false;
        });
    });

    describe('#parse', function () {
        it('should parse Set-Cookie value', function () {
            expect(biskviit.parse('theme=plain')).to.deep.equal({
                name: 'theme',
                value: 'plain'
            });

            expect(biskviit.parse('SSID=Ap4P….GTEq; Domain=foo.com; Path=/; Expires=Wed, 13 Jan 2031 22:23:01 GMT; Secure; HttpOnly')).to.deep.equal({
                name: 'ssid',
                value: 'Ap4P….GTEq',
                domain: '.foo.com',
                path: '/',
                httponly: true,
                secure: true,
                expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
            });
        });

        it('should ignore invalid expire header', function () {
            expect(biskviit.parse('theme=plain; Expires=Wed, 13 Jan 2031 22:23:01 GMT')).to.deep.equal({
                name: 'theme',
                value: 'plain',
                expires: new Date('Wed, 13 Jan 2031 22:23:01 GMT')
            });

            expect(biskviit.parse('theme=plain; Expires=ZZZZZZZZ GMT')).to.deep.equal({
                name: 'theme',
                value: 'plain'
            });
        });
    });

    describe('Listing', function () {
        beforeEach(function () {
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

        describe('#list', function () {
            it('should return matching cookies for an URL', function () {
                expect(biskviit.list('https://www.foo.com')).to.deep.equal([
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

        describe('#get', function () {
            it('should return matching cookies for an URL', function () {
                expect(biskviit.get('https://www.foo.com')).to.equal('ssid1=Ap4P….GTEq1; ssid4=Ap4P….GTEq4');
            });
        });
    });

    describe('#set', function () {
        it('should set cookie', function () {
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

            expect(
                biskviit.cookies.map(function (cookie) {
                    delete cookie.expires;
                    return cookie;
                })
            ).to.deep.equal([
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
            ]);
        });
    });
});
