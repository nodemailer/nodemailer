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
import type { HttpProxyClientOptions } from 'nodemailer/lib/smtp-connection/http-proxy-client';
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
type _HttpProxyClient = NoneMissing<MissingUndefined<HttpProxyClientOptions>>;
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

// The idioms of @types/nodemailer that the first 10.x releases stopped compiling: the two
// parameter forms of Transporter, Transport and Mail, the namespace-style type references
// through a namespace import, transport instances handed to createTransport or held as a
// Transport, the result fields the SMTP transports always set, the null sender, the custom
// authentication handler of the documentation, stream plugins and the aliases of the old
// typings
const legacyConsumer = `
import * as nodemailer from 'nodemailer';
import * as SMTPTransportNs from 'nodemailer/lib/smtp-transport';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import SMTPPool from 'nodemailer/lib/smtp-pool';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import Mail from 'nodemailer/lib/mailer';
import DKIM from 'nodemailer/lib/dkim';
import XOAuth2 from 'nodemailer/lib/xoauth2';
import addressparser from 'nodemailer/lib/addressparser';
import { Options as MailOptions } from 'nodemailer/lib/mailer';
import type { Transport, Transporter, SentMessageInfo } from 'nodemailer';

let t: nodemailer.Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options> = nodemailer.createTransport({ host: 'localhost' });
const ns: nodemailer.Transporter<SMTPTransportNs.SentMessageInfo> = t;
const opts: SMTPTransportNs.Options = { host: 'localhost' };
const mail: MailOptions = { from: 'sender@example.com', to: 'recipient@example.com' };
const host: string | undefined = t.options.host;

const smtp = new SMTPTransport({ host: 'localhost' });
const asTransport: Transport = smtp;
const pooled: Transporter<SMTPPool.SentMessageInfo, SMTPPool.Options> = nodemailer.createTransport(new SMTPPool({ host: 'localhost' }));
const typedSmtp: Transporter<SMTPTransport.SentMessageInfo> = nodemailer.createTransport(smtp);

t.sendMail(mail).then(info => { info.response.length; info.envelopeTime.toFixed(); info.messageId; });
t.sendMail(mail, (err, info) => { if (err) { err.code; err.errno; return; } info.accepted.length; });
t.verify((err, success) => { if (!err) { const ok: true = success; } });

const bounce: Mail.Options = { envelope: { from: false, to: 'recipient@example.com' }, raw: 'x' };
const conn = new SMTPConnection({ host: 'localhost', port: 25 });
conn.send({ from: false, to: ['recipient@example.com'] }, 'raw', (err, info) => { if (!err) { info.response.length; info.envelopeTime.toFixed(); } });
conn.login({ user: 'u', pass: 'p' }, (err, ok) => { err; ok; });
const smtpErr: SMTPConnection.SMTPError = new Error('x');
const oauthAuth: SMTPConnection.AuthenticationTypeOAuth2 = { user: 'u', refreshToken: 'r', accessToken: 'a', expires: 1 };
const stage: 'init' | 'connected' = conn.stage;

nodemailer.createTransport({
    host: 'localhost',
    auth: { type: 'custom', user: 'u', pass: 'p', method: 'x-login' },
    customAuth: {
        'x-login': async ctx => {
            const cmd = await ctx.sendCommand('AUTH LOGIN');
            if (cmd.status !== 334) { throw new Error('unexpected'); }
            await ctx.sendCommand(Buffer.from(ctx.auth.credentials.user, 'utf-8').toString('base64'));
            await ctx.sendCommand(Buffer.from(ctx.auth.credentials.pass, 'utf-8').toString('base64'));
            ctx.resolve();
        },
        'x-sync': ctx => { ctx.sendCommand('AUTH X', (err, data) => { if (!err) { data.status; } ctx.resolve(); }); return true; }
    }
});

t.use('stream', (mail, cb) => { mail.message.setHeader('X-Test', 'x'); cb(); });

const json = nodemailer.createTransport({ jsonTransport: true });
json.sendMail(mail).then(info => JSON.parse(info.message));
const jsonObject = nodemailer.createTransport({ jsonTransport: true, skipEncoding: true });
jsonObject.sendMail(mail).then(info => info.message.subject);
const jsonPlain: Transporter<nodemailer.JSONSentMessageInfo> = jsonObject;

const dkim: DKIM.MultipleKeysOptions = { keys: [{ domainName: 'd', keySelector: 's', privateKey: 'k' }] };
const xoauth: XOAuth2.RequestParams = { customHeaders: { 'X-Test': 'x' } };
const mailbox: addressparser.Address = addressparser('recipient@example.com', { flatten: true })[0];
const parsed: addressparser.AddressOrGroup[] = addressparser('recipient@example.com');
const enc: Mail.TextEncoding = 'base64';
const custom: Transport<SentMessageInfo & { queueId: string }> = {
    name: 'x',
    version: '1',
    send(m, cb) { cb(null, { envelope: m.message.getEnvelope(), messageId: m.message.messageId(), queueId: 'q' }); }
};
const anyInfo: SentMessageInfo = { envelope: { from: 'sender@example.com', to: [] }, messageId: 'm' };
anyInfo.custom.field;
export { ns, opts, host, asTransport, pooled, typedSmtp, bounce, smtpErr, oauthAuth, stage, dkim, xoauth, mailbox, parsed, enc, custom, jsonPlain };
`;

