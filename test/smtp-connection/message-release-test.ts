import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import SMTPConnection from '../../src/smtp-connection/index.js';
import nodemailer from '../../src/nodemailer.js';
import { startServer } from '../smtp-transport/smtp-fixtures.js';
import { closed } from '../helpers/wait.js';

const auth = { user: 'testuser', pass: 'testpass' };

function connect(port: number): Promise<SMTPConnection> {
    return new Promise((resolve, reject) => {
        const connection = new SMTPConnection({ port, host: '127.0.0.1', logger: false });
        connection.once('error', reject);
        connection.connect(() => connection.login(auth, err => (err ? reject(err) : resolve(connection))));
    });
}

// The message stream is read only once the envelope was accepted. A message that is not going to
// be sent gets its stream destroyed, so whatever it reads from (a file, an HTTP response) is
// released instead of staying open behind a paused stream
describe('SMTPConnection message stream release', { timeout: 20000 }, () => {
    it('destroys the message stream when every recipient is rejected', async () => {
        const ts = await startServer();
        try {
            const connection = await connect(ts.port);
            const message = new PassThrough();
            message.write('Subject: test\r\n\r\n');

            const err = await new Promise<any>(resolve =>
                connection.send({ from: 'test@valid.sender', to: 'test@invalid.recipient' }, message, err => resolve(err))
            );
            assert.strictEqual(err.code, 'EENVELOPE');
            await closed(message);
            assert.ok(message.destroyed);
            connection.close();
        } finally {
            await ts.close();
        }
    });

    it('destroys the message stream when the connection closes during DATA', async () => {
        const ts = await startServer({
            onData(stream: any, session: any, done: any) {
                // drop the connection once the message starts arriving
                stream.once('data', () => {
                    for (const connection of ts.server.connections) {
                        connection._socket.destroy();
                    }
                });
                stream.on('end', done);
            }
        });
        try {
            const connection = await connect(ts.port);
            connection.on('error', () => false);
            const message = new PassThrough();
            message.write('Subject: test\r\n\r\n' + 'x'.repeat(64 * 1024));

            const err = await new Promise<any>(resolve =>
                connection.send({ from: 'test@valid.sender', to: 'test@valid.recipient' }, message, err => resolve(err))
            );
            assert.ok(err);
            await closed(message);
            assert.ok(message.destroyed);
        } finally {
            await ts.close();
        }
    });

    it('closes an attachment file of a message the server rejected', async t => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-release-'));
        t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        const file = path.join(dir, 'large.bin');
        fs.writeFileSync(file, Buffer.alloc(4 * 1024 * 1024, 'a'));

        const ts = await startServer();
        try {
            // a path is opened by the message itself, so only the message stream can release it
            const opened: fs.ReadStream[] = [];
            const createReadStream = fs.createReadStream;
            t.mock.method(fs, 'createReadStream', (...args: any[]) => {
                const stream = (createReadStream as any)(...args);
                opened.push(stream);
                return stream;
            });

            const transport = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, auth, logger: false });
            const err = await new Promise<any>(resolve =>
                transport.sendMail(
                    { from: 'test@valid.sender', to: 'test@invalid.recipient', subject: 'test', attachments: [{ path: file }] },
                    err => resolve(err)
                )
            );
            assert.strictEqual(err.code, 'EENVELOPE');
            assert.strictEqual(opened.length, 1);
            await closed(opened[0]);
            transport.close();
        } finally {
            await ts.close();
        }
    });
});
