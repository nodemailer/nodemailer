/**
 * err.permanent: set from the reply class whenever an error carries an SMTP reply, at every
 * stage of the session, and left unset on errors no server reply produced.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPermanentResponseCode, type NodemailerError } from '../../src/errors.js';
import { createClient, closeRawServer, startRawServerAsync, type RawServerScript } from './raw-smtp-server.js';
import SMTPConnection, { type SMTPConnectionOptions } from '../../src/smtp-connection/index.js';
import nodemailer from '../../src/nodemailer.js';

const envelope = { from: 'sender@example.com', to: ['recipient@example.com'] };

/**
 * Runs one session against a scripted server and resolves with the error it failed with
 */
async function sessionError(
    script: RawServerScript,
    options: { auth?: boolean; client?: Partial<SMTPConnectionOptions>; to?: string[] } = {}
): Promise<NodemailerError> {
    const server = await startRawServerAsync({ EHLO: '250-test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n', ...script });
    const client = createClient(server, options.client);
    client.on('error', () => false);
    try {
        return await new Promise<NodemailerError>((resolve, reject) => {
            client.connect(() => {
                const send = () =>
                    client.send({ ...envelope, to: options.to || envelope.to }, 'Subject: test\r\n\r\nbody', err =>
                        err ? resolve(err) : reject(new Error('expected the message to fail'))
                    );
                if (!options.auth) {
                    return send();
                }
                client.login({ user: 'user', pass: 'pass' }, err => (err ? resolve(err) : send()));
            });
        });
    } finally {
        client.close();
        await closeRawServer(server);
    }
}

