import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    closeRawServer as closeServer,
    createClient,
    startRawServerAsync,
    type RawServer,
    type RawServerScript
} from './raw-smtp-server.js';
import type SMTPConnection from '../../src/smtp-connection/index.js';
import type { NodemailerError } from '../../src/errors.js';

const EHLO = '250-test\r\n250 PIPELINING\r\n';

const rawServer = (script: RawServerScript): Promise<RawServer> => startRawServerAsync({ EHLO, ...script });

async function connect(server: RawServer): Promise<SMTPConnection> {
    const client = createClient(server);
    await new Promise<void>((resolve, reject) => {
        client.once('error', reject);
        client.connect(() => resolve());
    });
    return client;
}

function send(client: SMTPConnection, to: string[]): Promise<{ err: NodemailerError | null; info: any }> {
    return new Promise(resolve =>
        client.send({ from: 'sender@example.com', to }, 'Subject: test\r\n\r\nhello\r\n', (err, info) => resolve({ err, info }))
    );
}

// RFC 2920: with PIPELINING the client sends MAIL FROM, every RCPT TO and DATA without waiting for
// the replies in between
describe('SMTPConnection envelope pipelining', { timeout: 10000 }, () => {
    it('sends the whole envelope before reading any reply', async () => {
        // the server answers nothing until DATA arrives, a client that waits for a reply in
        // between never gets there
        const server = await rawServer({
            MAIL: false,
            RCPT: false,
            DATA: (line, socket) => {
                socket.write('250 2.1.0 ok\r\n250 2.1.5 ok\r\n250 2.1.5 ok\r\n');
                return '354 go ahead\r\n';
            }
        });
        try {
            const client = await connect(server);
            const { err, info } = await send(client, ['a@example.com', 'b@example.com']);
            assert.ifError(err);
            assert.deepStrictEqual(info.accepted, ['a@example.com', 'b@example.com']);
            assert.deepStrictEqual(server.commands.slice(1), [
                'MAIL FROM:<sender@example.com>',
                'RCPT TO:<a@example.com>',
                'RCPT TO:<b@example.com>',
                'DATA'
            ]);
            assert.strictEqual(server.messages.length, 1);
            client.close();
        } finally {
            await closeServer(server);
        }
    });

    it('reports the recipients the server rejected', async () => {
        const server = await rawServer({ RCPT: line => (/missing/.test(line) ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n') });
        try {
            const client = await connect(server);
            const { err, info } = await send(client, ['a@example.com', 'missing@example.com']);
            assert.ifError(err);
            assert.deepStrictEqual(info.accepted, ['a@example.com']);
            assert.deepStrictEqual(info.rejected, ['missing@example.com']);
            client.close();
        } finally {
            await closeServer(server);
        }
    });

    it('reports a rejected sender after reading the replies sent along with it', async () => {
        const server = await rawServer({
            MAIL: '550 5.7.1 sender refused\r\n',
            RCPT: '503 5.5.1 need MAIL first\r\n',
            DATA: '503 5.5.1 need RCPT first\r\n'
        });
        try {
            const client = await connect(server);
            const { err } = await send(client, ['a@example.com']);
            assert.ok(err);
            assert.strictEqual(err.code, 'EENVELOPE');
            assert.strictEqual(err.command, 'MAIL FROM');
            assert.strictEqual(err.responseCode, 550);

            // every reply was read, the next message is answered with its own replies
            const second = await send(client, ['a@example.com']);
            assert.ok(second.err);
            assert.strictEqual(second.err.command, 'MAIL FROM');
            client.close();
        } finally {
            await closeServer(server);
        }
    });

    it('reports a closing server right away', async () => {
        const server = await rawServer({
            MAIL: (line, socket) => {
                socket.end('421 4.3.2 shutting down\r\n');
            },
            RCPT: false,
            DATA: false
        });
        try {
            const client = await connect(server);
            client.on('error', () => false);
            const { err } = await send(client, ['a@example.com']);
            assert.ok(err);
            assert.strictEqual(err.responseCode, 421);
            assert.strictEqual(err.command, 'MAIL FROM');
        } finally {
            await closeServer(server);
        }
    });

    it('ends the data mode of a server that accepted DATA without a recipient', async () => {
        // a server must refuse DATA once every recipient was rejected, this one does not
        const server = await rawServer({
            RCPT: line => (/missing/.test(line) ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n'),
            DATA_END: () =>
                server.messages[server.messages.length - 1] === '' ? '554 5.5.1 no valid recipients\r\n' : '250 2.0.0 queued\r\n'
        });
        try {
            const client = await connect(server);
            const { err } = await send(client, ['missing@example.com']);
            assert.ok(err);
            assert.strictEqual(err.code, 'EENVELOPE');
            assert.deepStrictEqual(err.rejected, ['missing@example.com']);
            // the data mode was ended with nothing in it
            assert.deepStrictEqual(server.messages, ['']);

            const second = await send(client, ['a@example.com']);
            assert.ifError(second.err);
            client.close();
        } finally {
            await closeServer(server);
        }
    });

    it('drops the connection instead of ending data mode after a refused sender', async () => {
        // a server that refuses MAIL FROM and still takes DATA could deliver whatever follows
        const server = await rawServer({ MAIL: '550 5.7.1 sender refused\r\n', RCPT: '250 2.1.5 ok\r\n', DATA: '354 go ahead\r\n' });
        try {
            const client = await connect(server);
            const ended = new Promise(resolve => client.once('end', resolve));
            const { err } = await send(client, ['a@example.com']);
            assert.ok(err);
            assert.strictEqual(err.command, 'MAIL FROM');
            await ended;
            assert.deepStrictEqual(server.messages, []);
        } finally {
            await closeServer(server);
        }
    });
});
