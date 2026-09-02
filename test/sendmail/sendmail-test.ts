process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import SendmailTransport from '../../src/sendmail-transport/index.js';
import MailComposer from '../../src/mail-composer/index.js';

class MockBuilder {
    envelope: { from: string; to: string };
    rawMessage: string;
    mid: string;

    constructor(envelope: { from: string; to: string }, message: string, messageId?: string) {
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

// a spawn stub that runs to completion, so a test asserting that the transport bailed out
// early reports a failed assertion instead of leaving its callback pending
function completingSpawn() {
    let spawned: any = new EventEmitter();
    spawned.stdin = new PassThrough();
    spawned.stdout = new PassThrough();
    spawned.stdin.on('data', () => false);
    spawned.stdin.on('end', () => {
        spawned.emit('close', 0);
        spawned.emit('exit', 0);
    });
    return spawned;
}

describe('Sendmail Transport Tests', () => {
    it('Should expose version number', () => {
        let client = new SendmailTransport();
        assert.ok(client.name);
        assert.ok(client.version);
    });

    it('Should send message', (t, done) => {
        let client = new SendmailTransport();

        let stubbedSpawn: any = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', (chunk: Buffer) => {
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
            } as any,
            err => {
                assert.ok(!err);
                assert.strictEqual(output, 'message\nline 2\n');
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should reject an envelope address that sendmail would read as an option', (t, done) => {
        let client = new SendmailTransport();
        let spawned = false;

        t.mock.method(client, '_spawn', () => {
            spawned = true;
            return completingSpawn();
        });

        client.send(
            {
                data: {},
                message: new MailComposer({
                    // the local part carries specials, so it goes out quoted and the dash
                    // ends up behind the opening quote instead of at the start of the argument
                    from: '-X[a]@example.com',
                    to: 'test@valid.recipient',
                    raw: Buffer.from('message')
                }).compile()
            } as any,
            (err: any) => {
                assert.ok(err);
                assert.strictEqual(err.code, 'ESENDMAIL');
                assert.strictEqual(spawned, false);
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should normalize the addresses of a custom envelope', (t, done) => {
        let client = new SendmailTransport();
        let envelope = {
            from: 'a@evil.com@good.com',
            to: ['b@evil.com@good.com']
        };

        let args: string[] | undefined;
        t.mock.method(client, '_spawn', (path: string, spawnArgs: string[]) => {
            args = spawnArgs;
            return completingSpawn();
        });

        client.send(
            {
                // a custom envelope used to reach argv unnormalized, so the header and the
                // envelope disagreed on which side of the '@' the domain starts
                data: { envelope },
                message: new MailComposer({
                    envelope,
                    raw: Buffer.from('message')
                }).compile()
            } as any,
            err => {
                assert.ok(!err);
                assert.deepStrictEqual(args, ['-i', '-f', '"a@evil.com"@good.com', '"b@evil.com"@good.com']);
                t.mock.restoreAll();
                done();
            }
        );
    });

    // Regression tests: the transport-level `newline` option must transform the
    // message piped to the sendmail binary
    it('Should apply transport-level windows newlines', (t, done) => {
        let client = new SendmailTransport({ newline: 'windows' });

        let stubbedSpawn: any = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', (chunk: Buffer) => {
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
                        to: 'test@valid.recipient'
                    },
                    'message\nline 2'
                )
            } as any,
            err => {
                assert.ok(!err);
                assert.strictEqual(output, 'message\r\nline 2');
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should apply transport-level unix newlines', (t, done) => {
        let client = new SendmailTransport({ newline: 'unix' });

        let stubbedSpawn: any = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', (chunk: Buffer) => {
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
                        to: 'test@valid.recipient'
                    },
                    'message\r\nline 2'
                )
            } as any,
            err => {
                assert.ok(!err);
                assert.strictEqual(output, 'message\nline 2');
                t.mock.restoreAll();
                done();
            }
        );
    });

    it('Should reject message', (t, done) => {
        let client = new SendmailTransport();

        let stubbedSpawn: any = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', (chunk: Buffer) => {
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
            } as any,
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

        let stubbedSpawn: any = new EventEmitter();
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
            } as any,
            (err, data) => {
                assert.ok(err);
                assert.ok(!data);
                t.mock.restoreAll();
                done();
            }
        );
    });
});
