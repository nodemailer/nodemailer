'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const proxy = require('proxy');
const httpProxyClient = require('../../lib/smtp-connection/http-proxy-client');
const SMTPServer = require('smtp-server').SMTPServer;

const PROXY_PORT = 3128;
const TARGET_PORT = 3129;

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
});
