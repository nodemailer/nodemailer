/* eslint no-unused-expressions:0, no-invalid-this:0, prefer-arrow-callback: 0, object-shorthand: 0 */
/* globals afterEach, beforeEach, describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;
const XOAuth2 = require('../../lib/xoauth2');
const mockServer = require('./server');

chai.config.includeStack = true;

describe('XOAuth2 tests', function () {
    this.timeout(10000);

    let server;
    let users = {};
    let XOAUTH_PORT = 8993;

    beforeEach(function (done) {
        server = mockServer({
            port: XOAUTH_PORT,
            onUpdate: function (username, accessToken) {
                users[username] = accessToken;
            }
        });
        server.addUser('test@example.com', 'saladus');
        server.start(done);
    });

    afterEach(function (done) {
        server.stop(done);
    });

    it('should get an existing access token', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc',
            timeout: 3600
        });

        xoauth2.getToken(false, function (err, accessToken) {
            expect(err).to.not.exist;
            expect(accessToken).to.equal('abc');
            done();
        });
    });

    it('should convert access token to XOAuth2 token', function () {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            accessToken: 'abc'
        });

        expect(xoauth2.buildXOAuth2Token()).to.equal('dXNlcj10ZXN0QGV4YW1wbGUuY29tAWF1dGg9QmVhcmVyIGFiYwEB');
        expect(xoauth2.buildXOAuth2Token('bbb')).to.equal('dXNlcj10ZXN0QGV4YW1wbGUuY29tAWF1dGg9QmVhcmVyIGJiYgEB');
    });

    it('should get an existing access token, no timeout', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc'
        });

        xoauth2.getToken(false, function (err, accessToken) {
            expect(err).to.not.exist;
            expect(accessToken).to.equal('abc');
            done();
        });
    });

    it('should generate a fresh access token', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600
        });

        xoauth2.getToken(false, function (err, accessToken) {
            expect(err).to.not.exist;
            expect(accessToken).to.equal(users['test@example.com']);
            done();
        });
    });

    it('should generate a fresh access token with custom method', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600,
            provisionCallback: (user, renew, cb) => {
                cb(null, 'zzz');
            }
        });

        xoauth2.getToken(false, function (err, accessToken) {
            expect(err).to.not.exist;
            expect(accessToken).to.equal('zzz');
            done();
        });
    });

    it('should fail generating a fresh access token with custom method', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600,
            provisionCallback: (user, renew, cb) => {
                cb(new Error('fail'));
            }
        });

        xoauth2.getToken(false, function (err, accessToken) {
            expect(err).to.exist;
            expect(accessToken).to.not.exist;
            done();
        });
    });

    it('should generate a fresh access token after timeout', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc',
            timeout: 1
        });

        setTimeout(function () {
            xoauth2.getToken(false, function (err, accessToken) {
                expect(err).to.not.exist;
                expect(accessToken).to.equal(users['test@example.com']);
                done();
            });
        }, 3000);
    });

    it('should emit access token update', function (done) {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600
        });

        xoauth2.once('token', function (tokenData) {
            expect(tokenData.expires).to.be.gte(Date.now() + 3000 * 1000);
            expect(tokenData).to.deep.equal({
                user: 'test@example.com',
                accessToken: users['test@example.com'],
                expires: tokenData.expires
            });
            done();
        });

        xoauth2.getToken(false, function () {});
    });

    it('should sign payload', function () {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: '{Client ID}',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600,
            privateKey:
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
                '-----END RSA PRIVATE KEY-----'
        });
        expect(
            xoauth2.jwtSignRS256({
                some: 'payload'
            })
        ).to.equal(
            'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzb21lIjoicGF5bG9hZCJ9.yBo28P5qE8t8yMkN0hC6uWstUAGh8RGW-zLe1NHdtit8ZVlAEdnhXbZvjGEfDWjOeWe1aZ2eZ65i83awWsx02G9HDsI1xMOFTHpviSHLIWnOf1D2hqJxm0On9zYRjd6oFxuRlmJtI9PIDlMJltG7K3leqReLLC6ZOAYL1Au0WY5swdG2eA6Oi83BTEckLj9c-0TYYRYtyRSG9o298Iuc8JL2KhrAbM8d62JgAPuI3hN_NgEtxs36bidt3SHbuWSszAdt1lHR-bFCZ-kXy_DAGlGiYRHRNyvsLR_q_v4GhV2oVi3WSPR816UhHrTryA0NlbanACb8T22bJGRQ708m_g'
        );
    });
});
