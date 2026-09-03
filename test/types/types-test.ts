import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from '../../src/nodemailer.js';
import type { Address, Attachment, MailMessage, SendMailOptions, SentMessageInfo, Transport, Transporter } from '../../src/nodemailer.js';
import Mail from '../../src/mailer/index.js';
import SMTPTransport from '../../src/smtp-transport/index.js';
import SMTPPool from '../../src/smtp-pool/index.js';
import SMTPConnection from '../../src/smtp-connection/index.js';
import JSONTransport from '../../src/json-transport/index.js';
import DKIM from '../../src/dkim/index.js';
import XOAuth2 from '../../src/xoauth2/index.js';

// These tests exist for the type checker: they keep the public type surface
// and the @types/nodemailer style aliases (Mail.Options, SMTPTransport.Options)
// compiling. The runtime assertions are incidental.
describe('Type surface', () => {
    it('accepts message data through the aliases', () => {
        const address: Address = { name: 'Recipient', address: 'recipient@example.com' };
        const attachment: Attachment = { filename: 'notes.txt', content: 'notes', contentType: 'text/plain' };
        const message: Mail.Options = {
            from: 'sender@example.com',
            to: [address, 'other@example.com'],
            subject: 'Typed message',
            text: 'plain text',
            html: { path: '/tmp/message.html' },
            attachments: [attachment],
            headers: { 'X-Custom': 'value' },
            list: { unsubscribe: { url: 'https://example.com/unsubscribe', comment: 'Unsubscribe' } },
            dkim: { domainName: 'example.com', keySelector: 'key', privateKey: 'pem' },
            dsn: { id: 'msg-1', return: 'headers', notify: ['success', 'failure'] }
        };
        const sameShape: SendMailOptions = message;
        assert.strictEqual(sameShape, message);
    });

    it('types transport options through the aliases', () => {
        const smtp: SMTPTransport.Options = {
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: { user: 'user', pass: 'pass' },
            tls: { rejectUnauthorized: true },
            logger: false,
            maxRecipients: 10
        };
        const pool: SMTPPool.Options = { pool: true, maxConnections: 2, host: 'smtp.example.com' };
        const connection: SMTPConnection.Options = { host: 'smtp.example.com', port: 465, secure: true };
        const dkim: DKIM.Options = { domainName: 'example.com', keySelector: 'key', privateKey: 'pem' };
        const oauth: XOAuth2.Options = { user: 'user', clientId: 'id', clientSecret: 'secret', refreshToken: 'token' };
        assert.ok(smtp && pool && connection && dkim && oauth);
    });

    it('types createTransport results per transport', async () => {
        const transporter: Transporter<JSONTransport.SentMessageInfo> = nodemailer.createTransport({ jsonTransport: true });
        const info = await transporter.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', text: 'hello' });
        assert.strictEqual(typeof info.message, 'string');
        assert.deepStrictEqual(info.envelope, { from: 'sender@example.com', to: ['recipient@example.com'] });

        const smtp: Transporter<SMTPTransport.SentMessageInfo> = nodemailer.createTransport({ host: 'localhost', port: 25 });
        assert.strictEqual(smtp.transporter.name, 'SMTP');
        smtp.close();
    });

    it('accepts a custom transport object', async () => {
        interface CustomInfo extends SentMessageInfo {
            custom: true;
        }
        const transport: Transport<CustomInfo> = {
            name: 'custom',
            version: '1.0.0',
            send(mail: MailMessage<CustomInfo>, callback) {
                callback(null, { envelope: mail.message!.getEnvelope(), messageId: mail.message!.messageId(), custom: true });
            }
        };
        const transporter: Mail<CustomInfo> = nodemailer.createTransport(transport);
        const info = await transporter.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', text: 'hello' });
        assert.strictEqual(info.custom, true);

        // a transport from outside this package is held by the plain Transporter type as
        // well, which needs Mail to stay covariant in the message type
        const plain: Transporter = transporter;
        const result: SentMessageInfo = await plain.sendMail({ from: 'sender@example.com', to: 'recipient@example.com', text: 'hello' });
        assert.strictEqual(result.custom, true);
    });
});
