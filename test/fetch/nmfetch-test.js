/* eslint no-unused-expressions:0, prefer-arrow-callback:0 */
/* globals afterEach, beforeEach, describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

//let http = require('http');
const nmfetch = require('../../lib/fetch');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const PassThrough = require('stream').PassThrough;

chai.config.includeStack = true;

const HTTP_PORT = 19998;
const HTTPS_PORT = 19993;

const httpsOptions = {
    key:
        '-----BEGIN RSA PRIVATE KEY-----\n' +
        'MIIEpAIBAAKCAQEA6Z5Qqhw+oWfhtEiMHE32Ht94mwTBpAfjt3vPpX8M7DMCTwHs\n' +
        '1xcXvQ4lQ3rwreDTOWdoJeEEy7gMxXqH0jw0WfBx+8IIJU69xstOyT7FRFDvA1yT\n' +
        'RXY2yt9K5s6SKken/ebMfmZR+03ND4UFsDzkz0FfgcjrkXmrMF5Eh5UXX/+9YHeU\n' +
        'xlp0gMAt+/SumSmgCaysxZLjLpd4uXz+X+JVxsk1ACg1NoEO7lWJC/3WBP7MIcu2\n' +
        'wVsMd2XegLT0gWYfT1/jsIH64U/mS/SVXC9QhxMl9Yfko2kx1OiYhDxhHs75RJZh\n' +
        'rNRxgfiwgSb50Gw4NAQaDIxr/DJPdLhgnpY6UQIDAQABAoIBAE+tfzWFjJbgJ0ql\n' +
        's6Ozs020Sh4U8TZQuonJ4HhBbNbiTtdDgNObPK1uNadeNtgW5fOeIRdKN6iDjVeN\n' +
        'AuXhQrmqGDYVZ1HSGUfD74sTrZQvRlWPLWtzdhybK6Css41YAyPFo9k4bJ2ZW2b/\n' +
        'p4EEQ8WsNja9oBpttMU6YYUchGxo1gujN8hmfDdXUQx3k5Xwx4KA68dveJ8GasIt\n' +
        'd+0Jd/FVwCyyx8HTiF1FF8QZYQeAXxbXJgLBuCsMQJghlcpBEzWkscBR3Ap1U0Zi\n' +
        '4oat8wrPZGCblaA6rNkRUVbc/+Vw0stnuJ/BLHbPxyBs6w495yBSjBqUWZMvljNz\n' +
        'm9/aK0ECgYEA9oVIVAd0enjSVIyAZNbw11ElidzdtBkeIJdsxqhmXzeIFZbB39Gd\n' +
        'bjtAVclVbq5mLsI1j22ER2rHA4Ygkn6vlLghK3ZMPxZa57oJtmL3oP0RvOjE4zRV\n' +
        'dzKexNGo9gU/x9SQbuyOmuauvAYhXZxeLpv+lEfsZTqqrvPUGeBiEQcCgYEA8poG\n' +
        'WVnykWuTmCe0bMmvYDsWpAEiZnFLDaKcSbz3O7RMGbPy1cypmqSinIYUpURBT/WY\n' +
        'wVPAGtjkuTXtd1Cy58m7PqziB7NNWMcsMGj+lWrTPZ6hCHIBcAImKEPpd+Y9vGJX\n' +
        'oatFJguqAGOz7rigBq6iPfeQOCWpmprNAuah++cCgYB1gcybOT59TnA7mwlsh8Qf\n' +
        'bm+tSllnin2A3Y0dGJJLmsXEPKtHS7x2Gcot2h1d98V/TlWHe5WNEUmx1VJbYgXB\n' +
        'pw8wj2ACxl4ojNYqWPxegaLd4DpRbtW6Tqe9e47FTnU7hIggR6QmFAWAXI+09l8y\n' +
        'amssNShqjE9lu5YDi6BTKwKBgQCuIlKGViLfsKjrYSyHnajNWPxiUhIgGBf4PI0T\n' +
        '/Jg1ea/aDykxv0rKHnw9/5vYGIsM2st/kR7l5mMecg/2Qa145HsLfMptHo1ZOPWF\n' +
        '9gcuttPTegY6aqKPhGthIYX2MwSDMM+X0ri6m0q2JtqjclAjG7yG4CjbtGTt/UlE\n' +
        'WMlSZwKBgQDslGeLUnkW0bsV5EG3AKRUyPKz/6DVNuxaIRRhOeWVKV101claqXAT\n' +
        'wXOpdKrvkjZbT4AzcNrlGtRl3l7dEVXTu+dN7/ZieJRu7zaStlAQZkIyP9O3DdQ3\n' +
        'rIcetQpfrJ1cAqz6Ng0pD0mh77vQ13WG1BBmDFa2A9BuzLoBituf4g==\n' +
        '-----END RSA PRIVATE KEY-----',
    cert:
        '-----BEGIN CERTIFICATE-----\n' +
        'MIICpDCCAYwCCQCuVLVKVTXnAjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDEwls\n' +
        'b2NhbGhvc3QwHhcNMTUwMjEyMTEzMjU4WhcNMjUwMjA5MTEzMjU4WjAUMRIwEAYD\n' +
        'VQQDEwlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDp\n' +
        'nlCqHD6hZ+G0SIwcTfYe33ibBMGkB+O3e8+lfwzsMwJPAezXFxe9DiVDevCt4NM5\n' +
        'Z2gl4QTLuAzFeofSPDRZ8HH7wgglTr3Gy07JPsVEUO8DXJNFdjbK30rmzpIqR6f9\n' +
        '5sx+ZlH7Tc0PhQWwPOTPQV+ByOuReaswXkSHlRdf/71gd5TGWnSAwC379K6ZKaAJ\n' +
        'rKzFkuMul3i5fP5f4lXGyTUAKDU2gQ7uVYkL/dYE/swhy7bBWwx3Zd6AtPSBZh9P\n' +
        'X+OwgfrhT+ZL9JVcL1CHEyX1h+SjaTHU6JiEPGEezvlElmGs1HGB+LCBJvnQbDg0\n' +
        'BBoMjGv8Mk90uGCeljpRAgMBAAEwDQYJKoZIhvcNAQELBQADggEBABXm8GPdY0sc\n' +
        'mMUFlgDqFzcevjdGDce0QfboR+M7WDdm512Jz2SbRTgZD/4na42ThODOZz9z1AcM\n' +
        'zLgx2ZNZzVhBz0odCU4JVhOCEks/OzSyKeGwjIb4JAY7dh+Kju1+6MNfQJ4r1Hza\n' +
        'SVXH0+JlpJDaJ73NQ2JyfqELmJ1mTcptkA/N6rQWhlzycTBSlfogwf9xawgVPATP\n' +
        '4AuwgjHl12JI2HVVs1gu65Y3slvaHRCr0B4+Kg1GYNLLcbFcK+NEHrHmPxy9TnTh\n' +
        'Zwp1dsNQU+Xkylz8IUANWSLHYZOMtN2e5SKIdwTtl5C8YxveuY8YKb1gDExnMraT\n' +
        'VGXQDqPleug=\n' +
        '-----END CERTIFICATE-----'
};

describe('NMFetch Tests', function () {
    this.timeout(50 * 1000); // eslint-disable-line no-invalid-this

    let httpServer, httpsServer;

    beforeEach(function (done) {
        httpServer = http.createServer(function (req, res) {
            switch (req.url) {
                case '/redirect6':
                    res.writeHead(302, {
                        Location: '/redirect5'
                    });
                    res.end();
                    break;

                case '/redirect5':
                    res.writeHead(302, {
                        Location: '/redirect4'
                    });
                    res.end();
                    break;

                case '/redirect4':
                    res.writeHead(302, {
                        Location: '/redirect3'
                    });
                    res.end();
                    break;

                case '/redirect3':
                    res.writeHead(302, {
                        Location: '/redirect2'
                    });
                    res.end();
                    break;

                case '/redirect2':
                    res.writeHead(302, {
                        Location: '/redirect1'
                    });
                    res.end();
                    break;

                case '/redirect1':
                    res.writeHead(302, {
                        Location: '/'
                    });
                    res.end();
                    break;

                case '/forever':
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.write('This connection is never closed');
                    // never end the request
                    break;

                case '/gzip': {
                    res.writeHead(200, {
                        'Content-Type': 'text/plain',
                        'Content-Encoding': 'gzip'
                    });

                    let stream = zlib.createGzip();
                    stream.pipe(res);
                    stream.end('Hello World HTTP\n');
                    break;
                }
                case '/invalid':
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end('Hello World HTTP\n');
                    break;

                case '/auth':
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(Buffer.from(req.headers.authorization.split(' ').pop(), 'base64'));
                    break;

                case '/cookie':
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(req.headers.cookie);
                    break;

                case '/ua':
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(req.headers['user-agent']);
                    break;

                case '/post': {
                    let body = [];
                    req.on('readable', function () {
                        let chunk;
                        while ((chunk = req.read()) !== null) {
                            body.push(chunk);
                        }
                    });
                    req.on('end', function () {
                        res.writeHead(200, {
                            'Content-Type': 'text/plain'
                        });
                        res.end(Buffer.concat(body));
                    });

                    break;
                }
                default:
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.end('Hello World HTTP\n');
            }
        });

        httpsServer = https.createServer(httpsOptions, function (req, res) {
            res.writeHead(200, {
                'Content-Type': 'text/plain'
            });
            res.end('Hello World HTTPS\n');
        });

        httpServer.listen(HTTP_PORT, function () {
            httpsServer.listen(HTTPS_PORT, done);
        });
    });

    afterEach(function (done) {
        httpServer.close(function () {
            httpsServer.close(done);
        });
    });

    it('should fetch HTTP data', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT);
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTP\n');
            done();
        });
    });

    it('should fetch HTTPS data', function (done) {
        let req = nmfetch('https://localhost:' + HTTPS_PORT);
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTPS\n');
            done();
        });
    });

    it('should fetch HTTP data with redirects', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/redirect3');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTP\n');
            done();
        });
    });

    it('should return error for too many redirects', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/redirect6');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should fetch HTTP data with custom redirect limit', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/redirect3', {
            maxRedirects: 3
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTP\n');
            done();
        });
    });

    it('should return error for custom redirect limit', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/redirect3', {
            maxRedirects: 2
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should return disable redirects', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/redirect1', {
            maxRedirects: 0
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should unzip compressed HTTP data', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/gzip');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTP\n');
            done();
        });
    });

    it('should return error for unresolved host', function (done) {
        let req = nmfetch('http://asfhaskhhgbjdsfhgbsdjgk');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should return error for invalid status', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/invalid');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should allow invalid status', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/invalid', {
            allowErrorResponse: true
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.not.exist;
        });
        req.on('end', function () {
            expect(req.statusCode).to.equal(500);
            expect(Buffer.concat(buf).toString()).to.equal('Hello World HTTP\n');
            done();
        });
    });

    it('should return error for invalid url', function (done) {
        let req = nmfetch('http://localhost:99999999/');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should return timeout error', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/forever', {
            timeout: 1000
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });

    it('should handle basic HTTP auth', function (done) {
        let req = nmfetch('http://user:pass@localhost:' + HTTP_PORT + '/auth');
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('user:pass');
            done();
        });
    });

    if (!/^0\.10\./.test(process.versions.node)) {
        // disabled for node 0.10
        it('should return error for invalid protocol', function (done) {
            let req = nmfetch('http://localhost:' + HTTPS_PORT);
            let buf = [];
            req.on('data', function (chunk) {
                buf.push(chunk);
            });
            req.on('error', function (err) {
                expect(err).to.exist;
                done();
            });
            req.on('end', function () {});
        });
    }

    it('should set cookie value', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/cookie', {
            cookie: 'test=pest'
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('test=pest');
            done();
        });
    });

    it('should set user agent', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/ua', {
            userAgent: 'nodemailer-fetch'
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('nodemailer-fetch');
            done();
        });
    });

    it('should post data', function (done) {
        let req = nmfetch('http://localhost:' + HTTP_PORT + '/post', {
            method: 'post',
            body: {
                hello: 'world 😭',
                another: 'value'
            }
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal('hello=world%20%F0%9F%98%AD&another=value');
            done();
        });
    });

    it('should post stream data', function (done) {
        let body = new PassThrough();
        let data = Buffer.from('hello=world%20%F0%9F%98%AD&another=value');

        let req = nmfetch('http://localhost:' + HTTP_PORT + '/post', {
            method: 'post',
            body
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('end', function () {
            expect(Buffer.concat(buf).toString()).to.equal(data.toString());
            done();
        });

        let pos = 0;
        let writeNext = function () {
            if (pos >= data.length) {
                return body.end();
            }
            let char = data.slice(pos++, pos);
            body.write(char);
            setImmediate(writeNext);
        };

        setImmediate(writeNext);
    });

    it('should return error for invalid cert', function (done) {
        let req = nmfetch('https://localhost:' + HTTPS_PORT, {
            tls: {
                rejectUnauthorized: true
            }
        });
        let buf = [];
        req.on('data', function (chunk) {
            buf.push(chunk);
        });
        req.on('error', function (err) {
            expect(err).to.exist;
            done();
        });
        req.on('end', function () {});
    });
});
