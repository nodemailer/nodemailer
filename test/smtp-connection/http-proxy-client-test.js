'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const proxy = require('proxy');
const httpProxyClient = require('../../lib/smtp-connection/http-proxy-client');
const SMTPServer = require('smtp-server').SMTPServer;

const PROXY_PORT = 3128;
const TARGET_PORT = 3129;

// Self-signed cert reused from test/fetch/nmfetch-test.js — keeps this test
// self-contained per the repo's per-file-copy convention.
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

// Minimal HTTPS CONNECT proxy with the self-signed cert above.
function createHttpsProxy(callback) {
    const proxyServer = https.createServer(httpsOptions);
    proxyServer.on('connect', (req, clientSocket, head) => {
        const parts = req.url.split(':');
        const port = Number(parts.pop());
        const host = parts.join(':') || '127.0.0.1';
        const serverSocket = net.connect(port, host, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) {
                serverSocket.write(head);
            }
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });
        serverSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => serverSocket.destroy());
    });
    proxyServer.listen(PROXY_PORT, () => callback(proxyServer));
}

describe('HTTP Proxy Client Tests', { timeout: 10 * 1000 }, () => {
    it('should connect to a socket through proxy', (t, done) => {
        let smtpServer = new SMTPServer({
            logger: false
        });

        smtpServer.listen(TARGET_PORT, () => {
            let proxyServer = proxy(http.createServer());
            proxyServer.listen(PROXY_PORT, () => {
                httpProxyClient('http://localhost:' + PROXY_PORT, TARGET_PORT, '127.0.0.1', (err, socket) => {
                    assert.ok(!err);
                    socket.once('data', chunk => {
                        assert.strictEqual(/^220[ -]/.test(chunk.toString()), true);
                        socket.end();
                        socket.on('close', () => {
                            socket.destroy();
                            smtpServer.close(() => setImmediate(done) && proxyServer.close());
                        });
                    });
                });
            });
        });
    });
    it('should connect to a socket through proxy with auth', (t, done) => {
        let smtpServer = new SMTPServer({
            logger: false
        });

        smtpServer.listen(TARGET_PORT, () => {
            let proxyServer = proxy(http.createServer());
            proxyServer.authenticate = (req, cb) => {
                cb(null, req.headers['proxy-authorization'] === 'Basic dGVzdDpwZXN0');
            };
            proxyServer.listen(PROXY_PORT, () => {
                httpProxyClient('http://test:pest@localhost:' + PROXY_PORT, TARGET_PORT, '127.0.0.1', (err, socket) => {
                    assert.ok(!err);
                    socket.once('data', chunk => {
                        assert.strictEqual(/^220[ -]/.test(chunk.toString()), true);
                        socket.end();
                        socket.on('close', () => {
                            socket.destroy();
                            smtpServer.close(() => setImmediate(done) && proxyServer.close());
                        });
                    });
                });
            });
        });
    });

    it('should should fail auth', (t, done) => {
        let smtpServer = new SMTPServer({
            logger: false
        });

        smtpServer.listen(TARGET_PORT, () => {
            let proxyServer = proxy(http.createServer());
            proxyServer.authenticate = (req, cb) => {
                cb(null, req.headers['proxy-authorization'] === 'Basic dGVzdDpwZXN0');
            };
            proxyServer.listen(PROXY_PORT, () => {
                httpProxyClient('http://test:kest@localhost:' + PROXY_PORT, TARGET_PORT, '127.0.0.1', (err, socket) => {
                    assert.ok(err);
                    assert.ok(!socket);

                    smtpServer.close(() => setImmediate(done) && proxyServer.close());
                });
            });
        });
    });

    it('should reject an HTTPS proxy with a self-signed cert by default', (t, done) => {
        createHttpsProxy(proxyServer => {
            // no tls options → the proxy's TLS certificate must be validated
            httpProxyClient('https://localhost:' + PROXY_PORT, TARGET_PORT, '127.0.0.1', (err, socket) => {
                assert.ok(err);
                assert.ok(!socket);
                proxyServer.close(done);
            });
        });
    });

    it('should connect through an HTTPS proxy when rejectUnauthorized is false', (t, done) => {
        let smtpServer = new SMTPServer({
            logger: false
        });

        smtpServer.listen(TARGET_PORT, () => {
            createHttpsProxy(proxyServer => {
                httpProxyClient(
                    'https://localhost:' + PROXY_PORT,
                    TARGET_PORT,
                    '127.0.0.1',
                    { rejectUnauthorized: false },
                    (err, socket) => {
                        assert.ok(!err);
                        socket.once('data', chunk => {
                            assert.strictEqual(/^220[ -]/.test(chunk.toString()), true);
                            socket.end();
                            socket.on('close', () => {
                                socket.destroy();
                                smtpServer.close(() => proxyServer.close(done));
                            });
                        });
                    }
                );
            });
        });
    });

    it('should fail with timeout', (t, done) => {
        let proxyServer = proxy(http.createServer());
        proxyServer.authenticate = (req, cb) => {
            cb(null, req.headers['proxy-authorization'] === 'Basic dGVzdDpwZXN0');
        };
        proxyServer.listen(PROXY_PORT, () => {
            httpProxyClient.timeout = 5 * 1000;
            // using kreata.ee (178.33.49.65) as the destination. This port is not allowed by firewall so it times out
            httpProxyClient('http://test:pest@localhost:' + PROXY_PORT, 12345, '178.33.49.65', (err, socket) => {
                assert.ok(err);
                assert.ok(!socket);
                assert.strictEqual(err.code, 'ETIMEDOUT');

                setImmediate(done) && proxyServer.close();
            });
        });
    });

    it('should reject a destination host containing CRLF (request smuggling)', (t, done) => {
        httpProxyClient('http://127.0.0.1:9/', 25, 'target.example.com\r\nX-Injected: smuggled', {}, (err, socket) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'EPROXY');
            assert.ok(!socket);
            done();
        });
    });

    it('should reject a destination port containing CRLF', (t, done) => {
        httpProxyClient('http://127.0.0.1:9/', '25\r\nX-Injected: 1', 'mail.example.com', {}, (err, socket) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'EPROXY');
            assert.ok(!socket);
            done();
        });
    });
});
