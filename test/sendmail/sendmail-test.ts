process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SendmailTransport from '../../src/sendmail-transport/index.js';
import MailComposer from '../../src/mail-composer/index.js';
import nodemailer from '../../src/nodemailer.js';
import { captureLogger } from '../smtp-transport/smtp-fixtures.js';

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

// a spawn stub whose stdin is consumed and that records how it was killed; exiting is up to
// the test
function idleSpawn() {
    const spawned: any = new EventEmitter();
    spawned.stdin = new PassThrough();
    spawned.stdout = new PassThrough();
    spawned.stdin.on('data', () => false);
    spawned.killedWith = [];
    spawned.kill = (signal: string) => spawned.killedWith.push(signal);
    return spawned;
}

// a message whose stream fails before any content is written
class FailingBuilder extends MockBuilder {
    failure: Error;

    constructor(failure: Error) {
        super({ from: 'test@valid.sender', to: 'test@valid.recipient' }, 'message');
        this.failure = failure;
    }

    override createReadStream() {
        const stream = new PassThrough();
        setImmediate(() => stream.emit('error', this.failure));
        return stream;
    }
}

describe('Sendmail Transport options and failure modes', () => {
    const compiled = (to: string | string[] = 'test@valid.recipient') =>
        ({
            data: {},
            message: new MailComposer({
                from: 'test@valid.sender',
                to,
                raw: Buffer.from('message')
            }).compile()
        }) as any;

    it('Should take the sendmail path from a string option', () => {
        const client = new SendmailTransport('/usr/local/bin/sendmail');

        assert.strictEqual(client.path, '/usr/local/bin/sendmail');
        assert.strictEqual(client.args, false);
        assert.strictEqual(client.winbreak, false);
    });

    it('Should take the path, args and newline options', () => {
        const client = new SendmailTransport({ path: '/opt/sendmail', args: ['-t', '-oi'], newline: 'DOS' });

        assert.strictEqual(client.path, '/opt/sendmail');
        assert.deepStrictEqual(client.args, ['-t', '-oi']);
        assert.strictEqual(client.winbreak, true);
    });

    it('Should spawn the configured path with the custom args and the recipients', (t, done) => {
        const client = new SendmailTransport({ path: '/opt/sendmail', args: ['-t', '-X', '/var/log/sendmail.log'] });
        const mail = compiled(['a@valid.recipient', 'b@valid.recipient']);
        let spawnedPath: string | undefined;
        let spawnedArgs: string[] | undefined;

        t.mock.method(client, '_spawn', (path: string, args: string[]) => {
            spawnedPath = path;
            spawnedArgs = args;
            return completingSpawn();
        });

        client.send(mail, (err, info) => {
            assert.ok(!err);
            assert.strictEqual(spawnedPath, '/opt/sendmail');
            // custom args replace the default -f <sender>, -i is always forced
            assert.deepStrictEqual(spawnedArgs, ['-i', '-t', '-X', '/var/log/sendmail.log', 'a@valid.recipient', 'b@valid.recipient']);
            assert.strictEqual(info!.response, 'Messages queued for delivery');
            assert.strictEqual(info!.messageId, mail.message.messageId());
            assert.deepStrictEqual(info!.envelope, { from: 'test@valid.sender', to: ['a@valid.recipient', 'b@valid.recipient'] });
            t.mock.restoreAll();
            done();
        });
    });

    it('Should report a synchronous spawn failure', (t, done) => {
        const client = new SendmailTransport();
        const failure: any = new Error('spawn EACCES');
        failure.code = 'EACCES';

        t.mock.method(client, '_spawn', () => {
            throw failure;
        });

        client.send(compiled(), (err, info) => {
            assert.strictEqual(err, failure);
            assert.ok(!info);
            t.mock.restoreAll();
            done();
        });
    });

    it('Should report a missing binary when spawn returns nothing', (t, done) => {
        const client = new SendmailTransport();

        t.mock.method(client, '_spawn', () => null);

        client.send(compiled(), (err: any, info) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ESENDMAIL');
            assert.strictEqual(err.message, 'sendmail was not found');
            assert.ok(!info);
            t.mock.restoreAll();
            done();
        });
    });

    it('Should report an error event of the child process once', (t, done) => {
        const client = new SendmailTransport();
        const failure: any = new Error('spawn sendmail ENOENT');
        failure.code = 'ENOENT';
        const spawned = idleSpawn();
        let calls = 0;

        spawned.stdin.on('end', () => {
            spawned.emit('error', failure);
            // a failed spawn is followed by exit and close events
            spawned.emit('exit', 1);
            spawned.emit('close', 1);
        });

        t.mock.method(client, '_spawn', () => spawned);

        client.send(compiled(), (err, info) => {
            calls++;
            assert.strictEqual(err, failure);
            assert.ok(!info);
            setImmediate(() => {
                assert.strictEqual(calls, 1);
                t.mock.restoreAll();
                done();
            });
        });
    });

    it('Should report an stdin error', (t, done) => {
        const client = new SendmailTransport();
        const failure: any = new Error('write EPIPE');
        failure.code = 'EPIPE';
        const spawned = idleSpawn();
        let calls = 0;

        spawned.stdin.once('data', () => spawned.stdin.emit('error', failure));

        t.mock.method(client, '_spawn', () => spawned);

        client.send(compiled(), (err, info) => {
            calls++;
            assert.strictEqual(err, failure);
            assert.ok(!info);
            setImmediate(() => {
                assert.strictEqual(calls, 1);
                t.mock.restoreAll();
                done();
            });
        });
    });

    it('Should describe a non-zero exit code', (t, done) => {
        const client = new SendmailTransport();
        const spawned = idleSpawn();

        spawned.stdin.on('end', () => {
            spawned.emit('exit', 75);
            spawned.emit('close', 75);
        });

        t.mock.method(client, '_spawn', () => spawned);

        client.send(compiled(), (err: any, info) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ESENDMAIL');
            assert.strictEqual(err.message, 'Sendmail exited with code 75');
            assert.ok(!info);
            t.mock.restoreAll();
            done();
        });
    });

    it('Should describe exit code 127 as a missing command', (t, done) => {
        const client = new SendmailTransport();
        const spawned = idleSpawn();

        spawned.stdin.on('end', () => {
            spawned.emit('exit', 127);
            spawned.emit('close', 127);
        });

        t.mock.method(client, '_spawn', () => spawned);

        client.send(compiled(), (err: any) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ESENDMAIL');
            assert.strictEqual(err.message, 'Sendmail command not found, process exited with code 127');
            t.mock.restoreAll();
            done();
        });
    });

    it('Should kill sendmail and report the error when the message stream fails', (t, done) => {
        const client = new SendmailTransport();
        const failure = new Error('template failed');
        const spawned = idleSpawn();
        let calls = 0;

        t.mock.method(client, '_spawn', () => spawned);

        client.send({ data: {}, message: new FailingBuilder(failure) } as any, (err, info) => {
            calls++;
            assert.strictEqual(err, failure);
            assert.ok(!info);
            assert.deepStrictEqual(spawned.killedWith, ['SIGINT']);
            setImmediate(() => {
                assert.strictEqual(calls, 1);
                t.mock.restoreAll();
                done();
            });
        });
    });

    it('Should forward a message stream error through the newline transform', (t, done) => {
        const client = new SendmailTransport({ newline: 'windows' });
        const failure = new Error('template failed');
        const spawned = idleSpawn();

        t.mock.method(client, '_spawn', () => spawned);

        client.send({ data: {}, message: new FailingBuilder(failure) } as any, (err, info) => {
            assert.strictEqual(err, failure);
            assert.ok(!info);
            assert.deepStrictEqual(spawned.killedWith, ['SIGINT']);
            t.mock.restoreAll();
            done();
        });
    });

    it('Should log the recipient list with an overflow marker', (t, done) => {
        const { lines, logger } = captureLogger();
        const client = new SendmailTransport({ logger });
        const to = ['r1@valid.recipient', 'r2@valid.recipient', 'r3@valid.recipient', 'r4@valid.recipient', 'r5@valid.recipient'];
        const mail = compiled(to);

        t.mock.method(client, '_spawn', () => completingSpawn());

        client.send(mail, (err, info) => {
            assert.ok(!err);
            // the argument list still carries every recipient
            assert.deepStrictEqual(info!.envelope.to, to);
            const line = lines.find(line => line.entry.tnx === 'send');
            assert.ok(line, 'no send log line');
            assert.strictEqual(line.level, 'info');
            assert.strictEqual(
                line.message,
                'Sending message ' + mail.message.messageId() + ' to <r1@valid.recipient, r2@valid.recipient, ...and 3 more>'
            );
            t.mock.restoreAll();
            done();
        });
    });
});

