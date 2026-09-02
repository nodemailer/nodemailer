import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import HttpConnectProxy from 'proxy-test-server';
import { createHttpsProxy } from '../smtp-connection/https-connect-proxy.js';
import nodemailer from '../../src/nodemailer.js';
import type { SendMailOptions } from '../../src/nodemailer.js';

// Self-signed cert reused from test/fetch/nmfetch-test.js, keeps this test
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

// connects to the SMTP server and hands the open socket over, the way a socks module does
function openSocket(host: string, port: number, callback: (err: Error | null, socket?: net.Socket) => void): void {
    const socket = net.connect(port, host);
    socket.once('error', err => callback(err));
    socket.once('connect', () => callback(null, socket));
}

describe('Mail proxy setup', { timeout: 10000 }, () => {
    let server: any;
    let smtpPort: number;
    const proxied = (proxy: string, extra: { [key: string]: any } = {}) =>
        nodemailer.createTransport({ host: '127.0.0.1', port: smtpPort, proxy, ...extra });
    let delivered: string[];

    const message = (): SendMailOptions => ({ from: 'sender@example.com', to: 'rcpt@example.com', subject: 'proxied', text: 'hello' });

    before((t, done) => {
        delivered = [];
        server = new SMTPServer({
            disabledCommands: ['STARTTLS', 'AUTH'],
            onData(stream: any, session: any, callback: any) {
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => {
                    delivered.push(Buffer.concat(chunks).toString());
                    callback();
                });
            }
        });
        server.listen(0, '127.0.0.1', () => {
            smtpPort = server.server.address().port;
            done();
        });
    });

    after((t, done) => {
        server.close(done);
    });

    describe('http CONNECT proxy', () => {
        it('should connect through the proxy and deliver the message', (t, done) => {
            const proxy = new HttpConnectProxy();
            const connects: { port: number; host: string }[] = [];
            proxy.on('connect', (port: number, host: string) => connects.push({ port, host }));

            proxy.listen(0, () => {
                const proxyPort = proxy.server.address().port;
                const transporter = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: smtpPort,
                    proxy: 'http://127.0.0.1:' + proxyPort
                });

                transporter.sendMail(message(), (err, info) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                    assert.deepStrictEqual(connects, [{ port: smtpPort, host: '127.0.0.1' }]);
                    assert.ok(delivered.some(raw => raw.includes('Subject: proxied')));
                    // the socket handler moved from the mailer to the transport
                    assert.strictEqual(transporter.getSocket, false);
                    assert.strictEqual(typeof transporter.transporter.getSocket, 'function');
                    proxy.close(done);
                });
            });
        });

        it('should connect a pooled transport through the proxy', (t, done) => {
            const proxy = new HttpConnectProxy();
            const connects: { port: number; host: string }[] = [];
            proxy.on('connect', (port: number, host: string) => connects.push({ port, host }));

            proxy.listen(0, () => {
                const proxyPort = proxy.server.address().port;
                const transporter = nodemailer.createTransport({
                    pool: true,
                    host: '127.0.0.1',
                    port: smtpPort,
                    proxy: 'http://127.0.0.1:' + proxyPort
                });

                transporter.sendMail(message(), (err, info) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                    assert.deepStrictEqual(connects, [{ port: smtpPort, host: '127.0.0.1' }]);
                    transporter.close();
                    proxy.close(done);
                });
            });
        });

        it('should report a proxy that refuses the CONNECT request', (t, done) => {
            const proxy = net.createServer(socket => {
                socket.on('error', () => {});
                socket.once('data', () => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
            });

            proxy.listen(0, '127.0.0.1', () => {
                const proxyPort = (proxy.address() as AddressInfo).port;
                const transporter = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: smtpPort,
                    proxy: 'http://127.0.0.1:' + proxyPort
                });

                transporter.sendMail(message(), (err: any) => {
                    assert.ok(err);
                    assert.strictEqual(err.code, 'EPROXY');
                    assert.strictEqual(err.message, 'Invalid response from proxy: 403');
                    proxy.close(done);
                });
            });
        });

        it('should reject an https proxy with an untrusted certificate by default', (t, done) => {
            createHttpsProxy(httpsOptions, 0, (proxy, proxyPort) => {
                const transporter = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: smtpPort,
                    proxy: 'https://localhost:' + proxyPort
                });

                transporter.sendMail(message(), (err: any) => {
                    assert.ok(err, 'expected a TLS error');
                    assert.ok(/certificate|self.?signed/i.test(err.message), 'unexpected error: ' + err.message);
                    proxy.close(done);
                });
            });
        });

        it('should connect through an https proxy when tls.rejectUnauthorized is false', (t, done) => {
            createHttpsProxy(httpsOptions, 0, (proxy, proxyPort) => {
                const transporter = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: smtpPort,
                    proxy: 'https://localhost:' + proxyPort,
                    tls: { rejectUnauthorized: false }
                });

                transporter.sendMail(message(), (err, info) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                    proxy.close(done);
                });
            });
        });
    });

    describe('socks proxy', () => {
        it('should fail when no socks module is loaded', (t, done) => {
            const transporter = proxied('socks5://127.0.0.1:1080');

            transporter.sendMail(message(), (err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EPROXY');
                assert.strictEqual(err.message, 'Socks module not loaded');
                done();
            });
        });

        it('should pass the decoded credentials to a socks v2 module', (t, done) => {
            // decoded once, a colon in the user name or a percent sign in the password stays
            let seen: any;
            const transporter = proxied('socks5://us%3Aer:pa%25ss%3Aword@127.0.0.1:1080');

            transporter.set('proxy_socks_module', {
                SocksClient: {
                    createConnection(options: any, callback: (err: Error | null, info?: any) => void) {
                        seen = options;
                        openSocket(options.destination.host, options.destination.port, (err, socket) => callback(err, { socket }));
                    }
                }
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.deepStrictEqual(seen, {
                    proxy: { ipaddress: '127.0.0.1', port: 1080, type: 5, userId: 'us:er', password: 'pa%ss:word' },
                    destination: { host: '127.0.0.1', port: smtpPort },
                    command: 'connect'
                });
                done();
            });
        });

        it('should connect through a socks v1 module with password authentication', (t, done) => {
            let seen: any;
            const transporter = proxied('socks5://user:secret@127.0.0.1:1080');

            transporter.set('proxy_socks_module', {
                createConnection(options: any, callback: (err: Error | null, socket?: net.Socket) => void) {
                    seen = options;
                    openSocket(options.target.host, options.target.port, callback);
                }
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.deepStrictEqual(seen, {
                    proxy: { ipaddress: '127.0.0.1', port: 1080, type: 5 },
                    target: { host: '127.0.0.1', port: smtpPort },
                    command: 'connect',
                    authentication: { username: 'user', password: 'secret' }
                });
                done();
            });
        });

        it('should pass only the user id to a socks4 proxy', (t, done) => {
            let seen: any;
            const transporter = proxied('socks4://user:secret@127.0.0.1:1080');

            transporter.set('proxy_socks_module', {
                createConnection(options: any, callback: (err: Error | null, socket?: net.Socket) => void) {
                    seen = options;
                    openSocket(options.target.host, options.target.port, callback);
                }
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.deepStrictEqual(seen, {
                    proxy: { ipaddress: '127.0.0.1', port: 1080, type: 4 },
                    target: { host: '127.0.0.1', port: smtpPort },
                    command: 'connect',
                    userid: 'user'
                });
                done();
            });
        });

        it('should default to socks5 without credentials for a bare socks url', (t, done) => {
            let seen: any;
            const transporter = proxied('socks://127.0.0.1:1080');

            transporter.set('proxy_socks_module', {
                createConnection(options: any, callback: (err: Error | null, socket?: net.Socket) => void) {
                    seen = options;
                    openSocket(options.target.host, options.target.port, callback);
                }
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.deepStrictEqual(seen, {
                    proxy: { ipaddress: '127.0.0.1', port: 1080, type: 5 },
                    target: { host: '127.0.0.1', port: smtpPort },
                    command: 'connect'
                });
                done();
            });
        });

        it('should resolve the proxy hostname before connecting', (t, done) => {
            let seen: any;
            const resolved: string[] = [];
            t.mock.method(dns, 'resolve', (hostname: string, callback: (err: Error | null, addresses?: string[]) => void) => {
                resolved.push(hostname);
                setImmediate(() => callback(null, ['127.0.0.1', '127.0.0.2']));
            });

            const transporter = proxied('socks5://proxy.example:1080');

            transporter.set('proxy_socks_module', {
                createConnection(options: any, callback: (err: Error | null, socket?: net.Socket) => void) {
                    seen = options;
                    openSocket(options.target.host, options.target.port, callback);
                }
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.deepStrictEqual(resolved, ['proxy.example']);
                // the first resolved address is the one used
                assert.deepStrictEqual(seen.proxy, { ipaddress: '127.0.0.1', port: 1080, type: 5 });
                done();
            });
        });

        it('should fail when the proxy hostname does not resolve', (t, done) => {
            const failure: any = new Error('queryA ENOTFOUND proxy.invalid');
            failure.code = 'ENOTFOUND';
            t.mock.method(dns, 'resolve', (hostname: string, callback: (err: Error | null) => void) => {
                setImmediate(() => callback(failure));
            });

            const transporter = proxied('socks5://proxy.invalid:1080');

            let connections = 0;
            transporter.set('proxy_socks_module', {
                createConnection() {
                    connections++;
                }
            });

            transporter.sendMail(message(), (err: any) => {
                assert.strictEqual(err, failure);
                assert.strictEqual(connections, 0);
                done();
            });
        });

        it('should pass a socks connection error on', (t, done) => {
            const failure: any = new Error('Proxy connection refused');
            failure.code = 'ECONNREFUSED';
            const transporter = proxied('socks5://127.0.0.1:1080');

            transporter.set('proxy_socks_module', {
                createConnection(options: any, callback: (err: Error | null) => void) {
                    setImmediate(() => callback(failure));
                }
            });

            transporter.sendMail(message(), (err: any) => {
                assert.strictEqual(err, failure);
                done();
            });
        });
    });

    describe('custom proxy handlers', () => {
        it('should use the handler registered for the proxy protocol', (t, done) => {
            let seen: any;
            const transporter = proxied('myproto://gateway.example:9000');

            transporter.set('proxy_handler_myproto', (proxy, options, callback) => {
                seen = { proxy, host: options.host, port: options.port };
                openSocket('127.0.0.1', smtpPort, (err, socket) => (err ? callback(err) : callback(null, { connection: socket })));
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.strictEqual(seen.proxy.protocol, 'myproto:');
                assert.strictEqual(seen.proxy.hostname, 'gateway.example');
                assert.strictEqual(seen.proxy.port, '9000');
                assert.strictEqual(seen.host, '127.0.0.1');
                assert.strictEqual(seen.port, smtpPort);
                done();
            });
        });

        it('should prefer a registered handler over the built-in http one', (t, done) => {
            let calls = 0;
            const transporter = nodemailer.createTransport({
                host: '127.0.0.1',
                port: smtpPort,
                // nothing listens here, so a CONNECT attempt would fail the send
                proxy: 'http://127.0.0.1:1'
            });

            transporter.set('proxy_handler_http', (proxy, options, callback) => {
                calls++;
                openSocket('127.0.0.1', smtpPort, (err, socket) => (err ? callback(err) : callback(null, { connection: socket })));
            });

            transporter.sendMail(message(), (err, info) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.accepted, ['rcpt@example.com']);
                assert.strictEqual(calls, 1);
                done();
            });
        });

        it('should pass a handler error on', (t, done) => {
            const failure = new Error('gateway down');
            const transporter = proxied('myproto://gateway.example:9000');

            transporter.set('proxy_handler_myproto', (proxy, options, callback) => setImmediate(() => callback(failure)));

            transporter.sendMail(message(), (err: any) => {
                assert.strictEqual(err, failure);
                done();
            });
        });

        it('should fail for a proxy protocol nothing handles', (t, done) => {
            const transporter = proxied('ftp://127.0.0.1:21');

            transporter.sendMail(message(), (err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EPROXY');
                assert.strictEqual(err.message, 'Unknown proxy configuration');
                done();
            });
        });
    });
});