describe('Permanent and transient errors', () => {
    describe('isPermanentResponseCode()', () => {
        it('treats 5xx as permanent except 503', () => {
            for (const code of [500, 501, 502, 504, 521, 530, 535, 550, 551, 552, 553, 554, 556]) {
                assert.strictEqual(isPermanentResponseCode(code), true, String(code));
            }
            assert.strictEqual(isPermanentResponseCode(503), false);
        });

        it('treats every other reply class as not permanent', () => {
            for (const code of [211, 220, 235, 250, 334, 354, 421, 450, 451, 452, 454, 455, 600, 999]) {
                assert.strictEqual(isPermanentResponseCode(code), false, String(code));
            }
        });
    });

    describe('Envelope phase', () => {
        for (const [reply, permanent] of [
            ['550 5.1.8 Sender rejected', true],
            ['451 4.7.1 Greylisted, try again later', false],
            ['503 5.5.1 Bad sequence of commands', false]
        ] as const) {
            it(`marks a MAIL FROM "${reply}" as permanent=${permanent}`, async () => {
                const err = await sessionError({ MAIL: reply + '\r\n' });
                assert.strictEqual(err.code, 'EENVELOPE');
                assert.strictEqual(err.command, 'MAIL FROM');
                assert.strictEqual(err.responseCode, Number(reply.slice(0, 3)));
                assert.strictEqual(err.permanent, permanent);
            });
        }

        it('marks a recipient rejected for good as permanent', async () => {
            const err = await sessionError({ RCPT: '550 5.1.1 No such user\r\n' });
            assert.strictEqual(err.code, 'EENVELOPE');
            assert.strictEqual(err.command, 'RCPT TO');
            assert.strictEqual(err.responseCode, 550);
            assert.strictEqual(err.permanent, true);
            assert.strictEqual(err.rejectedErrors?.[0].permanent, true);
        });

        it('marks a deferred recipient as transient', async () => {
            const err = await sessionError({ RCPT: '450 4.2.0 Mailbox busy\r\n' });
            assert.strictEqual(err.code, 'EENVELOPE');
            assert.strictEqual(err.responseCode, 450);
            assert.strictEqual(err.permanent, false);
        });

        it('marks the whole message transient when one of the rejected recipients was only deferred', async () => {
            const err = await sessionError(
                { RCPT: line => (/deferred/.test(line) ? '451 4.3.0 Try later\r\n' : '550 5.1.1 No such user\r\n') },
                { to: ['missing@example.com', 'deferred@example.com'] }
            );
            assert.strictEqual(err.permanent, false);
            assert.deepStrictEqual(
                err.rejectedErrors?.map(rejected => rejected.permanent),
                [true, false]
            );
        });

        it('marks a refused DATA command by its reply', async () => {
            const permanent = await sessionError({ DATA: '554 5.5.1 No valid recipients\r\n' });
            assert.strictEqual(permanent.command, 'DATA');
            assert.strictEqual(permanent.permanent, true);

            const transient = await sessionError({ DATA: '451 4.3.0 Local error\r\n' });
            assert.strictEqual(transient.command, 'DATA');
            assert.strictEqual(transient.permanent, false);
        });
    });

    describe('Message phase', () => {
        it('marks a message refused after the final dot as permanent', async () => {
            const err = await sessionError({ DATA_END: '554 5.7.1 Message rejected as spam\r\n' });
            assert.strictEqual(err.code, 'EMESSAGE');
            assert.strictEqual(err.responseCode, 554);
            assert.strictEqual(err.permanent, true);
        });

        it('marks a message deferred after the final dot as transient', async () => {
            const err = await sessionError({ DATA_END: '452 4.3.1 Insufficient system storage\r\n' });
            assert.strictEqual(err.code, 'EMESSAGE');
            assert.strictEqual(err.responseCode, 452);
            assert.strictEqual(err.permanent, false);
        });

        it('marks each LMTP recipient by its own reply', async () => {
            // LMTP answers the final dot once per recipient, and a message some recipients took
            // is not failed as a whole, the refused ones are listed on the result
            const server = await startRawServerAsync({
                LHLO: '250 test\r\n',
                DATA_END: '250 2.0.0 OK\r\n452 4.2.2 Mailbox busy\r\n552 5.2.2 Mailbox full\r\n'
            });
            const client = createClient(server, { lmtp: true });
            try {
                const info = await new Promise<SMTPConnection.SentMessageInfo>((resolve, reject) =>
                    client.connect(() =>
                        client.send(
                            { from: 'sender@example.com', to: ['first@example.com', 'second@example.com', 'third@example.com'] },
                            'Subject: test\r\n\r\nbody',
                            (err, info) => (err ? reject(err) : resolve(info))
                        )
                    )
                );
                assert.deepStrictEqual(info.accepted, ['first@example.com']);
                assert.deepStrictEqual(
                    info.rejectedErrors?.map(rejected => [rejected.recipient, rejected.responseCode, rejected.permanent]),
                    [
                        ['second@example.com', 452, false],
                        ['third@example.com', 552, true]
                    ]
                );
            } finally {
                client.close();
                await closeRawServer(server);
            }
        });
    });

    describe('Authentication phase', () => {
        it('marks rejected credentials as permanent', async () => {
            const err = await sessionError({ AUTH: '535 5.7.8 Authentication credentials invalid\r\n' }, { auth: true });
            assert.strictEqual(err.code, 'EAUTH');
            assert.strictEqual(err.responseCode, 535);
            assert.strictEqual(err.permanent, true);
        });

        it('marks a temporary authentication failure as transient', async () => {
            const err = await sessionError({ AUTH: '454 4.7.0 Temporary authentication failure\r\n' }, { auth: true });
            assert.strictEqual(err.code, 'EAUTH');
            assert.strictEqual(err.responseCode, 454);
            assert.strictEqual(err.permanent, false);
        });

        it('does not mark missing credentials, no server replied', async () => {
            const server = await startRawServerAsync({ EHLO: '250-test\r\n250 AUTH PLAIN\r\n' });
            const client = createClient(server);
            try {
                const err = await new Promise<NodemailerError>(resolve =>
                    client.connect(() => client.login({ user: 'user' } as SMTPConnection.AuthenticationType, err => resolve(err as NodemailerError)))
                );
                assert.strictEqual(err.code, 'EAUTH');
                assert.strictEqual(err.responseCode, undefined);
                assert.strictEqual('permanent' in err, false);
            } finally {
                client.close();
                await closeRawServer(server);
            }
        });
    });

    describe('Errors without a server reply', () => {
        it('does not mark an envelope the client refused before sending it', async () => {
            const server = await startRawServerAsync({});
            const client = createClient(server);
            try {
                const err = await new Promise<NodemailerError>(resolve =>
                    client.connect(() => client.send({ from: 'sender@example.com', to: [] }, 'x', err => resolve(err as NodemailerError)))
                );
                assert.strictEqual(err.code, 'EENVELOPE');
                assert.strictEqual('permanent' in err, false);
            } finally {
                client.close();
                await closeRawServer(server);
            }
        });

        it('does not mark a refused connection', async () => {
            const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: 1, logger: false });
            await assert.rejects(
                transporter.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', text: 'x' }),
                (err: NodemailerError) => err.code === 'ESOCKET' && !('permanent' in err)
            );
        });
    });

    it('reaches the sendMail() caller of the SMTP transport', async () => {
        const server = await startRawServerAsync({ RCPT: '550 5.1.1 No such user\r\n' });
        const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: server.port, ignoreTLS: true, logger: false });
        try {
            await assert.rejects(
                transporter.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', text: 'x' }),
                (err: NodemailerError) => err.code === 'EENVELOPE' && err.permanent === true
            );
        } finally {
            transporter.close();
            await closeRawServer(server);
        }
    });
});
