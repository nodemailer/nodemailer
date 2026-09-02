import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import XOAuth2 from '../../src/xoauth2/index.js';
import mockServer, { type OAuthServer } from './server.js';
import http from 'node:http';
import crypto from 'node:crypto';
import querystring from 'node:querystring';
import type { AddressInfo } from 'node:net';

describe('XOAuth2 tests', { timeout: 10000 }, () => {
    let server: OAuthServer;
    let users: { [username: string]: string } = {};
    let XOAUTH_PORT = 8993;

    beforeEach((t, done) => {
        server = mockServer({
            port: XOAUTH_PORT,
            onUpdate: (username, accessToken) => {
                users[username] = accessToken;
            }
        });
        server.addUser('test@example.com', 'saladus');
        server.start(done);
    });

    afterEach((t, done) => {
        server.stop(done);
    });

    it('should get an existing access token', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc',
            timeout: 3600
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'abc');
            done();
        });
    });

    it('should convert access token to XOAuth2 token', () => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            accessToken: 'abc'
        });

        assert.strictEqual(xoauth2.buildXOAuth2Token(), 'dXNlcj10ZXN0QGV4YW1wbGUuY29tAWF1dGg9QmVhcmVyIGFiYwEB');
        assert.strictEqual(xoauth2.buildXOAuth2Token('bbb'), 'dXNlcj10ZXN0QGV4YW1wbGUuY29tAWF1dGg9QmVhcmVyIGJiYgEB');
    });

    it('should get an existing access token, no timeout', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'abc');
            done();
        });
    });

    it('should generate a fresh access token', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, users['test@example.com']);
            done();
        });
    });

    it('should generate a fresh access token with custom method', (t, done) => {
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

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'zzz');
            done();
        });
    });

    it('should fail generating a fresh access token with custom method', (t, done) => {
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

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.ok(!accessToken);
            done();
        });
    });

    it('should generate a fresh access token after timeout', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            accessToken: 'abc',
            timeout: 1
        });

        setTimeout(() => {
            xoauth2.getToken(false, (err, accessToken) => {
                assert.ok(!err);
                assert.strictEqual(accessToken, users['test@example.com']);
                done();
            });
        }, 3000);
    });

    it('should emit access token update', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 3600
        });

        xoauth2.once('token', tokenData => {
            assert.ok(tokenData.expires >= Date.now() + 3000 * 1000);
            assert.deepStrictEqual(tokenData, {
                user: 'test@example.com',
                accessToken: users['test@example.com'],
                expires: tokenData.expires
            });
            done();
        });

        xoauth2.getToken(false, () => {});
    });

    it('should sign payload', () => {
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
        assert.strictEqual(
            xoauth2.jwtSignRS256({
                some: 'payload'
            }),
            'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzb21lIjoicGF5bG9hZCJ9.yBo28P5qE8t8yMkN0hC6uWstUAGh8RGW-zLe1NHdtit8ZVlAEdnhXbZvjGEfDWjOeWe1aZ2eZ65i83awWsx02G9HDsI1xMOFTHpviSHLIWnOf1D2hqJxm0On9zYRjd6oFxuRlmJtI9PIDlMJltG7K3leqReLLC6ZOAYL1Au0WY5swdG2eA6Oi83BTEckLj9c-0TYYRYtyRSG9o298Iuc8JL2KhrAbM8d62JgAPuI3hN_NgEtxs36bidt3SHbuWSszAdt1lHR-bFCZ-kXy_DAGlGiYRHRNyvsLR_q_v4GhV2oVi3WSPR816UhHrTryA0NlbanACb8T22bJGRQ708m_g'
        );
    });

    it('should handle concurrent token requests', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 1
        });

        // First call to expire the token
        await new Promise(resolve => xoauth2.getToken(false, resolve));

        // Multiple simultaneous calls after expiration
        const results = await Promise.all(
            Array.from(
                { length: 1000 },
                () =>
                    new Promise((resolve, reject) => {
                        xoauth2.getToken(false, (err, accessToken) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(accessToken);
                            }
                        });
                    })
            )
        );

        // They must all return the same valid token
        results.forEach(accessToken => {
            assert.ok(accessToken);
            assert.strictEqual(accessToken, users['test@example.com']);
        });
    });

    it('should propagate renewal errors to all concurrent requests', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'invalid',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 1
        });

        // All calls should fail with the same error
        const promises = Array.from(
            { length: 1000 },
            () =>
                new Promise((resolve, reject) => {
                    xoauth2.getToken(true, (err, accessToken) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(accessToken);
                        }
                    });
                })
        );

        await assert.rejects(() => Promise.all(promises));
    });

    it('should handle sequential token requests with varying tokens', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/',
            timeout: 1
        });

        const tokens = new Set();

        await [...Array(500).keys()].reduce(async prev => {
            await prev;
            const token = await new Promise((resolve, reject) => {
                xoauth2.getToken(true, (err, token) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(token);
                    }
                });
            });
            tokens.add(token);
        }, Promise.resolve());

        assert.strictEqual(tokens.size, 500);
    });

    it('should reuse existing token when no refresh mechanism is available', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            accessToken: 'existing_valid_token_123',
            expires: Date.now() + 3600000 // 1 hour from now
            // Note: No refreshToken, no provisionCallback, no serviceClient
        });

        // Mock logger to capture debug messages
        const debugLogs: any[] = [];
        xoauth2.logger.debug = (data: any, message: any, user: any) => {
            if (data.action === 'reuse') {
                debugLogs.push({ data, message, user });
            }
        };

        // Should reuse existing token even with renew=true
        const token = await new Promise((resolve, reject) => {
            xoauth2.getToken(true, (err, token) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(token);
                }
            });
        });

        assert.strictEqual(token, 'existing_valid_token_123');
        assert.strictEqual(debugLogs.length, 1);
        assert.strictEqual(debugLogs[0].data.action, 'reuse');
        assert.strictEqual(debugLogs[0].user, 'test@example.com');
    });

    it('should return error when no token exists and no refresh mechanism', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com'
            // Note: No accessToken, no refreshToken, no provisionCallback, no serviceClient
        });

        // Mock logger to capture error messages
        const errorLogs: any[] = [];
        xoauth2.logger.error = (data: any, message: any, user: any) => {
            if (data.action === 'renew') {
                errorLogs.push({ data, message, user });
            }
        };

        await assert.rejects(async () => {
            await new Promise((resolve, reject) => {
                xoauth2.getToken(true, (err, token) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(token);
                    }
                });
            });
        }, /Can't create new access token for user/);

        assert.strictEqual(errorLogs.length, 1);
        assert.strictEqual(errorLogs[0].data.action, 'renew');
        assert.strictEqual(errorLogs[0].user, 'test@example.com');
    });

    it('should attempt renewal when refresh mechanism is available', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'valid_refresh_token',
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/'
        });

        // Mock generateToken to track if it was called
        let generateTokenCalled = false;
        xoauth2.generateToken = callback => {
            generateTokenCalled = true;
            // Simulate successful token generation
            xoauth2.updateToken('new_generated_token', 3600);
            callback(null, 'new_generated_token');
        };

        const token = await new Promise((resolve, reject) => {
            xoauth2.getToken(true, (err, token) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(token);
                }
            });
        });

        assert.strictEqual(token, 'new_generated_token');
        assert.strictEqual(generateTokenCalled, true);
    });

    it('should use provisionCallback when available instead of refresh', async () => {
        let provisionCallbackCalled = false;

        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            provisionCallback: (user, renew, cb) => {
                provisionCallbackCalled = true;
                cb(null, 'provisioned_token', 3600);
            }
        });

        const token = await new Promise((resolve, reject) => {
            xoauth2.getToken(true, (err, token) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(token);
                }
            });
        });

        assert.strictEqual(token, 'provisioned_token');
        assert.strictEqual(provisionCallbackCalled, true);
    });

    it('should use serviceClient when available for token generation', async () => {
        const xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: 'test_service_client',
            privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
            accessUrl: 'http://localhost:' + XOAUTH_PORT + '/'
        });

        // Mock generateToken to track if it was called
        let generateTokenCalled = false;
        xoauth2.generateToken = callback => {
            generateTokenCalled = true;
            // Simulate successful token generation
            xoauth2.updateToken('service_token', 3600);
            callback(null, 'service_token');
        };

        const token = await new Promise((resolve, reject) => {
            xoauth2.getToken(true, (err, token) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(token);
                }
            });
        });

        assert.strictEqual(token, 'service_token');
        assert.strictEqual(generateTokenCalled, true);
    });
});

