import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The suite runs through tsx, which strips the types instead of checking them, and
// test/types/types-test.ts checks the types in src/. These tests type-check a consumer
// against the built declarations in dist/ the way an installed copy is resolved: the
// package is linked into a temporary project so that the specifiers go through the
// package.json exports map.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsc = require.resolve('typescript/bin/tsc');

// The idioms @types/nodemailer supported, kept compiling by the shipped declarations. Two
// of them regress first and neither is checked by types-test.ts: holding a transporter in
// the plain Transporter type needs Mail<T> to stay covariant in T, and holding a transport
// result in the base SentMessageInfo type needs every transport result type to extend it.
// The transporters are deliberately left unannotated in the second group, otherwise the
// assignment is between two SentMessageInfo values and proves nothing
const consumer = `
import nodemailer, { createTransport } from 'nodemailer';
import type { Address, Attachment, MailMessage, SendMailOptions, SentMessageInfo, Transport, Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import MailComposer from 'nodemailer/lib/mail-composer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';

const address: Address = { name: 'Recipient', address: 'recipient@example.com' };
const attachment: Attachment = { filename: 'notes.txt', content: 'notes' };
const message: Mail.Options = { from: 'sender@example.com', to: [address], attachments: [attachment] };

// every bundled transport, held by the plain Transporter type
const transporters: Transporter[] = [
    createTransport({ host: 'localhost', port: 587 }),
    createTransport({ pool: true, host: 'localhost' }),
    createTransport({ jsonTransport: true }),
    createTransport({ streamTransport: true }),
    createTransport({ sendmail: true })
];
const typed: Transporter<SMTPTransport.SentMessageInfo> = nodemailer.createTransport({ host: 'localhost' });

// a transport from outside the package, the shape a plugin that ships its own types has
interface PluginInfo extends SentMessageInfo {
    queueId: string;
}
declare const plugin: Transport<PluginInfo>;
const external: Transporter = createTransport(plugin);

export async function send(): Promise<void> {
    // every transport result, held by the base result type
    const smtp: SentMessageInfo = await createTransport({ host: 'localhost', port: 587 }).sendMail(message);
    const pool: SentMessageInfo = await createTransport({ pool: true, host: 'localhost' }).sendMail(message);
    const json: SentMessageInfo = await createTransport({ jsonTransport: true }).sendMail(message);
    const stream: SentMessageInfo = await createTransport({ streamTransport: true }).sendMail(message);
    const sendmail: SentMessageInfo = await createTransport({ sendmail: true }).sendMail(message);
    const ses: SentMessageInfo = await createTransport({ SES: { sesClient: { send: async () => ({}) }, SendEmailCommand: class {} } }).sendMail(message);
    const info: SentMessageInfo = await typed.sendMail(message as SendMailOptions);
    [smtp, pool, json, stream, sendmail, ses, info].forEach(result => result.messageId);

    typed.use('compile', (mail, callback) => callback());
    typed.sendMail(message, (err, sent: SentMessageInfo) => sent.messageId);

    const queued: SentMessageInfo = await external.sendMail(message);
    queued.messageId;
    void ({} as MailMessage<PluginInfo>);

    new MailComposer(message).compile().build();
    new SMTPConnection({ host: 'localhost', port: 25 });
    [...transporters, external].forEach(transporter => transporter.close());
}
`;

// node16 is what an installed copy resolves through the exports map, bundler is what the
// common front end tool chains use
const resolutions = [
    { module: 'node16', moduleResolution: 'node16' },
    { module: 'esnext', moduleResolution: 'bundler' }
];

describe('Built package types', { timeout: 120 * 1000 }, () => {
    for (const resolution of resolutions) {
        it('type-checks a consumer with moduleResolution ' + resolution.moduleResolution, () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodemailer-types-'));
            try {
                fs.mkdirSync(path.join(dir, 'node_modules'));
                // link the package itself and the node typings a real consumer has, so that
                // the specifiers resolve the way they do in an installed project
                fs.symlinkSync(root, path.join(dir, 'node_modules', 'nodemailer'), 'dir');
                fs.symlinkSync(path.join(root, 'node_modules', '@types'), path.join(dir, 'node_modules', '@types'), 'dir');
                fs.writeFileSync(path.join(dir, 'consumer.ts'), consumer);
                fs.writeFileSync(
                    path.join(dir, 'tsconfig.json'),
                    JSON.stringify({
                        compilerOptions: {
                            target: 'ES2022',
                            lib: ['ES2023'],
                            types: ['node'],
                            strict: true,
                            noEmit: true,
                            skipLibCheck: true,
                            esModuleInterop: true,
                            ...resolution
                        },
                        include: ['consumer.ts']
                    })
                );

                const result = spawnSync(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' });
                assert.strictEqual(result.status, 0, 'tsc reported\n' + result.stdout + result.stderr);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    }
});
