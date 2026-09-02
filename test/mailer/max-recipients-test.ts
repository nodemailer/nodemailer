import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import nodemailer from '../../src/nodemailer.js';

const PORT_NUMBER = 8419;

const uniqueRecipients = (count: number) => {
    const list = new Array(count);
    for (let i = 0; i < count; i++) {
        list[i] = 'u' + i + '@example.com';
    }
    return list;
};

const message = (recipients: string | string[], extra?: { [key: string]: any }) =>
    Object.assign(
        {
            from: 'sender@example.com',
            to: recipients,
            subject: 'test',
            text: 'test'
        },
        extra || {}
    );

describe('maxRecipients', () => {
    describe('jsonTransport', () => {
        it('should reject a message over the transport limit', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });

            await assert.rejects(
                () => transport.sendMail(message(uniqueRecipients(11))),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
        });

        it('should report the limit through a callback', (t, done) => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });

            transport.sendMail(message(uniqueRecipients(11)), (err: any) => {
                assert.ok(err, 'expected an error');
                assert.strictEqual(err.code, 'EMAXRECIPIENTS');
                done();
            });
        });

        it('should accept a message on the limit', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });
            const info = await transport.sendMail(message(uniqueRecipients(10)));

            assert.strictEqual(info.envelope.to.length, 10);
        });

        it('should apply to a recipient array and a recipient string alike', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });

            await assert.rejects(
                () => transport.sendMail(message(uniqueRecipients(11))),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
            await assert.rejects(
                () => transport.sendMail(message(uniqueRecipients(11).join(','))),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
        });

        it('should count To, Cc and Bcc together, after deduplication', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 3 });

            await assert.rejects(
                () => transport.sendMail(message('a@example.com', { cc: 'b@example.com', bcc: ['c@example.com', 'd@example.com'] })),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );

            const info = await transport.sendMail(message('a@example.com, a@example.com', { cc: 'b@example.com' }));
            assert.deepStrictEqual(info.envelope.to, ['a@example.com', 'b@example.com']);
        });

        it('should honour a per message limit when the transport sets none', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true });

            await assert.rejects(
                () => transport.sendMail(message(uniqueRecipients(11), { maxRecipients: 10 })),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
        });

        // The transport option is forced over message data, the same as disableFileAccess, so
        // a message cannot raise a limit the transport owner set.
        it('should not let a message raise the transport limit', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });

            await assert.rejects(
                () => transport.sendMail(message(uniqueRecipients(11), { maxRecipients: 1000 })),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
        });

        // A caller supplied envelope goes straight to the transport, so it has to be counted
        // too, otherwise the option is a bypass rather than a limit.
        it('should apply to a caller supplied envelope', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 10 });

            await assert.rejects(
                () => transport.sendMail(message('a@example.com', { envelope: { from: 'sender@example.com', to: uniqueRecipients(11) } })),
                (err: any) => err.code === 'EMAXRECIPIENTS'
            );
        });

        it('should treat 0 as no limit', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true, maxRecipients: 0 });
            const info = await transport.sendMail(message(uniqueRecipients(2000)));

            assert.strictEqual(info.envelope.to.length, 2000);
        });

        it('should default to allowing an ordinary recipient list', async () => {
            const transport = nodemailer.createTransport({ jsonTransport: true });
            const info = await transport.sendMail(message(uniqueRecipients(500)));

            assert.strictEqual(info.envelope.to.length, 500);
        });
    });

    // The SMTP transports read the envelope inside an async continuation, well after send()
    // has returned, so a limit enforced by throwing from there would leave sendMail with
    // nothing to catch it and take the process down instead of reaching the caller.
    describe('SMTP transports', () => {
        let server: any;

        before(
            () =>
                new Promise(resolve => {
                    server = new SMTPServer({
                        disabledCommands: ['STARTTLS', 'AUTH'],
                        onData(stream: any, session: any, callback: any) {
                            stream.on('data', () => {});
                            stream.on('end', callback);
                        }
                    });
                    server.listen(PORT_NUMBER, resolve);
                })
        );

        after(() => new Promise(resolve => server.close(resolve)));

        for (const pool of [false, true]) {
            const label = pool ? 'pooled' : 'unpooled';

            it(`should reject over the limit without crashing (${label})`, async () => {
                const transport = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: PORT_NUMBER,
                    secure: false,
                    pool,
                    maxRecipients: 2
                });

                await assert.rejects(
                    () => transport.sendMail(message(['x@example.com', 'y@example.com', 'z@example.com'])),
                    (err: any) => err.code === 'EMAXRECIPIENTS'
                );
                transport.close();
            });

            it(`should deliver a message under the limit (${label})`, async () => {
                const transport = nodemailer.createTransport({
                    host: '127.0.0.1',
                    port: PORT_NUMBER,
                    secure: false,
                    pool,
                    maxRecipients: 5
                });
                const info = await transport.sendMail(message(['x@example.com', 'y@example.com', 'z@example.com']));

                assert.strictEqual(info.accepted.length, 3);
                transport.close();
            });
        }
    });
});
