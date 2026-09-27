import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import SMTPTransport from '../../src/smtp-transport/index.js';
import { startRawServer, finishRawServer, type RawServer, type RawServerScript } from '../smtp-connection/raw-smtp-server.js';
import { mockMail, settle } from './smtp-fixtures.js';

const envelope = { from: 'sender@example.com', to: 'recipient@example.com' };

function withRawServer(script: RawServerScript): Promise<RawServer> {
    return new Promise(resolve => startRawServer(script, resolve));
}

function closeRawServer(server: RawServer): Promise<void> {
    return new Promise((resolve, reject) => finishRawServer(server, err => (err ? reject(err) : resolve())));
}

describe('SMTP transport socket drops', () => {
    for (const [how, drop] of [
        ['destroyed', (socket: Socket) => socket.destroy()],
        ['ended', (socket: Socket) => socket.end()]
    ] as const) {
        it(`reports the error when the server ${how} the socket while the message is in flight`, async () => {
            const server = await withRawServer({
                DATA: (line, socket) => {
                    drop(socket);
                    return false;
                }
            });
            const transport = new SMTPTransport({ host: '127.0.0.1', port: server.port, ignoreTLS: true, logger: false });
            try {
                const { err, info } = await settle(transport, mockMail(envelope));
                assert.ok(err, 'an error is reported');
                assert.strictEqual(info, undefined);
                assert.ok(['ECONNECTION', 'ESOCKET'].includes(err.code as string), `code ${err.code}: ${err.message}`);
            } finally {
                transport.close();
                await closeRawServer(server);
            }
        });
    }

    it('keeps the ETLS code for a socket lost during the STARTTLS upgrade', async () => {
        const server = await withRawServer({
            EHLO: '250-test\r\n250 STARTTLS\r\n',
            STARTTLS: (line, socket) => {
                socket.write('220 2.0.0 Ready to start TLS\r\n');
                setImmediate(() => socket.destroy());
                return false;
            }
        });
        const transport = new SMTPTransport({ host: '127.0.0.1', port: server.port, logger: false, tls: { rejectUnauthorized: false } });
        try {
            const { err } = await settle(transport, mockMail(envelope));
            assert.ok(err);
            assert.ok(['ETLS', 'ESOCKET', 'ECONNECTION'].includes(err.code as string), `code ${err.code}: ${err.message}`);
        } finally {
            transport.close();
            await closeRawServer(server);
        }
    });
});
