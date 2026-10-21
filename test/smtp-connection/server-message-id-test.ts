/**
 * info.serverMessageId: the Message-ID a receiving server names in its final 250 reply.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseServerMessageId } from '../../src/smtp-connection/server-message-id.js';
import { closeRawServer, startRawServerAsync, type RawServer } from './raw-smtp-server.js';
import nodemailer from '../../src/nodemailer.js';

const OUTLOOK_ID = '<AM0PR07MB6115C1B4F0F5D2B2A1B2C3D4E5F6A7B8C9D0E@AM0PR07MB6115.eurprd07.prod.outlook.com>';
const OUTLOOK_REPLY = '250 2.0.0 OK ' + OUTLOOK_ID + ' [Hostname=AM0PR07MB6115.eurprd07.prod.outlook.com]';
const SES_ID = '0100018b5c3c0a4f-1e9a7c8b-6d2f-4c3a-9b1e-7f8a9b0c1d2e-000000';
const SES_REPLY = '250 Ok ' + SES_ID;

describe('Server assigned Message-ID', () => {
    describe('parseServerMessageId()', () => {
        it('reads the Message-ID out of a Microsoft 365 reply', () => {
            assert.strictEqual(parseServerMessageId(OUTLOOK_REPLY), OUTLOOK_ID);
            assert.strictEqual(parseServerMessageId(OUTLOOK_REPLY, 'smtp.office365.com'), OUTLOOK_ID);
            // the hostname suffix is not required
            assert.strictEqual(parseServerMessageId('250 2.0.0 OK ' + OUTLOOK_ID), OUTLOOK_ID);
        });

        it('builds the Message-ID of an SES reply from the region of the SES host', () => {
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'email-smtp.eu-west-1.amazonaws.com'), '<' + SES_ID + '@eu-west-1.amazonses.com>');
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'email-smtp.ap-southeast-2.amazonaws.com'), '<' + SES_ID + '@ap-southeast-2.amazonses.com>');
            // us-east-1 uses the email.amazonses.com domain
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'email-smtp.us-east-1.amazonaws.com'), '<' + SES_ID + '@email.amazonses.com>');
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'EMAIL-SMTP.US-WEST-2.AMAZONAWS.COM.'), '<' + SES_ID + '@us-west-2.amazonses.com>');
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'email-smtp-fips.us-gov-west-1.amazonaws.com'), '<' + SES_ID + '@us-gov-west-1.amazonses.com>');
            // a VPC endpoint name has more labels after the region
            assert.strictEqual(
                parseServerMessageId(SES_REPLY, 'vpce-0123456789abcdef0-abcdefgh.email-smtp.eu-central-1.vpce.amazonaws.com'),
                '<' + SES_ID + '@eu-central-1.amazonses.com>'
            );
            assert.strictEqual(
                parseServerMessageId('250 Ok ' + SES_ID.toUpperCase(), 'email-smtp.eu-west-1.amazonaws.com'),
                '<' + SES_ID + '@eu-west-1.amazonses.com>'
            );
        });

        it('does not read an SES shaped reply from a host outside AWS', () => {
            assert.strictEqual(parseServerMessageId(SES_REPLY), undefined);
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'smtp.example.com'), undefined);
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'email-smtp.eu-west-1.amazonaws.com.example.com'), undefined);
            // an amazonaws.com host without a region in its name
            assert.strictEqual(parseServerMessageId(SES_REPLY, 'amazonaws.com'), undefined);
        });

        it('leaves unknown replies alone', () => {
            for (const reply of [
                undefined,
                '',
                '250 OK: message queued',
                '250 2.0.0 Ok: queued as 4ZqS3m0yKrz9rxN',
                '250 2.0.0 OK  1697040000 a1-20020a05600c000100b00406c1ff8b7csi123456wmq.12 - gsmtp',
                '250 2.0.0 OK <id@example.com>',
                '250 2.0.0 OK <id@prod.outlook.com.example.com>',
                '251 2.0.0 OK ' + OUTLOOK_ID,
                '250 Ok ' + SES_ID + ' trailing',
                '250 Ok not-hex-at-all',
                '250 Ok 0100018b5c3c0a4f'
            ]) {
                assert.strictEqual(parseServerMessageId(reply, 'email-smtp.eu-west-1.amazonaws.com'), undefined, String(reply));
            }
        });

        it('reads a long reply in linear time', () => {
            const reply = '250 2.0.0 OK <' + 'a.'.repeat(200000) + 'prod.outlook.co>';
            const start = Date.now();
            assert.strictEqual(parseServerMessageId(reply), undefined);
            assert.strictEqual(parseServerMessageId('250 Ok ' + '0-'.repeat(200000) + 'x', 'email-smtp.eu-west-1.amazonaws.com'), undefined);
            const elapsed = Date.now() - start;
            assert.ok(elapsed < 1000, `took ${elapsed} ms`);
        });
    });

    describe('send results', () => {
        const message = { from: 'sender@example.com', to: 'recipient@example.com', subject: 'test', text: 'hello' };

        // a transport whose socket goes to the scripted server whatever host it was given
        const transportFor = (server: RawServer, host: string, pool: boolean) =>
            nodemailer.createTransport({
                pool,
                host,
                port: server.port,
                ignoreTLS: true,
                logger: false,
                getSocket(options: unknown, callback: (err: Error | null, socket?: { connection: net.Socket }) => void) {
                    const socket = net.connect(server.port, '127.0.0.1');
                    socket.once('connect', () => callback(null, { connection: socket }));
                    socket.once('error', err => callback(err));
                }
            });

        for (const pool of [false, true]) {
            const kind = pool ? 'smtp-pool' : 'smtp-transport';

            it(`sets serverMessageId from a Microsoft 365 reply with ${kind}`, async () => {
                const server = await startRawServerAsync({ DATA_END: OUTLOOK_REPLY + '\r\n' });
                const transporter = transportFor(server, 'smtp.office365.com', pool);
                try {
                    const info = await transporter.sendMail(message);
                    assert.strictEqual(info.serverMessageId, OUTLOOK_ID);
                    assert.notStrictEqual(info.messageId, OUTLOOK_ID);
                    assert.strictEqual(info.response, OUTLOOK_REPLY);
                } finally {
                    transporter.close();
                    await closeRawServer(server);
                }
            });

            it(`sets serverMessageId from an SES reply with ${kind}`, async () => {
                const server = await startRawServerAsync({ DATA_END: SES_REPLY + '\r\n' });
                const transporter = transportFor(server, 'email-smtp.eu-west-1.amazonaws.com', pool);
                try {
                    const info = await transporter.sendMail(message);
                    assert.strictEqual(info.serverMessageId, '<' + SES_ID + '@eu-west-1.amazonses.com>');
                } finally {
                    transporter.close();
                    await closeRawServer(server);
                }
            });

            it(`leaves serverMessageId out for an unknown reply with ${kind}`, async () => {
                const server = await startRawServerAsync({ DATA_END: '250 2.0.0 Ok: queued as 4ZqS3m0yKrz9rxN\r\n' });
                const transporter = transportFor(server, 'smtp.example.com', pool);
                try {
                    const info = await transporter.sendMail(message);
                    assert.strictEqual('serverMessageId' in info, false);
                    assert.ok(info.messageId);
                } finally {
                    transporter.close();
                    await closeRawServer(server);
                }
            });
        }
    });
});