describe('XOAuth2 token endpoint handling', { timeout: 10000 }, () => {
    interface TokenRequest {
        headers: http.IncomingHttpHeaders;
        body: querystring.ParsedUrlQuery;
        jwt?: { header: any; payload: any };
    }

    let server: http.Server;
    let accessUrl: string;
    let lastRequest: TokenRequest | undefined;
    let keyPair: crypto.KeyPairKeyObjectResult;
    let privateKey: string;

    before(() => {
        keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        privateKey = keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    });

    beforeEach((t, done) => {
        lastRequest = undefined;
        server = http.createServer((req, res) => {
            let chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                let body = querystring.parse(Buffer.concat(chunks).toString());
                lastRequest = { headers: req.headers, body };

                let respond = (status: number, payload: string, contentType?: string) => {
                    res.writeHead(status, { 'Content-Type': contentType || 'application/json' });
                    res.end(payload);
                };

                switch (req.url) {
                    case '/not-json':
                        respond(200, 'this is not json', 'text/plain');
                        break;

                    case '/null':
                        respond(200, 'null');
                        break;

                    case '/scalar':
                        respond(200, '"just a string"');
                        break;

                    case '/error':
                        respond(
                            400,
                            JSON.stringify({
                                error: 'invalid_grant',
                                error_description: 'Token has been expired or revoked.',
                                error_uri: 'https://example.com/errors/invalid_grant'
                            })
                        );
                        break;

                    case '/error-plain':
                        respond(400, JSON.stringify({ error: 'invalid_client' }));
                        break;

                    case '/no-token':
                        respond(200, JSON.stringify({ token_type: 'Bearer' }));
                        break;

                    case '/jwt': {
                        if (body.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || typeof body.assertion !== 'string') {
                            respond(400, JSON.stringify({ error: 'unsupported_grant_type' }));
                            break;
                        }
                        let [header, payload, signature] = body.assertion.split('.');
                        let verified = crypto.verify(
                            'RSA-SHA256',
                            Buffer.from(header + '.' + payload),
                            keyPair.publicKey,
                            Buffer.from(signature, 'base64url')
                        );
                        if (!verified) {
                            respond(400, JSON.stringify({ error: 'invalid_grant' }));
                            break;
                        }
                        lastRequest.jwt = {
                            header: JSON.parse(Buffer.from(header, 'base64url').toString()),
                            payload: JSON.parse(Buffer.from(payload, 'base64url').toString())
                        };
                        respond(200, JSON.stringify({ access_token: 'jwt-token', expires_in: 3600 }));
                        break;
                    }

                    default:
                        respond(200, JSON.stringify({ access_token: 'echo-token', expires_in: 100 }));
                }
            });
        });

        server.listen(0, () => {
            accessUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
            done();
        });
    });

    afterEach((t, done) => {
        server.close(done);
    });

    it('should emit an error when a service client has no private key', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: '{Client ID}'
        });

        xoauth2.once('error', (err: any) => {
            assert.strictEqual(err.code, 'EOAUTH2');
            assert.strictEqual(err.message, 'Options "privateKey" and "user" are required for service account!');
            done();
        });
    });

    it('should emit an error when a service client has no user', (t, done) => {
        let xoauth2 = new XOAuth2({
            serviceClient: '{Client ID}',
            privateKey
        });

        xoauth2.once('error', (err: any) => {
            assert.strictEqual(err.code, 'EOAUTH2');
            done();
        });
    });

    it('should request a token with a signed JWT for a service client', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: '{Client ID}',
            privateKey,
            accessUrl: accessUrl + '/jwt'
        });
        let before = Math.floor(Date.now() / 1000);

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'jwt-token');
            assert.strictEqual(xoauth2.accessToken, 'jwt-token');

            let jwt = lastRequest!.jwt!;
            assert.deepStrictEqual(jwt.header, { alg: 'RS256', typ: 'JWT' });
            assert.strictEqual(jwt.payload.iss, '{Client ID}');
            assert.strictEqual(jwt.payload.sub, 'test@example.com');
            assert.strictEqual(jwt.payload.scope, 'https://mail.google.com/');
            assert.strictEqual(jwt.payload.aud, accessUrl + '/jwt');
            assert.ok(jwt.payload.iat >= before && jwt.payload.iat <= Math.floor(Date.now() / 1000));
            // the default lifetime is five minutes
            assert.strictEqual(jwt.payload.exp - jwt.payload.iat, 300);
            done();
        });
    });

    it('should cap the JWT lifetime at an hour and use the given scope', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: '{Client ID}',
            privateKey,
            accessUrl: accessUrl + '/jwt',
            serviceRequestTimeout: 7200,
            scope: 'https://example.com/scope'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'jwt-token');

            let payload = lastRequest!.jwt!.payload;
            assert.strictEqual(payload.scope, 'https://example.com/scope');
            assert.strictEqual(payload.exp - payload.iat, 3600);
            done();
        });
    });

    it('should fail with EOAUTH2 when the private key can not sign', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            serviceClient: '{Client ID}',
            privateKey: 'not a key',
            accessUrl: accessUrl + '/jwt'
        });

        xoauth2.getToken(true, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(err!.message, "Can't generate token. Check your auth options");
            assert.ok(!accessToken);
            // nothing was sent
            assert.strictEqual(lastRequest, undefined);
            done();
        });
    });

    it('should fail to generate a token without a refresh token', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            accessUrl: accessUrl + '/echo'
        });

        xoauth2.generateToken((err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(err!.message, "Can't create new access token for user");
            assert.ok(!accessToken);
            assert.strictEqual(lastRequest, undefined);
            done();
        });
    });

    it('should send custom headers and params with the token request', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            clientId: '{Client ID}',
            clientSecret: '{Client Secret}',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/echo',
            customHeaders: { 'x-custom': 'yes' },
            customParams: { audience: 'aud' }
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'echo-token');
            assert.strictEqual(lastRequest!.headers['x-custom'], 'yes');
            assert.strictEqual(lastRequest!.headers['content-type'], 'application/x-www-form-urlencoded');
            assert.deepStrictEqual(
                { ...lastRequest!.body },
                {
                    client_id: '{Client ID}',
                    client_secret: '{Client Secret}',
                    refresh_token: 'saladus',
                    grant_type: 'refresh_token',
                    audience: 'aud'
                }
            );
            done();
        });
    });

    it('should emit the token event with the expiry from the response', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/echo'
        });
        let before = Date.now();

        xoauth2.once('token', tokenData => {
            assert.strictEqual(tokenData.user, 'test@example.com');
            assert.strictEqual(tokenData.accessToken, 'echo-token');
            // expires_in was 100 seconds
            assert.ok(tokenData.expires >= before + 100 * 1000);
            assert.ok(tokenData.expires <= Date.now() + 100 * 1000);
            assert.strictEqual(xoauth2.expires, tokenData.expires);
            done();
        });

        xoauth2.getToken(false, () => false);
    });

    it('should treat an unparseable token lifetime as no expiry', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com'
        });
        let events: any[] = [];
        xoauth2.on('token', tokenData => events.push(tokenData));

        xoauth2.updateToken('abc', 'soon');

        assert.deepStrictEqual(events, [{ user: 'test@example.com', accessToken: 'abc', expires: 0 }]);
        assert.strictEqual(xoauth2.expires, 0);

        // a token without an expiry is reused as is
        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(!err);
            assert.strictEqual(accessToken, 'abc');
            done();
        });
    });

    it('should fail on a response that is not JSON', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/not-json'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual(err!.name, 'SyntaxError');
            assert.ok(!accessToken);
            assert.strictEqual(xoauth2.accessToken, false);
            done();
        });
    });

    it('should fail on a JSON response that is not an object', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/null'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(err!.message, 'Invalid authentication response');
            assert.ok(!accessToken);

            xoauth2.options.accessUrl = accessUrl + '/scalar';
            xoauth2.getToken(false, (err, accessToken) => {
                assert.ok(err);
                assert.strictEqual((err as any).code, 'EOAUTH2');
                assert.strictEqual(err!.message, 'Invalid authentication response');
                assert.ok(!accessToken);
                done();
            });
        });
    });

    it('should report the error description and uri from the token endpoint', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/error'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(
                err!.message,
                'invalid_grant: Token has been expired or revoked. (https://example.com/errors/invalid_grant)'
            );
            assert.ok(!accessToken);
            done();
        });
    });

    it('should report a bare error code from the token endpoint', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/error-plain'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(err!.message, 'invalid_client');
            assert.ok(!accessToken);
            done();
        });
    });

    it('should fail when the response carries no access token', (t, done) => {
        let xoauth2 = new XOAuth2({
            user: 'test@example.com',
            refreshToken: 'saladus',
            accessUrl: accessUrl + '/no-token'
        });

        xoauth2.getToken(false, (err, accessToken) => {
            assert.ok(err);
            assert.strictEqual((err as any).code, 'EOAUTH2');
            assert.strictEqual(err!.message, 'No access token');
            assert.ok(!accessToken);
            done();
        });
    });
});
