'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const StreamTransport = require('../../lib/stream-transport');
const MailComposer = require('../../lib/mail-composer');

describe('Stream Transport Tests', { timeout: 10000 }, () => {
    it('Should expose version number', () => {
        let client = new StreamTransport();
        assert.ok(client.name);
        assert.ok(client.version);
    });

    describe('Send as stream', () => {
        it('Should send mail using unix newlines 1', (t, done) => {
            let client = new StreamTransport();
            let chunks = [],
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
                },
                (err, info) => {
                    assert.ok(!err);

                    assert.deepStrictEqual(info.envelope, {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient']
                    });

                    info.message.on('data', chunk => {
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
            let chunks = [],
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
                },
                (err, info) => {
                    assert.ok(!err);

                    assert.deepStrictEqual(info.envelope, {
                        from: 'test@valid.sender',
                        to: ['test@valid.recipient']
                    });

                    info.message.on('data', chunk => {
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
            let chunks = [],
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
                },
                (err, info) => {
                    assert.ok(!err);

                    info.message.on('data', chunk => {
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
                },
                (err, info) => {
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
                },
                (err, info) => {
                    assert.ok(!err);

                    assert.strictEqual(info.message.toString(), message.replace(/\n/g, '\r\n'));
                    done();
                }
            );
        });
    });
});
