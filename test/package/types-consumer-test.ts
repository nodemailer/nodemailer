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

// Every optional property is declared as `T | undefined` so that an explicit undefined is
// still accepted under exactOptionalPropertyTypes, the way @types/nodemailer declared them.
// Building an options object out of values that may be undefined is the shape that breaks
// first, so every options interface of the package is filled in that way here
const exactOptionalConsumer = `
import { createTransport, getTestMessageUrl } from 'nodemailer';
import type { Address, SentMessageInfo } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type MimeNode from 'nodemailer/lib/mime-node';
import type { MimeNodeOptions } from 'nodemailer/lib/mime-node';
import type { MailComposerOptions } from 'nodemailer/lib/mail-composer';
import type { SMTPConnectionOptions } from 'nodemailer/lib/smtp-connection';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import type SendmailTransport from 'nodemailer/lib/sendmail-transport';
import type StreamTransport from 'nodemailer/lib/stream-transport';
import type JSONTransport from 'nodemailer/lib/json-transport';
import type SESTransport from 'nodemailer/lib/ses-transport';
import type DKIM from 'nodemailer/lib/dkim';
import type XOAuth2 from 'nodemailer/lib/xoauth2';
import MailComposer from 'nodemailer/lib/mail-composer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';

declare const maybeString: string | undefined;
declare const maybeNumber: number | undefined;
declare const maybeBoolean: boolean | undefined;
declare const maybeAddress: Address | undefined;

void new MailComposer({
    from: maybeString,
    to: maybeAddress,
    cc: maybeString,
    replyTo: maybeString,
    subject: maybeString,
    text: maybeString,
    list: { help: { url: 'https://example.com/help', comment: maybeString } },
    attachments: [{ filename: maybeString, content: maybeString, cid: maybeString }]
});
void new SMTPConnection({ host: maybeString, port: maybeNumber, secure: maybeBoolean, name: maybeString });

void createTransport({ host: maybeString, port: maybeNumber, name: maybeString, auth: { user: maybeString, pass: maybeString } });
void createTransport({ pool: true, host: maybeString, maxConnections: maybeNumber, rateDelta: maybeNumber });
void createTransport({ sendmail: true, path: maybeString });
void createTransport({ streamTransport: true, newline: maybeString });
void createTransport({ jsonTransport: true, skipEncoding: maybeBoolean });

// the message data and the transporter defaults of createTransport, and a send result
// handed back to getTestMessageUrl, which reads an optional property of its own
declare const info: SentMessageInfo;
void createTransport({ host: 'localhost' }, { from: maybeString }).sendMail({
    to: 'recipient@example.com',
    subject: maybeString,
    messageId: maybeString
});
void getTestMessageUrl(info);

// The call shapes above only pin the properties they name. This sweeps every optional
// property of the public types instead, so that one added without \`| undefined\` fails here
// rather than in a consumer project. OptionalKeys picks the keys that may be left out, and
// MissingUndefined keeps the ones that do not accept undefined. Extract<..., string> drops
// the symbol keys the EventEmitter classes inherit from @types/node
type OptionalKeys<T> = Extract<{ [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T], string>;
type MissingUndefined<T> = { [K in OptionalKeys<T>]-?: { [P in K]: undefined } extends Pick<T, K> ? never : K }[OptionalKeys<T>];
type NoneMissing<T extends never> = T;

type _Options = NoneMissing<MissingUndefined<Mail.Options>>;
type _MailComposer = NoneMissing<MissingUndefined<MailComposerOptions>>;
type _MimeNode = NoneMissing<MissingUndefined<MimeNode>>;
type _MimeNodeOptions = NoneMissing<MissingUndefined<MimeNodeOptions>>;
type _SMTPConnection = NoneMissing<MissingUndefined<SMTPConnectionOptions>>;
type _SMTPTransport = NoneMissing<MissingUndefined<SMTPTransport.Options>>;
type _SMTPPool = NoneMissing<MissingUndefined<SMTPPool.Options>>;
type _Sendmail = NoneMissing<MissingUndefined<SendmailTransport.Options>>;
type _Stream = NoneMissing<MissingUndefined<StreamTransport.Options>>;
type _JSON = NoneMissing<MissingUndefined<JSONTransport.Options>>;
type _SES = NoneMissing<MissingUndefined<SESTransport.Options>>;
type _DKIM = NoneMissing<MissingUndefined<DKIM.Options>>;
type _XOAuth2 = NoneMissing<MissingUndefined<XOAuth2.Options>>;
type _SentMessageInfo = NoneMissing<MissingUndefined<SentMessageInfo>>;
`;

