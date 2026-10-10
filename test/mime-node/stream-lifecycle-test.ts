import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Transform, Writable } from 'node:stream';
import libqp from 'libqp';
import libbase64 from 'libbase64';
import MimeNode from '../../src/mime-node/index.js';
import nodemailer from '../../src/nodemailer.js';
import DKIM from '../../src/dkim/index.js';
import { closed, waitFor } from '../helpers/wait.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
});
const dkim = { domainName: 'example.com', keySelector: 'test', privateKey };

const message = { from: 'sender@example.com', to: 'receiver@example.com', subject: 'test' };

/**
 * Sends a message through a buffering stream transport and resolves with the outcome. The
 * callback must run exactly once, a second call fails the test
 */
function send(data: { [key: string]: any }, transportOptions: { [key: string]: any } = {}): Promise<{ err: any; info: any }> {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, ...transportOptions } as any);
    return new Promise(resolve => {
        let calls = 0;
        transport.sendMail(data as any, (err: any, info: any) => {
            calls++;
            assert.strictEqual(calls, 1, 'the callback ran more than once');
            resolve({ err, info });
        });
    });
}

/** A stream that emits some data and then fails */
function failingStream(error = new Error('source failed')): Readable {
    let sent = false;
    return new Readable({
        read() {
            if (!sent) {
                sent = true;
                this.push(Buffer.alloc(1024, 'a'));
                setImmediate(() => this.destroy(error));
            }
        }
    });
}

