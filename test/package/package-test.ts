import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These tests exercise the compiled output in dist/ (built by the pretest
// script) through the package.json exports map, the same way an installed
// copy of the package is loaded. Node resolves the package name to the
// package itself when the specifier is used from inside the package.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Non-literal specifiers keep TypeScript from resolving the built types at
// type-check time, when dist/ may not exist yet
const packageName: string = 'nodemailer';
const subpath = (name: string) => packageName + '/lib/' + name;

const message = {
    from: 'Sender <sender@example.com>',
    to: 'recipient@example.com',
    subject: 'Package smoke test',
    text: 'Hello from the built package'
};

describe('Built package', { timeout: 30 * 1000 }, () => {
    it('ships both module formats with type declarations', () => {
        for (const format of ['esm', 'cjs']) {
            assert.ok(fs.existsSync(path.join(root, 'dist', format, 'nodemailer.js')), format + ' entry point');
            assert.ok(fs.existsSync(path.join(root, 'dist', format, 'nodemailer.d.ts')), format + ' type declarations');
            assert.ok(fs.existsSync(path.join(root, 'dist', format, 'mail-composer', 'index.d.ts')), format + ' subpath declarations');
        }
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'esm', 'package.json'), 'utf8')), { type: 'module' });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'cjs', 'package.json'), 'utf8')), { type: 'commonjs' });
    });

    it('maps every directory module to a ./lib subpath', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        const dirs = fs
            .readdirSync(path.join(root, 'src'), { withFileTypes: true })
            .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, 'src', entry.name, 'index.ts')))
            .map(entry => entry.name);
        assert.ok(dirs.length > 10, 'expected the directory modules under src/');
        for (const dir of dirs) {
            const entry = pkg.exports['./lib/' + dir];
            assert.ok(entry, 'package.json exports lacks ./lib/' + dir);
            assert.strictEqual(entry.import, './dist/esm/' + dir + '/index.js');
            assert.strictEqual(entry.require, './dist/cjs/' + dir + '/index.js');
        }
        for (const [subpath, entry] of Object.entries(pkg.exports)) {
            if (subpath.includes('*') || typeof entry === 'string') {
                continue;
            }
            for (const target of Object.values(entry as Record<string, string>)) {
                assert.ok(fs.existsSync(path.join(root, target)), subpath + ' points at a missing file ' + target);
            }
        }
    });

    describe('CommonJS build', () => {
        it('gives every module the shape its declaration file announces', () => {
            // A module whose declaration has a default export is loaded as that
            // export itself (the build rewrites it, see scripts/build.js), the
            // entry point keeps both forms, and everything else is a plain
            // exports object
            const cjsRoot = path.join(root, 'dist', 'cjs');
            const files = (fs.readdirSync(cjsRoot, { recursive: true }) as string[]).filter(name => name.endsWith('.js'));
            assert.ok(files.length > 30, 'expected the compiled modules under dist/cjs');
            for (const name of files) {
                const declaration = fs.readFileSync(path.join(cjsRoot, name.replace(/\.js$/, '.d.ts')), 'utf8');
                const hasDefault = /^export default /m.test(declaration);
                const mod = require(path.join(cjsRoot, name));
                if (name === 'nodemailer.js') {
                    assert.strictEqual(typeof mod.createTransport, 'function', name);
                    assert.strictEqual(mod.default.createTransport, mod.createTransport, name);
                } else if (hasDefault) {
                    assert.strictEqual(typeof mod, 'function', name + ' should load as its default export');
                    assert.strictEqual(mod.default, mod, name + ' should alias .default to itself');
                } else {
                    assert.strictEqual(typeof mod, 'object', name + ' should load as an exports object');
                    assert.strictEqual(mod.__esModule, true, name);
                    assert.ok(!('default' in mod), name + ' should not have a default export');
                }
            }
        });

        it('resolves require() to the CommonJS entry point', () => {
            assert.strictEqual(require.resolve(packageName), path.join(root, 'dist', 'cjs', 'nodemailer.js'));
        });

        it('exposes the public API as properties of the module', () => {
            const nodemailer = require(packageName);
            assert.strictEqual(typeof nodemailer.createTransport, 'function');
            assert.strictEqual(typeof nodemailer.createTestAccount, 'function');
            assert.strictEqual(typeof nodemailer.getTestMessageUrl, 'function');
            assert.strictEqual(nodemailer.default.createTransport, nodemailer.createTransport);
        });

        it('keeps deep imports returning the exported class or function', () => {
            const MailComposer = require(subpath('mail-composer'));
            assert.strictEqual(typeof MailComposer, 'function');
            assert.strictEqual(MailComposer.default, MailComposer);
            assert.ok(
                Object.keys(MailComposer).every(key => key !== 'default'),
                'default alias is not enumerable'
            );

            for (const name of [
                'smtp-connection',
                'mime-node',
                'mailer',
                'mailer/mail-message',
                'mailer/mail-message.js',
                'mime-node/index.js',
                'addressparser',
                'well-known',
                'dkim',
                'xoauth2',
                'fetch',
                'smtp-transport',
                'smtp-pool',
                'sendmail-transport',
                'stream-transport',
                'json-transport',
                'ses-transport'
            ]) {
                assert.strictEqual(typeof require(subpath(name)), 'function', name);
            }
            assert.strictEqual(typeof require(subpath('fetch')).Cookies, 'function');
        });

        it('keeps deep imports of utility modules returning their functions', () => {
            for (const [name, member] of [
                ['shared', 'getLogger'],
                ['shared', 'resolveContent'],
                ['shared', 'parseConnectionUrl'],
                ['mime-funcs', 'encodeWord'],
                ['mime-funcs', 'foldLines'],
                ['mime-funcs/mime-types', 'detectMimeType'],
                ['base64', 'encode'],
                ['qp', 'encode'],
                ['punycode', 'toASCII'],
                ['shared/url', 'parse']
            ]) {
                assert.strictEqual(typeof require(subpath(name))[member], 'function', name + '.' + member);
            }
            assert.strictEqual(require(subpath('errors')).ECONNECTION, 'ECONNECTION');
        });

        it('sends a message through the stream transport', async () => {
            const nodemailer = require(packageName);
            const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
            const info = await transporter.sendMail(message);
            assert.ok(Buffer.isBuffer(info.message));
            assert.ok(info.message.toString().includes('Subject: Package smoke test\n'));
            assert.deepStrictEqual(info.envelope, { from: 'sender@example.com', to: ['recipient@example.com'] });
        });

        it('composes a message with MailComposer', async () => {
            const MailComposer = require(subpath('mail-composer'));
            const raw = await new MailComposer(message).compile().build();
            assert.ok(raw.toString().includes('Hello from the built package'));
        });
    });

    describe('ES module build', () => {
        it('resolves import to the ES module entry point', async () => {
            const url = new URL('../../dist/esm/nodemailer.js', import.meta.url).href;
            const direct = await import(url);
            const byName = await import(packageName);
            assert.strictEqual(byName.createTransport, direct.createTransport);
        });

        it('exposes named and default exports', async () => {
            const nodemailer = await import(packageName);
            assert.strictEqual(typeof nodemailer.createTransport, 'function');
            assert.strictEqual(typeof nodemailer.createTestAccount, 'function');
            assert.strictEqual(typeof nodemailer.getTestMessageUrl, 'function');
            assert.strictEqual(nodemailer.default.createTransport, nodemailer.createTransport);
            assert.strictEqual(nodemailer.default.createTestAccount, nodemailer.createTestAccount);
            assert.strictEqual(nodemailer.default.getTestMessageUrl, nodemailer.getTestMessageUrl);
        });

        it('exposes deep imports as default exports', async () => {
            const { default: MailComposer } = await import(subpath('mail-composer'));
            assert.strictEqual(typeof MailComposer, 'function');
            const { default: SMTPConnection } = await import(subpath('smtp-connection'));
            assert.strictEqual(typeof SMTPConnection, 'function');
            const { default: MailMessage } = await import(subpath('mailer/mail-message'));
            assert.strictEqual(typeof MailMessage, 'function');
            const shared = await import(subpath('shared'));
            assert.strictEqual(typeof shared.getLogger, 'function');
            const nmfetch = await import(subpath('fetch'));
            assert.strictEqual(typeof nmfetch.default, 'function');
            assert.strictEqual(typeof nmfetch.default.Cookies, 'function');
        });

        it('sends a message through the JSON transport', async () => {
            const nodemailer = await import(packageName);
            const transporter = nodemailer.createTransport({ jsonTransport: true });
            const info = await transporter.sendMail(message);
            const parsed = JSON.parse(info.message);
            assert.strictEqual(parsed.subject, 'Package smoke test');
            assert.strictEqual(parsed.text, 'Hello from the built package');
        });
    });
});