// node16 is what an installed copy resolves through the exports map, bundler is what the
// common front end tool chains use, and node10 is the default of a plain CommonJS project on
// TypeScript 5, which resolves through main and typesVersions instead of the exports map
const node16 = { module: 'node16', moduleResolution: 'node16' };
const node10 = { module: 'commonjs', moduleResolution: 'node10', ignoreDeprecations: '6.0' };
const resolutions = [node16, { module: 'esnext', moduleResolution: 'bundler' }, node10];

// Type-checks a consumer against the built declarations in dist/ the way an installed copy
// is resolved: the package is linked into a temporary project so that the specifiers go
// through the package.json exports map
// One consumer, or several keyed by file name, type-checked as a single program
const typeCheckConsumer = (
    source: string | { [file: string]: string },
    compilerOptions: { [key: string]: unknown },
    include?: string[]
): void => {
    const sources = typeof source === 'string' ? { 'consumer.ts': source } : source;
    include = include || Object.keys(sources);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodemailer-types-'));
    try {
        fs.mkdirSync(path.join(dir, 'node_modules'));
        // link the package itself and the node typings a real consumer has, so that
        // the specifiers resolve the way they do in an installed project
        fs.symlinkSync(root, path.join(dir, 'node_modules', 'nodemailer'), 'dir');
        fs.symlinkSync(path.join(root, 'node_modules', '@types'), path.join(dir, 'node_modules', '@types'), 'dir');
        for (const [file, text] of Object.entries(sources)) {
            fs.writeFileSync(path.join(dir, file), text);
        }
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
    // the current idioms and the ones of @types/nodemailer are checked as one program per
    // resolution, a failure names the file it is in
    for (const resolution of resolutions) {
        it('type-checks a consumer and the idioms of @types/nodemailer with moduleResolution ' + resolution.moduleResolution, () => {
            typeCheckConsumer({ 'consumer.ts': consumer, 'legacy.ts': legacyConsumer }, resolution);
        });
    }

    it('accepts an explicit undefined for optional properties with exactOptionalPropertyTypes', () => {
        typeCheckConsumer(exactOptionalConsumer, { ...node16, exactOptionalPropertyTypes: true });
    });

    // The underscore-prefixed members are implementation details and are tagged @internal,
    // which stripInternal drops from the declarations. The ones below stay: two of them
    // @types/nodemailer declared, and _dkim is read from the message data at runtime
    // Every class module carries its @types/nodemailer aliases twice: in a namespace merged
    // into the default export, for `import X from`, and as module level exports, for
    // `import * as X` and `import X = require()`. TypeScript has no single form that serves
    // both, so this keeps the two lists equal
    it('exports the namespace aliases of every module at module level as well', () => {
        const dir = path.join(root, 'dist', 'cjs');
        // the members of an ambient namespace are emitted without their export keyword
        const namespaceMember = /^\s+(?:export )?type (\w+)(?:<[^>]*>)? = /gm;
        const moduleAlias = /\b\w+ as (\w+)\b/g;
        const checked: string[] = [];
        for (const file of fs.readdirSync(dir, { encoding: 'utf8', recursive: true })) {
            if (!file.endsWith('.d.ts')) {
                continue;
            }
            const source = fs.readFileSync(path.join(dir, file), 'utf8');
            const namespace = /^declare namespace \w+ \{\n([\s\S]*?)^\}/m.exec(source);
            if (!namespace) {
                continue;
            }
            const members = [...namespace[1].matchAll(namespaceMember)].map(match => match[1]);
            if (!members.length) {
                continue;
            }
            const aliases = [...source.matchAll(/^export type \{([^}]*)\};/gm)].flatMap(match =>
                [...match[1].matchAll(moduleAlias)].map(alias => alias[1])
            );
            // the module level export of the same name is the alias, without a rename
            const named = [...source.matchAll(/^export (?:type|interface|declare function|declare class) (\w+)/gm)].map(match => match[1]);
            const missing = members.filter(member => !aliases.includes(member) && !named.includes(member));
            assert.deepStrictEqual(missing, [], file + ' lacks module level aliases');
            checked.push(file);
        }
        assert.ok(checked.length >= 16, 'expected the class modules to carry a namespace, saw ' + checked.join(', '));
    });

    it('strips the @internal members from the declarations', () => {
        const kept = ['mailer/index.d.ts _defaults', 'mailer/mail-message.d.ts _dkim', 'smtp-connection/index.d.ts _socket'];
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