// a shell script stands in for the sendmail binary: it records its arguments and its stdin
describe('Sendmail Transport with a real child process', { skip: process.platform === 'win32', timeout: 10000 }, () => {
    let dir: string;

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodemailer-sendmail-'));
    });

    after(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const writeScript = (name: string, body: string): string => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, '#!/bin/sh\n' + body, { mode: 0o755 });
        return file;
    };

    it('should pipe the message to the binary with the envelope as arguments', (t, done) => {
        const output = path.join(dir, 'received.txt');
        const script = writeScript('sendmail-ok.sh', 'printf "%s\\n" "$*" > "' + output + '"\ncat >> "' + output + '"\n');
        const transporter = nodemailer.createTransport({ sendmail: true, path: script, newline: 'unix' });

        transporter.sendMail(
            { from: 'sender@example.com', to: ['a@example.com', 'b@example.com'], subject: 'real process', text: 'hello' },
            (err, info) => {
                assert.ok(!err);
                assert.strictEqual(info.response, 'Messages queued for delivery');
                assert.deepStrictEqual(info.envelope, { from: 'sender@example.com', to: ['a@example.com', 'b@example.com'] });

                const received = fs.readFileSync(output, 'utf8');
                const [argLine, ...rest] = received.split('\n');
                const body = rest.join('\n');
                assert.strictEqual(argLine, '-i -f sender@example.com a@example.com b@example.com');
                assert.ok(body.includes('\nSubject: real process\n'), body);
                assert.ok(body.includes('\n\nhello'), body);
                assert.ok(!body.includes('\r'), 'expected unix newlines');
                done();
            }
        );
    });

    it('should report the exit code of a failing binary', (t, done) => {
        const script = writeScript('sendmail-fail.sh', 'cat > /dev/null\nexit 75\n');
        const transporter = nodemailer.createTransport({ sendmail: true, path: script });

        transporter.sendMail({ from: 'sender@example.com', to: 'a@example.com', subject: 'fail', text: 'hello' }, (err: any) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ESENDMAIL');
            assert.strictEqual(err.message, 'Sendmail exited with code 75');
            done();
        });
    });

    it('should report a binary that does not exist', (t, done) => {
        const transporter = nodemailer.createTransport({ sendmail: true, path: path.join(dir, 'does-not-exist') });

        transporter.sendMail({ from: 'sender@example.com', to: 'a@example.com', subject: 'missing', text: 'hello' }, (err: any) => {
            assert.ok(err);
            assert.strictEqual(err.code, 'ENOENT');
            done();
        });
    });
});