// node16 is what an installed copy resolves through the exports map, bundler is what the
// common front end tool chains use
const node16 = { module: 'node16', moduleResolution: 'node16' };
const resolutions = [node16, { module: 'esnext', moduleResolution: 'bundler' }];

// Type-checks a consumer against the built declarations in dist/ the way an installed copy
// is resolved: the package is linked into a temporary project so that the specifiers go
// through the package.json exports map
const typeCheckConsumer = (source: string, compilerOptions: { [key: string]: unknown }, include: string[] = ['consumer.ts']): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodemailer-types-'));
    try {
        fs.mkdirSync(path.join(dir, 'node_modules'));
        // link the package itself and the node typings a real consumer has, so that
        // the specifiers resolve the way they do in an installed project
        fs.symlinkSync(root, path.join(dir, 'node_modules', 'nodemailer'), 'dir');
        fs.symlinkSync(path.join(root, 'node_modules', '@types'), path.join(dir, 'node_modules', '@types'), 'dir');
        fs.writeFileSync(path.join(dir, 'consumer.ts'), source);
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
                    ...compilerOptions
                },
                include
            })
        );

        const result = spawnSync(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' });
        assert.strictEqual(result.status, 0, 'tsc reported\n' + result.stdout + result.stderr);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

describe('Built package types', { timeout: 120 * 1000 }, () => {
    for (const resolution of resolutions) {
        it('type-checks a consumer with moduleResolution ' + resolution.moduleResolution, () => {
            typeCheckConsumer(consumer, resolution);
        });
    }

    it('accepts an explicit undefined for optional properties with exactOptionalPropertyTypes', () => {
        typeCheckConsumer(exactOptionalConsumer, { ...node16, exactOptionalPropertyTypes: true });
    });

    // The underscore-prefixed members are implementation details and are tagged @internal,
    // which stripInternal drops from the declarations. The two below are the ones
    // @types/nodemailer declared, so they stay
    it('strips the @internal members from the declarations', () => {
        const kept = ['mailer/index.d.ts _defaults', 'smtp-connection/index.d.ts _socket'];
        const member = /^(?:\s*|export declare \w+ )(_\w+)/;
        const leaked: string[] = [];
        for (const format of ['esm', 'cjs']) {
            const dir = path.join(root, 'dist', format);
            for (const file of fs.readdirSync(dir, { encoding: 'utf8', recursive: true })) {
                if (!file.endsWith('.d.ts')) {
                    continue;
                }
                for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
                    const match = member.exec(line);
                    if (match && !kept.includes(file + ' ' + match[1])) {
                        leaked.push(format + '/' + file + ' ' + match[1]);
                    }
                }
            }
        }
        assert.deepStrictEqual(leaked, [], 'members without an @internal tag');
    });

    // stripInternal drops a tagged declaration without checking whether a kept one still
    // refers to it, and the consumer checks above run with skipLibCheck, which hides the
    // dangling reference. This type-checks every built declaration file itself instead
    it('type-checks the built declarations themselves', () => {
        typeCheckConsumer('', { ...node16, skipLibCheck: false }, [path.join(root, 'dist', '**', '*.d.ts')]);
    });
});
