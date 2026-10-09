import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These tests run the built package in a child process started with the Node.js permission
// model (--permission), granting read access to the package and nothing else. --permission
// is there since Node.js 22.13, network access is restricted by it since Node.js 25.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = path.join(root, 'dist', 'esm', 'nodemailer.js');

const hasPermission = process.allowedNodeEnvironmentFlags.has('--permission');
const hasNetPermission = process.allowedNodeEnvironmentFlags.has('--allow-net');

// Runs the script with the package readable and returns what it printed
const runRestricted = (script: string): string =>
    execFileSync(
        process.execPath,
        [
            '--permission',
            '--allow-fs-read=' + path.join(root, 'dist'),
            '--allow-fs-read=' + path.join(root, 'package.json'),
            '--input-type=module',
            '-e',
            `import nodemailer from ${JSON.stringify(entry)};\n${script}`
        ],
        { encoding: 'utf8' }
    ).trim();

describe('Node.js permission model', { timeout: 30 * 1000 }, () => {
    it('loads and builds a message with no grants beyond reading the package', { skip: !hasPermission }, () => {
        const out = runRestricted(`
            const info = await nodemailer.createTransport({ jsonTransport: true }).sendMail({
                from: 'sender@example.com',
                to: 'recipient@example.com',
                text: 'Hello'
            });
            console.log(JSON.parse(info.message).text);
        `);
        assert.strictEqual(out, 'Hello');
    });

    for (const [what, host] of [
        ['a connection', '127.0.0.1'],
        ['a hostname lookup', 'smtp.example.com']
    ]) {
        it(`reports ${what} denied for lack of --allow-net as ERR_ACCESS_DENIED`, { skip: !hasNetPermission }, () => {
            const out = runRestricted(`
                const transport = nodemailer.createTransport({ host: ${JSON.stringify(host)}, port: 25 });
                await transport.verify().then(
                    () => console.log('connected'),
                    err => console.log(err.code + ' ' + err.command)
                );
            `);
            assert.strictEqual(out, 'ERR_ACCESS_DENIED CONN');
        });
    }

    it('reports an HTTP request denied for lack of --allow-net as ERR_ACCESS_DENIED', { skip: !hasNetPermission }, () => {
        const out = runRestricted(`
            await nodemailer.createTestAccount('http://127.0.0.1:9/').then(
                () => console.log('created'),
                err => console.log(err.code)
            );
        `);
        assert.strictEqual(out, 'ERR_ACCESS_DENIED');
    });
});
