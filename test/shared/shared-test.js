'use strict';

const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../../lib/shared');

const http = require('http');
const fs = require('fs');
const zlib = require('zlib');

describe('Shared Funcs Tests', { timeout: 100 * 1000 }, () => {
    describe('Logger tests', () => {
        it('Should create a logger', () => {
            assert.strictEqual(
                typeof shared.getLogger({
                    logger: false
                }),
                'object'
            );
            assert.strictEqual(
                typeof shared.getLogger({
                    logger: true
                }),
                'object'
            );
            assert.strictEqual(typeof shared.getLogger(), 'object');
        });
    });

    describe('Connection url parser tests', () => {
        it('Should parse connection url', () => {
            let url = 'smtps://user:pass@localhost:123?tls.rejectUnauthorized=false&name=horizon';
            assert.deepStrictEqual(shared.parseConnectionUrl(url), {
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

        it('should not choke on special symbols in auth', () => {
            let url = 'smtps://user%40gmail.com:%3Apasswith%25Char@smtp.gmail.com';
            assert.deepStrictEqual(shared.parseConnectionUrl(url), {
                secure: true,
                host: 'smtp.gmail.com',
                auth: {
                    user: 'user@gmail.com',
                    pass: ':passwith%Char'
                }
            });
        });
    });

    describe('Resolver tests', () => {
        let port = 10337;
        let server;

        beforeEach((t, done) => {
            server = http.createServer((req, res) => {
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

        afterEach((t, done) => {
            server.close(done);
        });

        it('should set text from html string', (t, done) => {
            let mail = {
                data: {
                    html: '<p>Tere, tere</p><p>vana kere!</p>\n'
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.strictEqual(value, '<p>Tere, tere</p><p>vana kere!</p>\n');
                done();
            });
        });

        it('should set text from html buffer', (t, done) => {
            let mail = {
                data: {
                    html: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, mail.data.html);
                done();
            });
        });

        it('should set text from a html file', (t, done) => {
            let mail = {
                data: {
                    html: {
                        path: __dirname + '/fixtures/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from an html url', (t, done) => {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from redirecting url', (t, done) => {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/redirect.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from gzipped url', (t, done) => {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/compressed.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set text from a html stream', (t, done) => {
            let mail = {
                data: {
                    html: fs.createReadStream(__dirname + '/fixtures/message.html')
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(mail, {
                    data: {
                        html: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                    }
                });
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should set content from a stream and preserve other properties', (t, done) => {
            let mail = {
                data: {
                    attachment: {
                        filename: 'message.html',
                        content: fs.createReadStream(__dirname + '/fixtures/message.html')
                    }
                }
            };
            shared.resolveContent(mail.data, 'attachment', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(mail, {
                    data: {
                        attachment: {
                            filename: 'message.html',
                            content: Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n')
                        }
                    }
                });
                assert.deepStrictEqual(value, Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n'));
                done();
            });
        });

        it('should return an error', (t, done) => {
            let mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + (port + 1000) + '/message.html'
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', err => {
                assert.ok(err);
                done();
            });
        });

        it('should return encoded string as buffer', (t, done) => {
            let str = '<p>Tere, tere</p><p>vana kere!</p>\n';
            let mail = {
                data: {
                    html: {
                        encoding: 'base64',
                        content: Buffer.from(str).toString('base64')
                    }
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(!err);
                assert.deepStrictEqual(value, Buffer.from(str));
                done();
            });
        });

        describe('data uri tests', () => {
            it('should resolve with mime type and base64', (t, done) => {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', (err, value) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(
                        value,
                        Buffer.from(
                            'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
                            'base64'
                        )
                    );
                    done();
                });
            });

            it('should resolve with mime type and plaintext', (t, done) => {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png,tere%20tere'
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', (err, value) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(value, Buffer.from('tere tere'));
                    done();
                });
            });

            it('should resolve with plaintext', (t, done) => {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:,tere%20tere'
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', (err, value) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(value, Buffer.from('tere tere'));
                    done();
                });
            });

            it('should resolve with mime type, charset and base64', (t, done) => {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;charset=iso-8859-1;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', (err, value) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(
                        value,
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

    describe('#assign tests', () => {
        it('should assign multiple objects to target', () => {
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
            assert.deepStrictEqual(target, {
                a: 1,
                b: 5,
                c: 3,
                y: 17,
                e: 33,
                qq: 98
            });
        });
    });

    describe('#encodeXText tests', () => {
        it('should not encode atom', () => {
            assert.strictEqual(shared.encodeXText('teretere'), 'teretere');
        });

        it('should not encode email', () => {
            assert.strictEqual(shared.encodeXText('andris.reinman@gmail.com'), 'andris.reinman@gmail.com');
        });

        it('should encode space', () => {
            assert.strictEqual(shared.encodeXText('tere tere'), 'tere+20tere');
        });

        it('should encode unicode', () => {
            assert.strictEqual(shared.encodeXText('tere tõre'), 'tere+20t+C3+B5re');
        });

        it('should encode low codes', () => {
            assert.strictEqual(shared.encodeXText('tere t\tre'), 'tere+20t+09re');
        });
    });

    describe('#resolveHostname tests', () => {
        let networkInterfaces;

        before((t, done) => {
            networkInterfaces = JSON.parse(JSON.stringify(shared.networkInterfaces));
            done();
        });

        beforeEach((t, done) => {
            shared.dnsCache.clear();

            done();
        });

        afterEach((t, done) => {
            // reset network interfaces
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            Object.keys(networkInterfaces).forEach(key => {
                shared.networkInterfaces[key] = networkInterfaces[key];
            });
            done();
        });

        it('should resolve a single IPv4 entry', (t, done) => {
            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: 'ipv4.single.dev.ethereal.email',
                    host: '95.216.108.161',
                    cached: false
                });
                shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(result, {
                        servername: 'ipv4.single.dev.ethereal.email',
                        host: '95.216.108.161',
                        cached: true
                    });
                    done();
                });
            });
        });

        it('should resolve multiple IPv4 entries', (t, done) => {
            let found = new Set();
            let count = 0;

            let resolveNext = () => {
                if (count++ > 100) {
                    assert.ok(!new Error('too many tries'));
                    return done();
                }

                if (found.size === 3) {
                    return done();
                }

                shared.resolveHostname({ host: 'ipv4.multi.dev.ethereal.email', dnsTtl: 1 }, (err, result) => {
                    assert.ok(!err);

                    assert.strictEqual(result.servername, 'ipv4.multi.dev.ethereal.email');
                    assert.ok(result.host);

                    found.add(result.host);

                    setTimeout(resolveNext, 10);
                });
            };

            resolveNext();
        });

        it('should resolve a single IPv6 entry', (t, done) => {
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
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: 'ipv6.single.dev.ethereal.email',
                    host: '2a01:4f9:3051:4501::2',
                    cached: false
                });
                shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, (err, result) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(result, {
                        servername: 'ipv6.single.dev.ethereal.email',
                        host: '2a01:4f9:3051:4501::2',
                        cached: true
                    });
                    done();
                });
            });
        });

        it('should fail missing address', (t, done) => {
            shared.resolveHostname({ host: 'missing.single.dev.ethereal.email' }, err => {
                assert.ok(err);
                done();
            });
        });

        it('should return provided IP', (t, done) => {
            shared.resolveHostname({ host: '1.2.3.4', servername: 'example.com' }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: 'example.com',
                    host: '1.2.3.4',
                    cached: false
                });
                done();
            });
        });

        it('should fail resolving a single internal IPv4 entry', (t, done) => {
            // ensure that there is a single Ipv4 interface "available"
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            shared.networkInterfaces.lo = [
                {
                    address: '127.0.0.1',
                    netmask: '255.0.0.0',
                    family: 'IPv4',
                    mac: '00:00:00:00:00:00',
                    internal: true,
                    cidr: '127.0.0.1/8'
                }
            ];

            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: 'ipv4.single.dev.ethereal.email',
                    host: 'ipv4.single.dev.ethereal.email',
                    cached: false
                });
                done();
            });
        });

        it('should succeed resolving a single internal IPv4 entry', (t, done) => {
            // ensure that there is a single Ipv4 interface "available"
            Object.keys(shared.networkInterfaces).forEach(key => {
                delete shared.networkInterfaces[key];
            });

            shared.networkInterfaces.lo = [
                {
                    address: '127.0.0.1',
                    netmask: '255.0.0.0',
                    family: 'IPv4',
                    mac: '00:00:00:00:00:00',
                    internal: true,
                    cidr: '127.0.0.1/8'
                }
            ];

            shared.resolveHostname(
                {
                    host: 'ipv4.single.dev.ethereal.email',
                    allowInternalNetworkInterfaces: true
                },
                (err, result) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(result, {
                        servername: 'ipv4.single.dev.ethereal.email',
                        host: '95.216.108.161',
                        cached: false
                    });
                    done();
                }
            );
        });
    });
});
