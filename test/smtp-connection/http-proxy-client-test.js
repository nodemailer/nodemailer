/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const http = require('http');
const proxy = require('proxy');
const httpProxyClient = require('../../lib/smtp-connection/http-proxy-client');
const SMTPServer = require('smtp-server').SMTPServer;
const chai = require('chai');
const expect = chai.expect;

chai.config.includeStack = true;

const PROXY_PORT = 3128;
const TARGET_PORT = 3129;

describe('HTTP Proxy Client Tests', function () {
    it('should connect to a socket through proxy', function (done) {
        let smtpServer = new SMTPServer({
            logger: false
        });

        smtpServer.listen(TARGET_PORT, () => {
            let proxyServer = proxy(http.createServer());
            proxyServer.listen(PROXY_PORT, () => {
                httpProxyClient('http://localhost:' + PROXY_PORT, TARGET_PORT, '127.0.0.1', (err, socket) => {
                    expect(err).to.not.exist;
                    socket.once('data', chunk => {
                        expect(/^220[ -]/.test(chunk.toString())).to.be.true;
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
    it('should connect to a socket through proxy with auth', function (done) {
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
                    expect(err).to.not.exist;
                    socket.once('data', chunk => {
                        expect(/^220[ -]/.test(chunk.toString())).to.be.true;
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

    it('should should fail auth', function (done) {
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
                    expect(err).to.exist;
                    expect(socket).to.not.exist;

                    smtpServer.close(() => setImmediate(done) && proxyServer.close());
                });
            });
        });
    });
});
