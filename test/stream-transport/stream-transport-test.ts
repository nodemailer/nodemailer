import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import StreamTransport from '../../src/stream-transport/index.js';
import MailComposer from '../../src/mail-composer/index.js';
import nodemailer from '../../src/nodemailer.js';
import { captureLogger } from '../smtp-transport/smtp-fixtures.js';

describe('Stream Transport Tests', { timeout: 10000 }, () => {
    it('Should expose version number', () => {
        let client = new StreamTransport();
        assert.ok(client.name);
        assert.ok(client.version);
    });

    it('Should normalize the addresses of a custom envelope', (t, done) => {
        let client = new StreamTransport();
        // a custom envelope used to reach the transport unnormalized, so it kept the
        // ambiguous form while the header carried the quoted one
        let envelope = { from: 'a@evil.com@good.com', to: ['b@evil.com@good.com'] };

        client.send(
            {
                data: { envelope },
                message: new MailComposer({
                    envelope,
                    newline: '\n',
                    raw: Buffer.from('message')
                }).compile()
            } as any,
            (err, info: any) => {
                assert.ok(!err);
                assert.deepStrictEqual(info.envelope, {
                    from: '"a@evil.com"@good.com',
                    to: ['"b@evil.com"@good.com']
                });
                done();
            }
        );
    });

    describe('Send as stream', () => {
        it('Should send mail using unix newlines 1', (t, done) => {
            let client = new StreamTransport();
            let chunks: Buffer[] = [],
                message = new Array(100).join('teretere\r\nvana kere\r\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        newline: '\n',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);

                    assert.deepStrictEqual(info.envelope, {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient']
                    });

                    info.message.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });

                    info.message.on('end', () => {
                        let body = Buffer.concat(chunks);
                        assert.strictEqual(body.toString(), message.replace(/\r\n/g, '\n'));
                        done();
                    });
                }
            );
        });

        it('Should send mail using unix newlines 2', (t, done) => {
            let client = new StreamTransport();
            let chunks: Buffer[] = [],
                message = new Array(100).join('teretere\r\nvana kere\r\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        newline: 'unix',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);

                    assert.deepStrictEqual(info.envelope, {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient']
                    });

                    info.message.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });

                    info.message.on('end', () => {
                        let body = Buffer.concat(chunks);
                        assert.strictEqual(body.toString(), message.replace(/\r\n/g, '\n'));
                        done();
                    });
                }
            );
        });

        it('Should send mail using windows newlines', (t, done) => {
            let client = new StreamTransport({
                newline: 'windows'
            });
            let chunks: Buffer[] = [],
                message = new Array(100).join('teretere\nvana kere\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        newline: '\r\n',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);

                    info.message.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });

                    info.message.on('end', () => {
                        let body = Buffer.concat(chunks);
                        assert.strictEqual(body.toString(), message.replace(/\n/g, '\r\n'));
                        done();
                    });
                }
            );
        });
    });

    // Regression tests: the transport-level `newline` option must transform the
    // generated stream even when the message itself sets no `newline` value
    describe('Transport-level newline option', () => {
        it('Should apply windows newlines to the output stream', (t, done) => {
            let client = new StreamTransport({
                newline: 'windows'
            });
            let chunks: Buffer[] = [],
                message = new Array(100).join('teretere\nvana kere\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);

                    info.message.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });

                    info.message.on('end', () => {
                        let body = Buffer.concat(chunks);
                        assert.strictEqual(body.toString(), message.replace(/\n/g, '\r\n'));
                        done();
                    });
                }
            );
        });

        it('Should apply unix newlines to the output buffer', (t, done) => {
            let client = new StreamTransport({
                newline: 'unix',
                buffer: true
            });
            let message = new Array(100).join('teretere\r\nvana kere\r\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);
                    assert.strictEqual(info.message.toString(), message.replace(/\r\n/g, '\n'));
                    done();
                }
            );
        });
    });

    describe('Send as buffer', () => {
        it('Should send mail using unix newlines', (t, done) => {
            let client = new StreamTransport({
                buffer: true
            });
            let message = new Array(100).join('teretere\r\nvana kere\r\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        newline: '\n',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);
                    assert.strictEqual(info.message.toString(), message.replace(/\r\n/g, '\n'));
                    done();
                }
            );
        });

        it('Should send mail using windows newlines', (t, done) => {
            let client = new StreamTransport({
                newline: 'windows',
                buffer: true
            });
            let message = new Array(100).join('teretere\nvana kere\n');

            client.send(
                {
                    data: {},
                    message: new MailComposer({
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient',
                        newline: '\r\n',
                        raw: Buffer.from(message)
                    }).compile()
                } as any,
                (err, info: any) => {
                    assert.ok(!err);

                    assert.strictEqual(info.message.toString(), message.replace(/\n/g, '\r\n'));
                    done();
                }
            );
        });
    });
});

