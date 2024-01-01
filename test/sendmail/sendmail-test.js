'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PassThrough = require('stream').PassThrough;
const EventEmitter = require('events').EventEmitter;
const SendmailTransport = require('../../lib/sendmail-transport');
const MailComposer = require('../../lib/mail-composer');

class MockBuilder {
    constructor(envelope, message, messageId) {
        this.envelope = envelope;
        this.rawMessage = message;
        this.mid = messageId || '<test>';
    }

    getEnvelope() {
        return this.envelope;
    }

    messageId() {
        return this.mid;
    }

    createReadStream() {
        let stream = new PassThrough();
        setImmediate(() => stream.end(this.rawMessage));
        return stream;
    }

    getHeader() {
        return 'teretere';
    }
}

describe('Sendmail Transport Tests', () => {
    it('Should expose version number', () => {
        let client = new SendmailTransport();
        assert.ok(client.name);
        assert.ok(client.version);
    });

    it('Should send message', (t, done) => {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', chunk => {
            output += chunk.toString();
        });

        stubbedSpawn.stdin.on('end', () => {
            stubbedSpawn.emit('close', 0);
            stubbedSpawn.emit('exit', 0);
        });

        t.mock.method(client, '_spawn', () => stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MailComposer({
                    from: 'test@valid.sender',
                    to: 'test@valid.recipient',
                    newline: '\n',
                    raw: Buffer.from('message\r\nline 2')
                }).compile()
            },
            err => {
                assert.ok(!err);
                assert.strictEqual(output, 'message\nline 2\n');
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should reject message', (t, done) => {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', chunk => {
            output += chunk.toString();
        });

        stubbedSpawn.stdin.on('end', () => {
            stubbedSpawn.emit('close', 0);
            stubbedSpawn.emit('exit', 0);
        });

        t.mock.method(client, '_spawn', () => stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MockBuilder(
                    {
                        from: 'test@valid.sender',
                        to: '-d0.1a@example.com'
                    },
                    'message\r\nline 2'
                )
            },
            (err, data) => {
                assert.ok(err);
                assert.ok(!data);
                assert.strictEqual(output, '');
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should return an error', (t, done) => {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        stubbedSpawn.stdin.on('data', () => false);

        stubbedSpawn.stdin.on('end', () => {
            stubbedSpawn.emit('close', 127);
            stubbedSpawn.emit('exit', 127);
        });

        t.mock.method(client, '_spawn', () => stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MockBuilder(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'message\r\nline 2'
                )
            },
            (err, data) => {
                assert.ok(err);
                assert.ok(!data);
                t.mock.restoreAll();
                done();
            }
        );
    });
});
