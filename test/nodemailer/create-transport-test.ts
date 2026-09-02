import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer, { createTransport, createTestAccount, getTestMessageUrl } from '../../src/nodemailer.js';
import Mail from '../../src/mailer/index.js';
import SMTPTransport from '../../src/smtp-transport/index.js';
import SMTPPool from '../../src/smtp-pool/index.js';
import SendmailTransport from '../../src/sendmail-transport/index.js';
import StreamTransport from '../../src/stream-transport/index.js';
import JSONTransport from '../../src/json-transport/index.js';
import SESTransport from '../../src/ses-transport/index.js';
import type { Transport } from '../../src/mailer/index.js';
import type { SMTPTransportOptions } from '../../src/smtp-transport/index.js';

const sesMock = {
    sesClient: {
        send() {
            return Promise.resolve({ MessageId: 'unused' });
        }
    },
    SendEmailCommand: class {
        input: unknown;

        constructor(input: unknown) {
            this.input = input;
        }
    }
};

describe('createTransport', () => {
    it('should expose the same functions as named exports and on the default export', () => {
        assert.strictEqual(nodemailer.createTransport, createTransport);
        assert.strictEqual(nodemailer.createTestAccount, createTestAccount);
        assert.strictEqual(nodemailer.getTestMessageUrl, getTestMessageUrl);
    });

    it('should create an SMTP transport from a configuration object', () => {
        const options = { host: 'smtp.example.com', port: 2525, secure: false };
        const transporter = createTransport(options);

        assert.ok(transporter instanceof Mail);
        assert.ok(transporter.transporter instanceof SMTPTransport);
        assert.strictEqual(transporter.transporter.name, 'SMTP');
        // the configuration object doubles as the options of the mailer
        assert.strictEqual(transporter.options, options);
        assert.strictEqual(transporter.transporter.mailer, transporter);
    });

    it('should parse a connection url string', () => {
        const transporter = createTransport('smtps://user:pa%3Ass@smtp.example.com:465/?name=client.example');
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPTransport);
        assert.strictEqual(transport.options.host, 'smtp.example.com');
        assert.strictEqual(transport.options.port, 465);
        assert.strictEqual(transport.options.secure, true);
        assert.strictEqual(transport.options.name, 'client.example');
        assert.deepStrictEqual(transport.options.auth, { user: 'user', pass: 'pa:ss' });
        // the mailer reads the parsed url as its options too
        assert.strictEqual((transporter.options as SMTPTransportOptions).host, 'smtp.example.com');
    });

    it('should parse the url of a configuration object', () => {
        const transporter = createTransport({ url: 'smtp://localhost:2525' });
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPTransport);
        assert.strictEqual(transport.options.host, 'localhost');
        assert.strictEqual(transport.options.port, 2525);
        assert.strictEqual(transport.options.secure, false);
    });

    it('should apply the other keys of a configuration object next to its url', () => {
        const transporter = createTransport({
            url: 'smtp://localhost:2525',
            pool: true,
            auth: { user: 'user', pass: 'pass' },
            maxConnections: 3
        });
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPPool);
        assert.strictEqual(transport.options.host, 'localhost');
        assert.strictEqual(transport.options.port, 2525);
        assert.deepStrictEqual(transport.options.auth, { user: 'user', pass: 'pass' });
        assert.strictEqual(transport.options.maxConnections, 3);
        transporter.close();
    });

    it('should let the url win over a key the configuration object repeats', () => {
        const transporter = createTransport({
            url: 'smtp://url-user:url-pass@localhost:2525',
            port: 25,
            auth: { user: 'user', pass: 'pass' }
        });
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPTransport);
        assert.strictEqual(transport.options.port, 2525);
        assert.deepStrictEqual(transport.options.auth, { user: 'url-user', pass: 'url-pass' });
        assert.strictEqual('url' in transport.options, false);
    });

    it('should create a pooled transport for pool: true', () => {
        const transporter = createTransport({ pool: true, host: 'localhost', port: 2525 });

        assert.ok(transporter.transporter instanceof SMTPPool);
        assert.strictEqual(transporter.transporter.name, 'SMTP (pool)');
        transporter.close();
    });

    it('should create a pooled transport from a connection url with pool=true', () => {
        const transporter = createTransport('smtp://localhost:2525/?pool=true&maxConnections=2');
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPPool);
        assert.strictEqual(transport.options.pool, true);
        assert.strictEqual(transport.options.maxConnections, 2);
        transporter.close();
    });

    it('should create a sendmail transport', () => {
        const transporter = createTransport({ sendmail: true, path: '/usr/local/bin/sendmail', args: ['-t'] });
        const transport = transporter.transporter as SendmailTransport;

        assert.ok(transport instanceof SendmailTransport);
        assert.strictEqual(transport.name, 'Sendmail');
        assert.strictEqual(transport.path, '/usr/local/bin/sendmail');
        assert.deepStrictEqual(transport.args, ['-t']);
    });

    it('should create a stream transport', () => {
        const transporter = createTransport({ streamTransport: true, buffer: true });

        assert.ok(transporter.transporter instanceof StreamTransport);
        assert.strictEqual(transporter.transporter.name, 'StreamTransport');
        assert.strictEqual((transporter.transporter as StreamTransport).options.buffer, true);
    });

    it('should create a JSON transport', () => {
        const transporter = createTransport({ jsonTransport: true });

        assert.ok(transporter.transporter instanceof JSONTransport);
        assert.strictEqual(transporter.transporter.name, 'JSONTransport');
    });

    it('should create an SES transport', () => {
        const transporter = createTransport({ SES: sesMock });

        assert.ok(transporter.transporter instanceof SESTransport);
        assert.strictEqual(transporter.transporter.name, 'SESTransport');
        assert.strictEqual((transporter.transporter as SESTransport).ses, sesMock);
    });

    it('should refuse a legacy SES configuration', () => {
        assert.throws(() => createTransport({ SES: { ses: {}, aws: {} } } as any), {
            code: 'ECONFIG',
            message: /legacy SES configuration/
        });
    });

    it('should resolve a well-known service name into connection settings', () => {
        const transporter = createTransport({ service: 'Gmail', auth: { user: 'user@gmail.com', pass: 'secret' } });
        const transport = transporter.transporter;

        assert.ok(transport instanceof SMTPTransport);
        assert.strictEqual(transport.options.host, 'smtp.gmail.com');
        assert.strictEqual(transport.options.port, 465);
        assert.strictEqual(transport.options.secure, true);
    });

    it('should wrap a transport plugin object as it is', async () => {
        const plugin: Transport = {
            name: 'Plugin',
            version: '2.0.0',
            send(mail, callback) {
                callback(null, { envelope: mail.message!.getEnvelope(), messageId: mail.message!.messageId(), plugin: true });
            }
        };
        const transporter = createTransport(plugin);

        assert.strictEqual(transporter.transporter, plugin);
        assert.strictEqual(plugin.mailer, transporter);
        // a plugin carries no configuration for the mailer
        assert.deepStrictEqual(transporter.options, {});

        const info = await transporter.sendMail({ from: 'a@example.com', to: 'b@example.com', text: 'hi' });
        assert.strictEqual(info.plugin, true);
        assert.deepStrictEqual(info.envelope, { from: 'a@example.com', to: ['b@example.com'] });
    });

    it('should apply the defaults to every message', async () => {
        const transporter = createTransport(
            { jsonTransport: true },
            { from: 'default@example.com', subject: 'default subject', headers: { 'x-default': 'yes', 'x-shared': 'default' } }
        );

        const info = await transporter.sendMail({
            to: 'b@example.com',
            subject: 'own subject',
            headers: { 'x-shared': 'own' },
            text: 'hi'
        });
        const parsed = JSON.parse(info.message as string);

        assert.strictEqual(parsed.from.address, 'default@example.com');
        assert.strictEqual(parsed.subject, 'own subject');
        assert.deepStrictEqual(parsed.headers, { 'x-default': 'yes', 'x-shared': 'own' });
        assert.deepStrictEqual(info.envelope, { from: 'default@example.com', to: ['b@example.com'] });
    });
});
