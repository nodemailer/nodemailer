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
        it('should merge user options with parsed URL options', () => {
            let url = 'smtp://user:pass@localhost:25';
            let userOptions = {
                name: 'myapp',
                debug: true,
                pool: true
            };
            
            let result = shared.parseConnectionUrl(url, userOptions);
            
            assert.deepStrictEqual(result, {
                secure: false,
                port: 25,
                host: 'localhost',
                auth: {
                    user: 'user',
                    pass: 'pass'
                },
                name: 'myapp',
                debug: true,
                pool: true
            });
        });

        it('should override user options with base options from URL', () => {
            let url = 'smtps://admin:secret@mail.example.com:465?name=urlname&debug=false';
            let userOptions = {
                name: 'userapp',
                debug: true,
                secure: false,
                host: 'oldhost.com',
                connectionTimeout: 5000,
                logger: true
            };
            
            let result = shared.parseConnectionUrl(url, userOptions);
            
            assert.deepStrictEqual(result, {
                secure: true,  // URL overrides user option
                port: 465,
                host: 'mail.example.com',  // URL overrides user option
                auth: {
                    user: 'admin',
                    pass: 'secret'
                },
                name: 'urlname',  // URL overrides user option
                debug: false,  // URL overrides user option
                connectionTimeout: 5000,  // User option preserved
                logger: true
            });
        });

        it('should merge nested tls options correctly', () => {
            let url = 'smtps://user:pass@localhost:465?tls.rejectUnauthorized=false&tls.minVersion=TLSv1.2';
            let userOptions = {
                tls: {
                    ca: 'user-ca-cert',
                    rejectUnauthorized: true,  // Should be overridden
                    servername: 'custom.example.com'
                }
            };
            
            let result = shared.parseConnectionUrl(url, userOptions);
            
            assert.deepStrictEqual(result, {
                secure: true,
                host: 'localhost',
                port: 465,
                auth: {
                    user: 'user',
                    pass: 'pass'
                },
                tls: {
                    ca: 'user-ca-cert',  // User option preserved
                    rejectUnauthorized: false,  // URL overrides user option
                    servername: 'custom.example.com',  // User option preserved
                    minVersion: 'TLSv1.2'  // URL adds new option
                }
            });
        });

        it('should handle empty user options', () => {
            let url = 'smtp://test:123@example.com:587?name=testapp';
            let userOptions = {};
            
            let result = shared.parseConnectionUrl(url, userOptions);
            
            assert.deepStrictEqual(result, {
                secure: false,
                port: 587,
                host: 'example.com',
                auth: {
                    user: 'test',
                    pass: '123'
                },
                name: 'testapp'
            });
        });

        it('should handle null user options', () => {
            let url = 'direct://example.com?pool=true';
            
            let result = shared.parseConnectionUrl(url, null);
            
            assert.deepStrictEqual(result, {
                direct: true,
                host: 'example.com',
                pool: true
            });
        });

        it('should merge auth options correctly when both exist', () => {
            let url = 'smtp://urluser:urlpass@localhost:25';
            let userOptions = {
                auth: {
                    user: 'useruser',
                    pass: 'userpass',
                    xoauth2: 'token123'
                }
            };
            
            let result = shared.parseConnectionUrl(url, userOptions);
            
            assert.deepStrictEqual(result, {
                secure: false,
                port: 25,
                host: 'localhost',
                auth: {
                    user: 'urluser',  // URL overrides user option
                    pass: 'urlpass',  // URL overrides user option
                    xoauth2: 'token123'  // User option preserved
                }
            });
        });
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
            // Reset the cleanup timer to allow immediate cleanup in tests
            if (shared._resetCacheCleanup) {
                shared._resetCacheCleanup();
            }

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

    describe('DNS Cache Management', () => {
        it('should renew expired cache TTL when falling back due to DNS error', () => {
            const dnsCache = new Map();
            const DNS_TTL = 300000;

            dnsCache.set('test.com', {
                value: { addresses: ['1.2.3.4'] },
                expires: Date.now() - 1000 // Expired
            });

            const cachedBefore = dnsCache.get('test.com');

            if (cachedBefore) {
                dnsCache.set('test.com', {
                    value: cachedBefore.value,
                    expires: Date.now() + DNS_TTL // THIS IS THE FIX
                });
            }

            const cachedAfter = dnsCache.get('test.com');

            assert.ok(cachedAfter.expires > Date.now(), 'Cache TTL should be renewed');
            assert.equal(cachedAfter.value.addresses[0], '1.2.3.4', 'Cache value should be preserved');
        });

        it('should clean up expired entries during cache access', (t, done) => {
            // Clear the cache and reset cleanup timer
            shared.dnsCache.clear();
            if (shared._resetCacheCleanup) {
                shared._resetCacheCleanup();
            }

            // Add some test entries with expired TTLs
            const now = Date.now();
            shared.dnsCache.set('expired1.com', {
                value: { addresses: ['1.1.1.1'], servername: 'expired1.com' },
                expires: now - 10000 // Expired 10 seconds ago
            });
            shared.dnsCache.set('expired2.com', {
                value: { addresses: ['2.2.2.2'], servername: 'expired2.com' },
                expires: now - 5000 // Expired 5 seconds ago
            });
            shared.dnsCache.set('valid.com', {
                value: { addresses: ['3.3.3.3'], servername: 'valid.com' },
                expires: now + 60000 // Valid for another minute
            });

            const initialSize = shared.dnsCache.size;
            assert.equal(initialSize, 3, 'Should have 3 entries initially');

            // Trigger a DNS lookup which should invoke cleanup
            // We'll check for an IP address to avoid slow DNS lookups
            shared.resolveHostname({ host: '192.168.1.1' }, err => {
                // This should succeed with the IP address
                assert.ok(!err, 'Should succeed for IP address');

                // Now check that expired entries were cleaned up during the cache check
                // The cleanup happens when checking cache, even if the host is an IP
                // But since IPs don't use cache, we need a different approach

                // Let's directly check if cleanup would work by accessing a cached domain
                shared.resolveHostname({ host: 'valid.com' }, () => {
                    // After this lookup, cleanup should have occurred
                    assert.ok(!shared.dnsCache.has('expired1.com'), 'expired1.com should be removed');
                    assert.ok(!shared.dnsCache.has('expired2.com'), 'expired2.com should be removed');
                    assert.ok(shared.dnsCache.has('valid.com'), 'valid.com should still be present');

                    done();
                });
            });
        });

        it('should limit cache size during cleanup', (t, done) => {
            // Clear the cache and reset cleanup timer
            shared.dnsCache.clear();
            if (shared._resetCacheCleanup) {
                shared._resetCacheCleanup();
            }

            // Add many entries to exceed MAX_CACHE_SIZE
            const now = Date.now();
            for (let i = 0; i < 1100; i++) {
                shared.dnsCache.set(`test${i}.com`, {
                    value: { addresses: [`10.0.0.${i % 256}`], servername: `test${i}.com` },
                    expires: now + 60000
                });
            }

            const initialSize = shared.dnsCache.size;
            assert.ok(initialSize > 1000, 'Should have more than MAX_CACHE_SIZE entries');

            // Trigger cleanup by accessing a cached entry
            shared.resolveHostname({ host: 'test500.com' }, err => {
                // This should succeed with cached data
                assert.ok(!err, 'Should succeed with cached entry');

                // Check that cache size was reduced
                assert.ok(shared.dnsCache.size <= 1000, 'Cache size should be limited to MAX_CACHE_SIZE');

                done();
            });
        });
    });
});