describe('MimeNode stream lifecycle', { timeout: 20000 }, () => {
    describe('errors reach the callback exactly once', () => {
        // Each of these used to throw "transform.emit is not a function" as an uncaught
        // exception once a process function such as DKIM was in the chain
        for (const [name, data] of [
            ['a raw message stream', () => ({ envelope: { from: 'a@example.com', to: 'b@example.com' }, raw: failingStream() })],
            ['an attachment raw stream', () => ({ ...message, attachments: [{ raw: failingStream() }] })],
            ['an attachment content stream', () => ({ ...message, attachments: [{ filename: 'a.bin', content: failingStream() }] })]
        ] as const) {
            it(`reports a failing ${name} with DKIM`, async () => {
                const { err } = await send({ ...data(), dkim });
                assert.ok(err);
                assert.strictEqual(err.message, 'source failed');
            });

            it(`reports a failing ${name} without DKIM`, async () => {
                const { err } = await send(data());
                assert.ok(err);
                assert.strictEqual(err.message, 'source failed');
            });
        }

        it('reports a failing user transform with DKIM', async () => {
            const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
            transport.use('stream', (mail, done) => {
                mail.message.transform(
                    new Transform({
                        transform(chunk, encoding, callback) {
                            callback(new Error('transform failed'));
                        }
                    })
                );
                done();
            });
            const err = await new Promise<any>(resolve => transport.sendMail({ ...message, text: 'hello', dkim }, err => resolve(err)));
            assert.ok(err);
            assert.strictEqual(err.message, 'transform failed');
        });

        it('reports an error from every stage once on the returned stream', async () => {
            const node = new MimeNode('text/plain').setContent(failingStream());
            node.transform(new PassThrough());
            node.processFunc(input => new DKIM(dkim).sign(input));
            node.newline = 'unix';

            const output = node.createReadStream();
            const errors: Error[] = [];
            output.on('error', err => errors.push(err));
            output.resume();
            await closed(output);
            await new Promise(resolve => setImmediate(resolve));
            assert.deepStrictEqual(
                errors.map(err => err.message),
                ['source failed']
            );
        });

        it('does not throw when a content stream emits error twice', async () => {
            const content = new PassThrough();
            setImmediate(() => {
                content.emit('error', new Error('first'));
                content.emit('error', new Error('second'));
            });
            const { err } = await send({ ...message, attachments: [{ filename: 'a.txt', content }] });
            assert.ok(err);
            assert.strictEqual(err.message, 'first');
        });
    });

    describe('streams that can not be read', () => {
        it('fails a content stream that is destroyed without an error instead of waiting forever', async () => {
            const content = new PassThrough();
            content.write('partial');
            setImmediate(() => content.destroy());
            const { err } = await send({ ...message, attachments: [{ filename: 'a.txt', content }] });
            assert.ok(err);
            // ESTREAM when the stream was already destroyed by the time the node got to it
            assert.ok(['ERR_STREAM_PREMATURE_CLOSE', 'ESTREAM'].includes(err.code), err.code);
        });

        it('fails an icalEvent stream that is destroyed without an error', async () => {
            const content = new PassThrough();
            setImmediate(() => content.destroy());
            const { err } = await send({ ...message, text: 'hello', icalEvent: { content } });
            assert.ok(err);
            // ESTREAM when the stream was already destroyed by the time the node got to it
            assert.ok(['ERR_STREAM_PREMATURE_CLOSE', 'ESTREAM'].includes(err.code), err.code);
        });

        for (const contentType of ['application/octet-stream', 'message/rfc822']) {
            it(`refuses a stream that was already read to the end as ${contentType}`, async () => {
                const content = Readable.from([Buffer.from('already read')]);
                content.resume();
                await new Promise(resolve => content.once('end', resolve));

                const { err, info } = await send({ ...message, attachments: [{ filename: 'a.eml', contentType, content }] });
                assert.ok(err, 'an empty attachment was sent: ' + (info && info.message));
                assert.strictEqual(err.code, 'ESTREAM');
            });
        }

        it('refuses a stream that was destroyed with an error before it was read', async () => {
            const content = new PassThrough();
            content.on('error', () => false);
            content.destroy(new Error('gone'));
            const { err } = await send({ ...message, attachments: [{ filename: 'a.txt', content }] });
            assert.ok(err);
            assert.strictEqual(err.message, 'gone');
        });

        it('fails a json transport content stream that is destroyed without an error', async () => {
            const content = new PassThrough();
            setImmediate(() => content.destroy());
            const { err } = await send(
                { ...message, attachments: [{ filename: 'a.txt', content }] },
                { streamTransport: false, jsonTransport: true }
            );
            assert.ok(err);
            // ESTREAM when the stream was already destroyed by the time the node got to it
            assert.ok(['ERR_STREAM_PREMATURE_CLOSE', 'ESTREAM'].includes(err.code), err.code);
        });

        it('still streams zero length content', async () => {
            const { err, info } = await send({ ...message, attachments: [{ filename: 'a.txt', content: Readable.from([]) }] });
            assert.ifError(err);
            assert.match(info.message.toString(), /filename=a\.txt/);
        });
    });

    describe('a consumer that stops reading releases the sources', () => {
        it('closes a file attachment when the message stream is destroyed', async t => {
            // large enough that it is not read to the end before the consumer gives up
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-stream-'));
            t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
            const file = path.join(dir, 'large.bin');
            fs.writeFileSync(file, Buffer.alloc(1024 * 1024, 'a'));

            const content = fs.createReadStream(file, { highWaterMark: 1024 });
            const node = new MimeNode('multipart/mixed');
            node.createChild('application/octet-stream').setContent(content);

            const output = node.createReadStream();
            output.on('error', () => false);
            // give up once the attachment is being read
            content.once('data', () => setImmediate(() => output.destroy()));
            output.resume();
            await closed(content);
            assert.ok(content.destroyed);
        });

        it('does not start the attachments that follow once the message stream is destroyed', async () => {
            const requests: string[] = [];
            const server = http.createServer((req, res) => {
                requests.push(req.url as string);
                res.end('remote content');
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = (server.address() as { port: number }).port;

            try {
                const first = new PassThrough();
                first.write('first');
                const node = new MimeNode('multipart/mixed');
                node.createChild('text/plain').setContent(first);
                node.createChild('text/plain').setContent({ href: `http://127.0.0.1:${port}/second` });

                const output = node.createReadStream();
                output.on('error', () => false);
                output.once('data', () => output.destroy());
                output.resume();

                await closed(first);
                await new Promise(resolve => setTimeout(resolve, 100));
                assert.deepStrictEqual(requests, []);
            } finally {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
            }
        });

        it('aborts the request of a URL attachment when the message stream is destroyed', async () => {
            let requestClosed!: () => void;
            const closedRequest = new Promise<void>(resolve => (requestClosed = resolve));
            const server = http.createServer((req, res) => {
                res.writeHead(200);
                res.write(Buffer.alloc(64 * 1024, 'a'));
                // never ends the response
                req.socket.once('close', requestClosed);
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = (server.address() as { port: number }).port;

            try {
                const node = new MimeNode('application/octet-stream').setContent({ href: `http://127.0.0.1:${port}/` });
                const output = node.createReadStream();
                output.on('error', () => false);
                let received = 0;
                output.on('data', chunk => {
                    received += chunk.length;
                    if (received > 16 * 1024) {
                        output.destroy();
                    }
                });
                await closedRequest;
            } finally {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
            }
        });

        it('removes the DKIM cache file when the signed message stream is destroyed', async () => {
            const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-dkim-'));
            try {
                const content = new PassThrough();
                const node = new MimeNode('application/octet-stream').setContent(content);
                node.processFunc(input => new DKIM({ ...dkim, cacheDir, cacheTreshold: 1024 }).sign(input));

                const output = node.createReadStream();
                output.on('error', () => false);
                content.write(Buffer.alloc(64 * 1024, 'a'));

                // wait until the body is buffered to disk, then give up on the message
                await waitFor(() => fs.readdirSync(cacheDir).length > 0);
                assert.strictEqual(fs.readdirSync(cacheDir).length, 1);
                output.destroy();

                await closed(content);
                await waitFor(() => fs.readdirSync(cacheDir).length === 0);
                assert.deepStrictEqual(fs.readdirSync(cacheDir), []);
            } finally {
                fs.rmSync(cacheDir, { recursive: true, force: true });
            }
        });

        it('removes the DKIM cache file when the content fails after the cache was started', async () => {
            const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-dkim-'));
            try {
                const content = new PassThrough();
                const pending = send({
                    ...message,
                    attachments: [{ filename: 'a.bin', content }],
                    dkim: { ...dkim, cacheDir, cacheTreshold: 1024 }
                });
                content.write(Buffer.alloc(64 * 1024, 'a'));
                await waitFor(() => fs.readdirSync(cacheDir).length > 0);
                content.destroy(new Error('source failed'));

                const { err } = await pending;
                assert.strictEqual(err.message, 'source failed');
                await waitFor(() => fs.readdirSync(cacheDir).length === 0);
                assert.deepStrictEqual(fs.readdirSync(cacheDir), []);
            } finally {
                fs.rmSync(cacheDir, { recursive: true, force: true });
            }
        });
    });

    describe('a failed message releases its streams', () => {
        it('destroys the content streams when the message is refused before it is streamed', async () => {
            const content = new PassThrough();
            const text = new PassThrough();
            const { err } = await send({
                ...message,
                to: ['a@example.com', 'b@example.com'],
                maxRecipients: 1,
                text,
                attachments: [{ content }]
            });
            assert.strictEqual(err.code, 'EMAXRECIPIENTS');
            assert.ok(content.destroyed);
            assert.ok(text.destroyed);
        });

        it('destroys the streams that were not read yet when an earlier one fails', async () => {
            const later = new PassThrough();
            const { err } = await send({
                ...message,
                attachments: [
                    { filename: 'a.bin', content: failingStream() },
                    { filename: 'b.bin', content: later }
                ]
            });
            assert.strictEqual(err.message, 'source failed');
            assert.ok(later.destroyed);
        });

        it('leaves the streams of a sent message alone', async () => {
            const content = Readable.from([Buffer.from('hello')]);
            const { err } = await send({ ...message, attachments: [{ filename: 'a.txt', content }] });
            assert.ifError(err);
            assert.ok(content.readableEnded);
        });
    });
});

describe('MimeNode output read by a slow consumer', { timeout: 30000 }, () => {
    // A consumer that takes one chunk at a time and acknowledges it a macrotask later, the way
    // a slow or congested receiving server does. The encoded output of a part then waits in the
    // encoder, and the node must not move on to the next part before it has drained
    const readSlowly = (node: MimeNode): Promise<string> =>
        new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const output = new Writable({
                highWaterMark: 1,
                write(chunk, encoding, callback) {
                    chunks.push(chunk);
                    setImmediate(callback);
                }
            });
            output.on('finish', () => resolve(Buffer.concat(chunks).toString('latin1')));
            const message = node.createReadStream();
            message.on('error', reject);
            message.pipe(output);
        });

    const streamOf = (content: Buffer) => {
        let pos = 0;
        return new Readable({
            read() {
                this.push(pos < content.length ? content.subarray(pos, (pos += 1000)) : null);
            }
        });
    };

    const bodies = (message: string, boundary: string): string[] =>
        message
            .split('--' + boundary)
            .slice(1, -1)
            .map(part => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));

    it('writes every encoded byte of a part before the next part starts', async () => {
        const first = crypto.randomBytes(1024 * 1024);
        const second = Buffer.from('tere vana kere, õäöü \r\n'.repeat(40 * 1024));

        const root = new MimeNode('multipart/mixed');
        root.createChild('application/octet-stream', { filename: 'first.bin' }).setContent(streamOf(first));
        root.createChild('text/plain; charset=utf-8')
            .setHeader('Content-Transfer-Encoding', 'quoted-printable')
            .setContent(streamOf(second));

        const message = await readSlowly(root);
        const [firstBody, secondBody] = bodies(message, root.boundary as string);

        assert.ok(libbase64.decode(firstBody.replace(/\r\n/g, '')).equals(first), 'the base64 part lost bytes');
        assert.ok(libqp.decode(secondBody).equals(second), 'the quoted-printable part lost bytes');
    });

    it('sends a whole stream attachment to a slow reader', async () => {
        const content = crypto.randomBytes(1024 * 1024);
        const root = new MimeNode('multipart/mixed');
        root.createChild('application/octet-stream', { filename: 'a.bin' }).setContent(streamOf(content));
        root.createChild('text/plain').setContent('after');

        const message = await readSlowly(root);
        const [attachment, text] = bodies(message, root.boundary as string);
        assert.ok(libbase64.decode(attachment.replace(/\r\n/g, '')).equals(content));
        assert.strictEqual(text, 'after');
    });
});

describe('MimeNode binary quoted-printable', () => {
    it('keeps the bytes of a binary part when line endings are converted', async () => {
        const content = crypto.randomBytes(64 * 1024);
        const root = new MimeNode('multipart/mixed', { newline: 'unix' });
        root.createChild('application/octet-stream', { filename: 'a.bin' })
            .setHeader('Content-Transfer-Encoding', 'quoted-printable')
            .setContent(content);
        root.createChild('text/plain').setContent('after');

        const message = (await root.build()).toString('latin1').replace(/\n/g, '\r\n');
        const part = message.split('--' + root.boundary)[1];
        const body = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
        assert.ok(libqp.decode(body).equals(content));
    });
});
