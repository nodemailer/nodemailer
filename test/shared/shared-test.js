/* eslint no-unused-expressions:0, no-invalid-this:0, prefer-arrow-callback: 0 */
/* globals beforeEach, afterEach, describe, it, before */

'use strict';

const chai = require('chai');
const expect = chai.expect;
const shared = require('../../lib/shared');

const http = require('http');
const fs = require('fs');
const zlib = require('zlib');

chai.config.includeStack = true;

describe('Shared Funcs Tests', function () {
    this.timeout(100 * 1000); // eslint-disable-line no-invalid-this

    describe('Logger tests', function () {
        it('Should create a logger', function () {
            expect(
                typeof shared.getLogger({
                    logger: false
                })
            ).to.equal('object');
            expect(
                typeof shared.getLogger({
                    logger: true
                })
            ).to.equal('object');
            expect(typeof shared.getLogger()).to.equal('object');
        });
    });

    describe('Connection url parser tests', function () {
        it('Should parse connection url', function () {
            let url = 'smtps://user:pass@localhost:123?tls.rejectUnauthorized=false&name=horizon';
            expect(shared.parseConnectionUrl(url)).to.deep.equal({
                secure: true,
                port: 123,
                host: 'localhost',
                auth: {
                    user: 'user',
                    pass: 'pass'
                },
                tls: {
                    rejectUnauthorized: false
                },
                name: 'horizon'
            });
        });

        it('should not choke on special symbols in auth', function () {
            let url = 'smtps://user%40gmail.com:%3Apasswith%25Char@smtp.gmail.com';
            expect(shared.parseConnectionUrl(url)).to.deep.equal({
                secure: true,
                host: 'smtp.gmail.com',
                auth: {
                    user: 'user@gmail.com',
                    pass: ':passwith%Char'
                }
            });
        });
    });

    describe('Resolver tests', function () {
        let port = 10337;
        let server;

        beforeEach(function (done) {
            server = http.createServer(function (req, res) {
                if (/redirect/.test(req.url)) {
                    res.writeHead(302, {
                        Location: 'http://localhost:' + port + '/message.html'
                    });
                    res.end('Go to http://localhost:' + port + '/message.html');
                } else if (/compressed/.test(req.url)) {
                    res.writeHead(200, {
                        'Content-Type': 'text/plain',
                        'Content-Encoding': 'gzip'
                    });
                    let stream = zlib.createGzip();
                    stream.pipe(res);
                    stream.write('<p>Tere, tere</p><p>vana kere!</p>\n');
                    stream.end();
                } else {
                    res.writeHead(200, {
                        'Content-Type': 'text/plain'
                    });
                    res.end('<p>Tere, tere</p><p>vana kere!</p>\n');
                }
            });

            server.listen(port, done);
        });

        afterEach(function (done) {
            server.close(done);
        });

        it('should set text from html string', function (done) {
            let mail = {
                data: {
                    html: '<p>Tere, tere</p><p>vana kere!</p>\n'
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.equal('<p>Tere, tere</p><p>vana kere!</p>\n');
                done();
            });
        });

        it('should set text from html buffer', function (done) {
            let mail = {
                data: {
                    html: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(mail.data.html);
                done();
            });
        });

        it('should set text from a html file', function (done) {
            let mail = {
                data: {
                    html: {
                        path: __dirname + '/fixtures/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from an html url', function (done) {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from redirecting url', function (done) {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/redirect.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from gzipped url', function (done) {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/compressed.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from a html stream', function (done) {
            let mail = {
                data: {
                    html: fs.createReadStream(__dirname + '/fixtures/message.html')
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(mail).to.deep.equal({
                    data: {
                        html: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                    }
                });
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set content from a stream and preserve other properties', function (done) {
            let mail = {
                data: {
                    attachment: {
                        filename: 'message.html',
                        content: fs.createReadStream(__dirname + '/fixtures/message.html')
                    }
                }
            };
            shared.resolveContent(mail.data, 'attachment', function (err, value) {
                expect(err).to.not.exist;
                expect(mail).to.deep.equal({
                    data: {
                        attachment: {
                            filename: 'message.html',
                            content: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                        }
                    }
                });
                expect(value).to.deep.equal(Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should return an error', function (done) {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + (port + 1000) + '/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err) {
                expect(err).to.exist;
                done();
            });
        });

        it('should return encoded string as buffer', function (done) {
            let str = '<p>Tere, tere</p><p>vana kere!</p>\n';
            let mail = {
                data: {
                    html: {
                        encoding: 'base64',
                        content: Buffer.from(str).toString('base64')
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', function (err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(Buffer.from(str));
                done();
            });
        });

        describe('data uri tests', function () {
            it('should resolve with mime type and base64', function (done) {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', function (err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(
                        Buffer.from(
                            'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
                            'base64'
                        )
                    );
                    done();
                });
            });

            it('should resolve with mime type and plaintext', function (done) {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png,tere%20tere'
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', function (err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(Buffer.from('tere tere'));
                    done();
                });
            });

            it('should resolve with plaintext', function (done) {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:,tere%20tere'
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', function (err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(Buffer.from('tere tere'));
                    done();
                });
            });

            it('should resolve with mime type, charset and base64', function (done) {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;charset=iso-8859-1;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', function (err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(
                        Buffer.from(
                            'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
                            'base64'
                        )
                    );
                    done();
                });
            });
        });
    });

    describe('#assign tests', function () {
        it('should assign multiple objects to target', function () {
            let target = {
                a: 1,
                b: 2,
                c: 3
            };
            let arg1 = {
                b: 5,
                y: 66,
                e: 33
            };

            let arg2 = {
                y: 17,
                qq: 98
            };

            shared.assign(target, arg1, arg2);
            expect(target).to.deep.equal({
                a: 1,
                b: 5,
                c: 3,
                y: 17,
                e: 33,
                qq: 98
            });
        });
    });

    describe('#encodeXText tests', function () {
        it('should not encode atom', function () {
            expect(shared.encodeXText('teretere')).to.equal('teretere');
        });

        it('should not encode email', function () {
            expect(shared.encodeXText('andris.reinman@gmail.com')).to.equal('andris.reinman@gmail.com');
        });

        it('should encode space', function () {
            expect(shared.encodeXText('tere tere')).to.equal('tere+20tere');
        });

        it('should encode unicode', function () {
            expect(shared.encodeXText('tere tõre')).to.equal('tere+20t+C3+B5re');
        });

        it('should encode low codes', function () {
            expect(shared.encodeXText('tere t\tre')).to.equal('tere+20t+09re');
        });
    });

    describe('#resolveHostname tests', function () {
        let networkInterfaces;

        before(function (done) {
            networkInterfaces = JSON.parse(JSON.stringify(shared.networkInterfaces));
            done();
        });

        beforeEach(function (done) {
            shared.dnsCache.clear();

            done();
        });

        afterEach(function (done) {
            // reset network interfaces
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            Object.keys(networkInterfaces).forEach(key => {
                shared.networkInterfaces[key] = networkInterfaces[key];
            });

            done();
        });

        it('should resolve a single IPv4 entry', function (done) {
            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result) => {
                expect(err).to.not.exist;
                expect(result).to.deep.equal({
                    servername: 'ipv4.single.dev.ethereal.email',
                    host: '54.36.85.114',
                    cached: false
                });
                shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result) => {
                    expect(err).to.not.exist;
                    expect(result).to.deep.equal({
                        servername: 'ipv4.single.dev.ethereal.email',
                        host: '54.36.85.114',
                        cached: true
                    });
                    done();
                });
            });
        });

        it('should resolve multiple IPv4 entries', function (done) {
            let found = new Set();
            let count = 0;

            let resolveNext = () => {
                if (count++ > 100) {
                    expect(new Error('too many tries')).to.not.exist;
                    return done();
                }

                if (found.size === 3) {
                    return done();
                }

                shared.resolveHostname({ host: 'ipv4.multi.dev.ethereal.email', dnsTtl: 1 }, (err, result) => {
                    expect(err).to.not.exist;

                    expect(result.servername).to.equal('ipv4.multi.dev.ethereal.email');
                    expect(result.host).to.exist;

                    found.add(result.host);

                    setTimeout(resolveNext, 10);
                });
            };

            resolveNext();
        });

        it('should resolve a single IPv6 entry', function (done) {
            // ensure that there is a single Ipv6 interface "available"
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            shared.networkInterfaces.en0 = [
                {
                    address: 'fe80::184e:7a8e:2d67:be86',
                    netmask: 'ffff:ffff:ffff:ffff::',
                    family: 'IPv6',
                    mac: 'f0:18:98:57:76:44',
                    internal: false,
                    cidr: 'fe80::184e:7a8e:2d67:be86/64',
                    scopeid: 6
                }
            ];

            shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, (err, result) => {
                expect(err).to.not.exist;
                expect(result).to.deep.equal({
                    servername: 'ipv6.single.dev.ethereal.email',
                    host: '2001:41d0:304:200::baa9',
                    cached: false
                });
                shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, (err, result) => {
                    expect(err).to.not.exist;
                    expect(result).to.deep.equal({
                        servername: 'ipv6.single.dev.ethereal.email',
                        host: '2001:41d0:304:200::baa9',
                        cached: true
                    });
                    done();
                });
            });
        });

        it('should fail resolving a single IPv6 entry', function (done) {
            // ensure that there is a single Ipv4 interface "available"
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            shared.networkInterfaces.en0 = [
                {
                    address: '192.168.1.175',
                    netmask: '255.255.255.0',
                    family: 'IPv4',
                    mac: 'f0:18:98:57:76:44',
                    internal: false,
                    cidr: '192.168.1.175/24'
                }
            ];

            shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, err => {
                expect(err).to.exist;
                done();
            });
        });

        it('should fail missing address', function (done) {
            shared.resolveHostname({ host: 'missing.single.dev.ethereal.email' }, err => {
                expect(err).to.exist;
                done();
            });
        });

        it('should return provided IP', function (done) {
            shared.resolveHostname({ host: '1.2.3.4', servername: 'example.com' }, (err, result) => {
                expect(err).to.not.exist;
                expect(result).to.deep.equal({
                    servername: 'example.com',
                    host: '1.2.3.4',
                    cached: false
                });
                done();
            });
        });
    });
});