describe('Stream Transport failure modes', () => {
    const missingFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'does-not-exist.txt');

    it('Should log the recipient list with an overflow marker', (t, done) => {
        const { lines, logger } = captureLogger();
        const client = new StreamTransport({ logger, newline: 'windows' });
        const to = ['r1@valid.recipient', 'r2@valid.recipient', 'r3@valid.recipient', 'r4@valid.recipient', 'r5@valid.recipient'];
        const message = new MailComposer({ from: 'test@valid.sender', to, raw: Buffer.from('message') }).compile();

        client.send({ data: {}, message } as any, (err, info) => {
            assert.ok(!err);
            // the envelope still carries every recipient
            assert.deepStrictEqual(info!.envelope.to, to);
            const line = lines.find(line => line.entry.tnx === 'send');
            assert.ok(line, 'no send log line');
            assert.strictEqual(line.level, 'info');
            assert.strictEqual(
                line.message,
                'Sending message ' +
                    message.messageId() +
                    ' to <r1@valid.recipient, r2@valid.recipient, ...and 3 more> using <CR><LF> line breaks'
            );
            (info!.message as any).resume();
            done();
        });
    });

    it('Should report a message that can not be streamed', (t, done) => {
        const { lines, logger } = captureLogger();
        const client = new StreamTransport({ logger });
        const failure = new Error('no stream for you');
        const message = {
            getEnvelope: () => ({ from: 'test@valid.sender', to: ['test@valid.recipient'] }),
            messageId: () => '<broken@valid.sender>',
            createReadStream() {
                throw failure;
            }
        };

        client.send({ data: {}, message } as any, (err, info) => {
            assert.strictEqual(err, failure);
            assert.ok(!info);
            const line = lines.find(line => line.level === 'error');
            assert.ok(line, 'no error log line');
            assert.strictEqual(line.message, 'Creating send stream failed for <broken@valid.sender>. no stream for you');
            assert.strictEqual(line.entry.err, failure);
            done();
        });
    });

    it('Should report a stream error when returning a buffer', (t, done) => {
        const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });

        transporter.sendMail(
            {
                from: 'test@valid.sender',
                to: 'test@valid.recipient',
                text: 'hello',
                attachments: [{ filename: 'missing.txt', path: missingFile }]
            },
            (err: any, info) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ENOENT');
                assert.ok(!info);
                done();
            }
        );
    });

    it('Should hand back a stream that reports its own errors', (t, done) => {
        const { lines, logger } = captureLogger();
        const transporter = nodemailer.createTransport({ streamTransport: true, logger });

        transporter.sendMail(
            {
                from: 'test@valid.sender',
                to: 'test@valid.recipient',
                text: 'hello',
                attachments: [{ filename: 'missing.txt', path: missingFile }]
            },
            (err, info) => {
                assert.ok(!err);
                const stream = info.message as Readable;
                stream.on('error', (streamErr: any) => {
                    assert.strictEqual(streamErr.code, 'ENOENT');
                    const line = lines.find(line => line.level === 'error');
                    assert.ok(line, 'no error log line');
                    assert.ok(line.message.startsWith('Failed creating message for ' + info.messageId + '. ENOENT'), line.message);
                    done();
                });
                stream.resume();
            }
        );
    });
});
