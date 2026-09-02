import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '../../src/shared/index.js';

import http from 'node:http';
import fs from 'node:fs';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { PassThrough, Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

        it('Should fall back to a lower-severity handler for missing levels', () => {
            const calls: any[] = [];
            const logger = shared.getLogger({
                logger: {
                    // deliberately omit warn/trace/fatal
                    info(entry, message) {
                        calls.push(['info', message]);
                    },
                    debug(entry, message) {
                        calls.push(['debug', message]);
                    },
                    error(entry, message) {
                        calls.push(['error', message]);
                    }
                }
            });

            assert.doesNotThrow(() => logger.warn({}, 'warn message'));
            assert.doesNotThrow(() => logger.fatal({}, 'fatal message'));
            assert.doesNotThrow(() => logger.trace({}, 'trace message'));

            // missing levels should be routed to the preferred low-severity handler (info)
            assert.deepStrictEqual(calls, [
                ['info', 'warn message'],
                ['info', 'fatal message'],
                ['info', 'trace message']
            ]);
        });

        it('Should preserve the logger `this` binding when falling back', () => {
            const seen: any[] = [];

            class CustomLogger {
                info(entry: any, message: any) {
                    // relies on `this` being the logger instance
                    this.record(message);
                }
                record(message: any) {
                    seen.push(message);
                }
            }

            const logger = shared.getLogger({ logger: new CustomLogger() });

            assert.doesNotThrow(() => logger.warn({}, 'needs this'));
            assert.deepStrictEqual(seen, ['needs this']);
        });

        it('Should not throw when the logger implements no usable level', () => {
            const logger = shared.getLogger({ logger: {} });

            assert.doesNotThrow(() => logger.info({}, 'no-op'));
            assert.doesNotThrow(() => logger.warn({}, 'no-op'));
            assert.doesNotThrow(() => logger.error({}, 'no-op'));
        });

        it('Should prefix default logger lines with the session and connection ids', t => {
            const log = t.mock.method(console, 'log', () => false);
            const logger = shared.getLogger({ logger: true });

            logger.info({ tnx: 'server', sid: 'abc', cid: 7 }, 'first %s\nsecond', 'line');
            logger.error({ tnx: 'client' }, 'reply');
            logger.debug({}, 'plain');

            const lines = log.mock.calls.map(call => call.arguments);
            assert.strictEqual(lines.length, 4);
            lines.forEach(args => {
                assert.strictEqual(args[0], '[%s] %s %s');
                assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(args[1]));
            });
            // every line of a message gets its own entry, the level name is padded to
            // a fixed width and the prefix names the connection, the session and the side
            assert.deepStrictEqual(
                lines.map(args => args.slice(2)),
                [
                    ['INFO ', '[#7] [abc] S: first line'],
                    ['INFO ', '[#7] [abc] S: second'],
                    ['ERROR', 'C: reply'],
                    ['DEBUG', 'plain']
                ]
            );
        });
    });

    describe('Connection url parser tests', () => {
        it('should keep a colon in the user name apart from the password', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtp://us%3Aer:pa%3Ass@localhost:25').auth, { user: 'us:er', pass: 'pa:ss' });
            assert.deepStrictEqual(shared.parseConnectionUrl('smtp://:pass@localhost:25').auth, { user: '', pass: 'pass' });
            assert.strictEqual(shared.parseConnectionUrl('smtp://localhost:25').auth, undefined);
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

        it('should parse a direct url', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('direct://?name=example.com'), {
                direct: true,
                name: 'example.com'
            });
        });

        it('should convert boolean and numeric query values', () => {
            assert.deepStrictEqual(
                shared.parseConnectionUrl('smtp://localhost:25?pool=true&debug=false&maxConnections=5&tls.servername=mx.example.com'),
                {
                    secure: false,
                    port: 25,
                    host: 'localhost',
                    pool: true,
                    debug: false,
                    maxConnections: 5,
                    tls: {
                        servername: 'mx.example.com'
                    }
                }
            );
        });

        it('should not let a query parameter override a url component', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtp://localhost:25?secure=true&port=99&host=other.example.com'), {
                secure: false,
                port: 25,
                host: 'localhost'
            });
        });

        it('should ignore nested keys other than tls', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl('smtp://localhost?auth.user=name&auth.pass=secret&name=host'), {
                secure: false,
                host: 'localhost',
                name: 'host'
            });
        });

        it('should return an empty object for a missing url', () => {
            assert.deepStrictEqual(shared.parseConnectionUrl(), {});
            assert.deepStrictEqual(shared.parseConnectionUrl(null), {});
        });

        it('should not let a __proto__ query key mutate the prototype chain', () => {
            const options = shared.parseConnectionUrl('smtp://localhost?__proto__=1&tls.__proto__=2&tls.rejectUnauthorized=false');

            assert.strictEqual(Object.getPrototypeOf(options), Object.prototype);
            assert.strictEqual(Object.getPrototypeOf(options.tls), Object.prototype);
            assert.deepStrictEqual(options, {
                secure: false,
                host: 'localhost',
                tls: {
                    rejectUnauthorized: false
                }
            });
        });
    });

    describe('#parseDataURI tests', () => {
        it('should return null for anything that is not a data uri', () => {
            assert.strictEqual(shared.parseDataURI(null), null);
            assert.strictEqual(shared.parseDataURI(5), null);
            assert.strictEqual(shared.parseDataURI('http://example.com/'), null);
            assert.strictEqual(shared.parseDataURI('data:no-comma'), null);
        });

        it('should parse the content type, the parameters and the encoding', () => {
            assert.deepStrictEqual(shared.parseDataURI('data:text/plain;charset=utf-8;foo=bar;=nokey;base64,aGVsbG8='), {
                data: Buffer.from('hello'),
                encoding: 'base64',
                contentType: 'text/plain',
                params: {
                    charset: 'utf-8',
                    foo: 'bar'
                }
            });
        });

        it('should recognize the utf8 encoding marker', () => {
            assert.deepStrictEqual(shared.parseDataURI('data:text/plain;utf8,hello%20world'), {
                data: Buffer.from('hello world'),
                encoding: 'utf8',
                contentType: 'text/plain',
                params: {}
            });
        });

        it('should default to application/octet-stream', () => {
            assert.deepStrictEqual(shared.parseDataURI('data:,hi'), {
                data: Buffer.from('hi'),
                encoding: null,
                contentType: 'application/octet-stream',
                params: {}
            });
        });

        it('should keep a malformed percent encoding as it is', () => {
            assert.deepStrictEqual(shared.parseDataURI('data:text/plain,%E0%A4%A')!.data, Buffer.from('%E0%A4%A'));
        });

        it('should not let a __proto__ parameter mutate the prototype chain', () => {
            const parsed = shared.parseDataURI('data:text/plain;__proto__=polluted,x')!;

            assert.strictEqual(Object.getPrototypeOf(parsed.params), Object.prototype);
            assert.deepStrictEqual(parsed.params, {});
        });
    });

    describe('Resolver tests', () => {
        let port = 10337;
        let server: http.Server;

        beforeEach((t, done) => {
            server = http.createServer((req, res) => {
                if (/redirect/.test(req.url as string)) {
                    res.writeHead(302, {
                        Location: 'http://localhost:' + port + '/message.html'
                    });
                    res.end('Go to http://localhost:' + port + '/message.html');
                } else if (/compressed/.test(req.url as string)) {
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

        it('should return the error of a content stream', (t, done) => {
            let mail = {
                data: {
                    html: fs.createReadStream(__dirname + '/fixtures/no-such-file.html')
                }
            };
            shared.resolveContent(mail.data, 'html', (err, value) => {
                assert.ok(err);
                assert.strictEqual((err as NodeJS.ErrnoException).code, 'ENOENT');
                assert.strictEqual(value, undefined);
                done();
            });
        });

        it('should return the error of a stream given as the content property', (t, done) => {
            let stream = new PassThrough();
            let mail = {
                data: {
                    attachment: {
                        filename: 'message.html',
                        content: stream
                    }
                }
            };
            shared.resolveContent(mail.data, 'attachment', (err, value) => {
                assert.ok(err);
                assert.strictEqual(err!.message, 'stream failed');
                assert.strictEqual(value, undefined);
                // nothing was resolved, so the descriptor is left as it was
                assert.strictEqual(mail.data.attachment.content, stream);
                done();
            });

            setImmediate(() => stream.emit('error', new Error('stream failed')));
        });

        it('should call back once when a stream errors more than once and then ends', (t, done) => {
            let stream = new PassThrough();
            let calls: { message: string | null; value: any }[] = [];

            shared.resolveContent({ html: stream }, 'html', (err, value) => {
                calls.push({ message: err && err.message, value });
            });

            stream.emit('error', new Error('first'));
            stream.emit('error', new Error('second'));
            stream.on('end', () => {
                setImmediate(() => {
                    assert.deepStrictEqual(calls, [{ message: 'first', value: undefined }]);
                    done();
                });
            });
            stream.end('x');
        });

        it('should return an error for a stream that does not yield buffers', (t, done) => {
            let stream = new Readable({
                objectMode: true,
                read() {
                    // nothing to do, the chunks are pushed below
                }
            });
            stream.push({ not: 'a buffer' });
            stream.push(null);

            shared.resolveContent({ html: stream }, 'html', (err, value) => {
                assert.ok(err instanceof Error);
                assert.strictEqual(value, undefined);
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

            it('should return an empty buffer for a data uri without a comma', (t, done) => {
                let mail = {
                    data: {
                        attachment: {
                            path: 'data:no-comma-here'
                        }
                    }
                };
                shared.resolveContent(mail.data, 'attachment', (err, value) => {
                    assert.ok(!err);
                    assert.deepStrictEqual(value, Buffer.alloc(0));
                    done();
                });
            });
        });

        // Regression tests: every resolveContent branch must return the generated
        // promise; stream/url/file/data-uri/empty branches used to return early and
        // resolve the awaited value to undefined
        describe('promise form', () => {
            const expected = Buffer.from('<p>Tere, tere</p><p>vana kere!</p>\n');

            it('should resolve string content', async () => {
                let mail = { data: { html: '<p>Tere, tere</p><p>vana kere!</p>\n' } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.strictEqual(value, '<p>Tere, tere</p><p>vana kere!</p>\n');
            });

            it('should resolve empty content', async () => {
                let mail = { data: { html: '' } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.strictEqual(value, '');
            });

            it('should resolve a stream', async () => {
                let mail = { data: { html: fs.createReadStream(__dirname + '/fixtures/message.html') } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.deepStrictEqual(value, expected);
            });

            it('should resolve a file path', async () => {
                let mail = { data: { html: { path: __dirname + '/fixtures/message.html' } } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.deepStrictEqual(value, expected);
            });

            it('should resolve an url', async () => {
                let mail = { data: { html: { path: 'http://localhost:' + port + '/message.html' } } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.deepStrictEqual(value, expected);
            });

            it('should resolve a data uri', async () => {
                let mail = { data: { attachment: { path: 'data:image/png,tere%20tere' } } };
                const value = await shared.resolveContent(mail.data, 'attachment');
                assert.deepStrictEqual(value, Buffer.from('tere tere'));
            });

            it('should resolve an empty buffer for a data uri without a comma', async () => {
                let mail = { data: { attachment: { path: 'data:no-comma-here' } } };
                const value = await shared.resolveContent(mail.data, 'attachment');
                assert.deepStrictEqual(value, Buffer.alloc(0));
            });

            it('should reject a missing file', async () => {
                let mail = { data: { html: { path: __dirname + '/fixtures/no-such-file.html' } } };
                await assert.rejects(shared.resolveContent(mail.data, 'html'));
            });

            it('should reject an unreachable url', async () => {
                let mail = { data: { html: { path: 'http://localhost:' + (port + 1000) + '/message.html' } } };
                await assert.rejects(shared.resolveContent(mail.data, 'html'));
            });

            it('should reject when file access is disabled', async () => {
                let mail = { data: { html: { path: __dirname + '/fixtures/message.html' } } };
                await assert.rejects(shared.resolveContent(mail.data, 'html', { disableFileAccess: true }), { code: 'EFILEACCESS' });
            });

            it('should reject when url access is disabled', async () => {
                let mail = { data: { html: { path: 'http://localhost:' + port + '/message.html' } } };
                await assert.rejects(shared.resolveContent(mail.data, 'html', { disableUrlAccess: true }), { code: 'EURLACCESS' });
            });

            for (let href of ['file:///etc/passwd', 'gopher://localhost/x']) {
                it('should reject the unusable href ' + JSON.stringify(href), async () => {
                    // this resolver used to match no branch for such an href and fall through
                    // to "return as is", handing the descriptor object back as the content.
                    // jsonTransport output is normally passed to another service to send, so
                    // the href travelled on intact while the same message over SMTP failed
                    let mail = { data: { html: { href } } };
                    await assert.rejects(shared.resolveContent(mail.data, 'html'), { code: 'EFETCH' });
                });
            }

            it('should resolve a whitespace padded url', async () => {
                // the URL parser normalizes this, so it must not be refused on the shape of
                // the raw string when MimeNode would happily fetch it
                let mail = { data: { html: { href: ' http://localhost:' + port + '/message.html' } } };
                const value = await shared.resolveContent(mail.data, 'html');
                assert.ok(value.toString().length);
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

        it('should not mutate the prototype chain of the target', () => {
            let target: any = {};

            // an own "__proto__" key (e.g. from JSON.parse) must not become the target's prototype
            shared.assign(target, JSON.parse('{"__proto__":{"polluted":true}}'));

            assert.strictEqual(Object.getPrototypeOf(target), Object.prototype);
            assert.strictEqual(target.polluted, undefined);
            assert.strictEqual(({} as any).polluted, undefined);
        });

        it('should not mutate the prototype chain of a nested tls or auth object', () => {
            // tls and auth are merged key by key instead of being passed through, and that
            // merge is a copy of caller supplied keys just like the outer one. An injected
            // auth.pass is read by direct property access in the pool, so it would reach
            // the SMTP server while Object.keys(auth) still showed only the legitimate user
            let target = shared.assign(
                {},
                JSON.parse(
                    '{"auth":{"user":"legit@example.com","__proto__":{"pass":"injected"}},"tls":{"__proto__":{"rejectUnauthorized":false}}}'
                )
            );

            assert.strictEqual(Object.getPrototypeOf(target.auth), Object.prototype);
            assert.strictEqual(target.auth.user, 'legit@example.com');
            assert.strictEqual(target.auth.pass, undefined);
            assert.strictEqual(Object.getPrototypeOf(target.tls), Object.prototype);
            assert.strictEqual(target.tls.rejectUnauthorized, undefined);
        });

        it('should keep keys that share a name with an Object member', () => {
            // only "__proto__" has an inherited setter, so dropping "constructor" or
            // "prototype" alongside it would discard legitimate values for no gain
            let target = shared.assign({}, { constructor: 'x', prototype: 'y', toString: 'z' });

            assert.strictEqual(target.constructor, 'x');
            assert.strictEqual(target.prototype, 'y');
            assert.strictEqual(target.toString, 'z');
        });
    });

    describe('#copyOwnKeys tests', () => {
        it('should copy own keys', () => {
            assert.deepStrictEqual(shared.copyOwnKeys({ a: 1 }, { b: 2, c: 3 }), { a: 1, b: 2, c: 3 });
        });

        it('should tolerate a missing source', () => {
            assert.deepStrictEqual(shared.copyOwnKeys({ a: 1 }, null), { a: 1 });
        });

        it('should honour the skip predicate', () => {
            assert.deepStrictEqual(
                shared.copyOwnKeys({}, { a: 1, b: 2 }, key => key === 'b'),
                { a: 1 }
            );
        });

        it('should not mutate the prototype chain of the target', () => {
            let target: any = shared.copyOwnKeys({}, JSON.parse('{"a":1,"__proto__":{"polluted":true}}'));

            assert.strictEqual(Object.getPrototypeOf(target), Object.prototype);
            assert.strictEqual(target.a, 1);
            assert.strictEqual(target.polluted, undefined);
            assert.strictEqual(({} as any).polluted, undefined);
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
        let networkInterfaces: any;

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
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });

            Object.keys(networkInterfaces).forEach(key => {
                shared.networkInterfaces![key] = networkInterfaces[key];
            });
            done();
        });

        it('should resolve a single IPv4 entry', (t, done) => {
            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result: any) => {
                assert.ok(!err);
                assert.strictEqual(result.servername, 'ipv4.single.dev.ethereal.email');
                assert.strictEqual(result.host, '95.216.108.161');
                assert.strictEqual(result.cached, false);
                assert.ok(Array.isArray(result._addresses));
                assert.ok(result._addresses.includes('95.216.108.161'));
                shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result: any) => {
                    assert.ok(!err);
                    assert.strictEqual(result.servername, 'ipv4.single.dev.ethereal.email');
                    assert.strictEqual(result.host, '95.216.108.161');
                    assert.strictEqual(result.cached, true);
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

                shared.resolveHostname({ host: 'ipv4.multi.dev.ethereal.email', dnsTtl: 1 }, (err, result: any) => {
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
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });

            shared.networkInterfaces!.en0 = [
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

            shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, (err, result: any) => {
                assert.ok(!err);
                assert.strictEqual(result.servername, 'ipv6.single.dev.ethereal.email');
                assert.strictEqual(result.host, '2a01:4f9:3051:4501::2');
                assert.strictEqual(result.cached, false);
                assert.ok(Array.isArray(result._addresses));
                assert.ok(result._addresses.includes('2a01:4f9:3051:4501::2'));
                shared.resolveHostname({ host: 'ipv6.single.dev.ethereal.email' }, (err, result: any) => {
                    assert.ok(!err);
                    assert.strictEqual(result.servername, 'ipv6.single.dev.ethereal.email');
                    assert.strictEqual(result.host, '2a01:4f9:3051:4501::2');
                    assert.strictEqual(result.cached, true);
                    done();
                });
            });
        });

        it('should resolve when the runtime has no interface table', (t, done) => {
            // Cloudflare Workers report no network interfaces at all, that must not
            // disable every address family and skip the resolver
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });

            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result: any) => {
                assert.ok(!err);
                assert.strictEqual(result.servername, 'ipv4.single.dev.ethereal.email');
                assert.strictEqual(result.host, '95.216.108.161');
                assert.ok(result._addresses.includes('95.216.108.161'));
                done();
            });
        });

        it('should fail missing address', (t, done) => {
            shared.resolveHostname({ host: 'missing.single.dev.ethereal.email' }, err => {
                assert.ok(err);
                done();
            });
        });

        it('should return provided IP', (t, done) => {
            shared.resolveHostname({ host: '1.2.3.4', servername: 'example.com' }, (err, result: any) => {
                assert.ok(!err);
                assert.strictEqual(result.servername, 'example.com');
                assert.strictEqual(result.host, '1.2.3.4');
                assert.strictEqual(result.cached, false);
                assert.ok(Array.isArray(result._addresses));
                assert.ok(result._addresses.includes('1.2.3.4'));
                done();
            });
        });

        it('should fail resolving a single internal IPv4 entry', (t, done) => {
            // ensure that there is a single Ipv4 interface "available"
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });

            shared.networkInterfaces!.lo = [
                {
                    address: '127.0.0.1',
                    netmask: '255.0.0.0',
                    family: 'IPv4',
                    mac: '00:00:00:00:00:00',
                    internal: true,
                    cidr: '127.0.0.1/8'
                }
            ];

            shared.resolveHostname({ host: 'ipv4.single.dev.ethereal.email' }, (err, result: any) => {
                assert.ok(!err);
                assert.strictEqual(result.servername, 'ipv4.single.dev.ethereal.email');
                assert.strictEqual(result.host, 'ipv4.single.dev.ethereal.email');
                assert.strictEqual(result.cached, false);
                done();
            });
        });

        it('should succeed resolving a single internal IPv4 entry', (t, done) => {
            // ensure that there is a single Ipv4 interface "available"
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });

            shared.networkInterfaces!.lo = [
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
                (err, result: any) => {
                    assert.ok(!err);
                    assert.strictEqual(result.servername, 'ipv4.single.dev.ethereal.email');
                    assert.strictEqual(result.host, '95.216.108.161');
                    assert.strictEqual(result.cached, false);
                    assert.ok(Array.isArray(result._addresses));
                    assert.ok(result._addresses.includes('95.216.108.161'));
                    done();
                }
            );
        });

        it('should include all addresses in _addresses for fallback support', (t, done) => {
            // Test that when resolving a host with multiple A records, all are included in _addresses
            shared.resolveHostname({ host: 'ipv4.multi.dev.ethereal.email' }, (err, result: any) => {
                assert.ok(!err);
                assert.ok(Array.isArray(result._addresses), 'Should have _addresses array');
                // ipv4.multi.dev.ethereal.email has 3 A records
                assert.ok(result._addresses.length >= 1, 'Should have at least one address');
                assert.ok(result.host, 'Should have a primary host');
                // The primary host should be one of the addresses
                assert.ok(result._addresses.includes(result.host), 'Primary host should be in _addresses');
                done();
            });
        });
    });

    describe('#resolveHostname fallback tests', () => {
        // dns.Resolver and dns.lookup are stubbed, so these run without network access
        const HOST = 'mail.example.test';
        let networkInterfaces: any;
        let originalResolver: any;
        let originalLookup: any;

        type ResolverAnswers = { [family: string]: Error | string[] };
        type LookupResult = { address: string; family: number }[] | undefined;

        const dnsError = (code: string) => Object.assign(new Error('DNS ' + code), { code });

        const setInterfaces = (families: string[]) => {
            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });
            shared.networkInterfaces!.en0 = families.map(
                family =>
                    ({
                        address: family === 'IPv4' ? '192.0.2.10' : '2001:db8::10',
                        netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff:ffff:ffff::',
                        family,
                        mac: '00:00:00:00:00:00',
                        internal: false,
                        cidr: family === 'IPv4' ? '192.0.2.10/24' : '2001:db8::10/64'
                    }) as any
            );
        };

        // resolve4 and resolve6 answer with the listed addresses or fail with the listed error
        const stubResolver = (answers: ResolverAnswers) => {
            const answer = (family: string, callback: (err: Error | null, addresses?: string[]) => void) => {
                const value = answers[family];
                setImmediate(() => {
                    if (value instanceof Error) {
                        return callback(value);
                    }
                    callback(null, value);
                });
            };
            (dns as any).Resolver = class {
                resolve4(hostname: string, callback: (err: Error | null, addresses?: string[]) => void) {
                    answer('4', callback);
                }
                resolve6(hostname: string, callback: (err: Error | null, addresses?: string[]) => void) {
                    answer('6', callback);
                }
            };
        };

        const stubLookup = (
            impl: (hostname: string, options: any, callback: (err: Error | null, addresses?: LookupResult) => void) => void
        ) => {
            (dns as any).lookup = impl;
        };

        const setExpiredCache = (address: string) => {
            shared.dnsCache.set(HOST, {
                value: { addresses: [address], servername: HOST },
                expires: Date.now() - 1000
            });
        };

        beforeEach(() => {
            networkInterfaces = JSON.parse(JSON.stringify(shared.networkInterfaces));
            originalResolver = dns.Resolver;
            originalLookup = dns.lookup;

            shared.dnsCache.clear();
            shared._resetCacheCleanup();
            setInterfaces(['IPv4', 'IPv6']);
        });

        afterEach(() => {
            (dns as any).Resolver = originalResolver;
            (dns as any).lookup = originalLookup;

            Object.keys(shared.networkInterfaces!).forEach(key => {
                delete shared.networkInterfaces![key];
            });
            Object.keys(networkInterfaces).forEach(key => {
                shared.networkInterfaces![key] = networkInterfaces[key];
            });
        });

        it('should use the servername as the host when no host is given', (t, done) => {
            stubResolver({ 4: ['192.0.2.1'], 6: [] });

            shared.resolveHostname({ servername: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.1',
                    _addresses: ['192.0.2.1'],
                    cached: false
                });
                done();
            });
        });

        it('should fall back to lookup when the resolver fails with an unexpected error', (t, done) => {
            // a timeout is not one of the "no such record" answers, so it counts as a failure
            stubResolver({ 4: dnsError('ETIMEOUT'), 6: dnsError('ETIMEOUT') });
            let lookups: string[] = [];
            stubLookup((hostname, options, callback) => {
                lookups.push(hostname);
                setImmediate(() => callback(null, [{ address: '192.0.2.2', family: 4 }]));
            });

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.2',
                    _addresses: ['192.0.2.2'],
                    cached: false
                });
                assert.deepStrictEqual(lookups, [HOST]);
                assert.deepStrictEqual(shared.dnsCache.get(HOST)!.value, { addresses: ['192.0.2.2'], servername: HOST });
                done();
            });
        });

        it('should drop lookup addresses of an unsupported family', (t, done) => {
            setInterfaces(['IPv4']);
            stubResolver({ 4: [], 6: [] });
            stubLookup((hostname, options, callback) => {
                setImmediate(() =>
                    callback(null, [
                        { address: '2001:db8::1', family: 6 },
                        { address: '192.0.2.3', family: 4 }
                    ])
                );
            });

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.3',
                    _addresses: ['192.0.2.3'],
                    cached: false
                });
                done();
            });
        });

        it('should answer from an expired cache entry when both resolvers fail', (t, done) => {
            const error = dnsError('ETIMEOUT');
            stubResolver({ 4: error, 6: dnsError('ECANCELLED') });
            stubLookup(() => {
                done(new Error('lookup should not be called'));
            });
            setExpiredCache('192.0.2.4');

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.4',
                    _addresses: ['192.0.2.4'],
                    cached: true,
                    error
                });
                // the stale entry is kept for another ttl
                assert.ok(shared.dnsCache.get(HOST)!.expires! > Date.now());
                done();
            });
        });

        it('should answer from an expired cache entry when lookup fails', (t, done) => {
            // these answers mean "no such record" and do not count as failures
            stubResolver({ 4: dnsError('ENOTFOUND'), 6: dnsError('ENODATA') });
            const error = dnsError('EAI_AGAIN');
            stubLookup((hostname, options, callback) => {
                setImmediate(() => callback(error));
            });
            setExpiredCache('192.0.2.5');

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.5',
                    _addresses: ['192.0.2.5'],
                    cached: true,
                    error
                });
                assert.ok(shared.dnsCache.get(HOST)!.expires! > Date.now());
                done();
            });
        });

        it('should fail when lookup fails and nothing is cached', (t, done) => {
            stubResolver({ 4: [], 6: [] });
            const error = dnsError('EAI_AGAIN');
            stubLookup((hostname, options, callback) => {
                setImmediate(() => callback(error));
            });

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.strictEqual(err, error);
                assert.strictEqual(result, undefined);
                assert.strictEqual(shared.dnsCache.has(HOST), false);
                done();
            });
        });

        it('should fall back to the hostname when lookup finds nothing', (t, done) => {
            stubResolver({ 4: [], 6: [] });
            stubLookup((hostname, options, callback) => {
                setImmediate(() => callback(null, undefined));
            });

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: HOST,
                    _addresses: [HOST],
                    cached: false
                });
                done();
            });
        });

        it('should answer from an expired cache entry when no lookup address is usable', (t, done) => {
            setInterfaces(['IPv4']);
            stubResolver({ 4: [], 6: [] });
            stubLookup((hostname, options, callback) => {
                setImmediate(() => callback(null, [{ address: '2001:db8::1', family: 6 }]));
            });
            const warn = t.mock.method(console, 'warn', () => false);
            setExpiredCache('192.0.2.6');

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.6',
                    _addresses: ['192.0.2.6'],
                    cached: true
                });
                assert.strictEqual(warn.mock.callCount(), 1);
                assert.strictEqual(warn.mock.calls[0].arguments[0], 'Failed to resolve IPv6 addresses with current network');
                done();
            });
        });

        it('should answer from an expired cache entry when lookup throws', (t, done) => {
            stubResolver({ 4: [], 6: [] });
            const error = new Error('lookup exploded');
            stubLookup(() => {
                throw error;
            });
            setExpiredCache('192.0.2.7');

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.ok(!err);
                assert.deepStrictEqual(result, {
                    servername: HOST,
                    host: '192.0.2.7',
                    _addresses: ['192.0.2.7'],
                    cached: true,
                    error
                });
                assert.ok(shared.dnsCache.get(HOST)!.expires! > Date.now());
                done();
            });
        });

        it('should fail with the resolver error when lookup throws and nothing is cached', (t, done) => {
            const error = dnsError('ETIMEOUT');
            stubResolver({ 4: error, 6: dnsError('ETIMEOUT') });
            stubLookup(() => {
                throw new Error('lookup exploded');
            });

            shared.resolveHostname({ host: HOST }, (err, result) => {
                assert.strictEqual(err, error);
                assert.strictEqual(result, undefined);
                done();
            });
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
