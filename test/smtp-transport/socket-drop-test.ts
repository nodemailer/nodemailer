import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import SMTPTransport from '../../src/smtp-transport/index.js';
import SMTPPool from '../../src/smtp-pool/index.js';
import { startRawServerAsync as withRawServer, closeRawServer } from '../smtp-connection/raw-smtp-server.js';
import { mockMail, settle } from './smtp-fixtures.js';

const envelope = { from: 'sender@example.com', to: 'recipient@example.com' };

/**
 * A message whose stream sends part of the body, then stalls until the test destroys it
 */
function stallingMail(): { mail: ReturnType<typeof mockMail>; stream: PassThrough } {
    const mail = mockMail(envelope);
    const stream = new PassThrough();
    (mail.message as any).createReadStream = () => {
        stream.write('Subject: stalled\r\n\r\npartial body\r\n');
        return stream;
    };
    return { mail, stream };
}

describe('SMTP transport socket drops', () => {
    for (const [name, create] of [
        ['transport', (port: number) => new SMTPTransport({ host: '127.0.0.1', port, ignoreTLS: true, socketTimeout: 200, logger: false })],
        ['pool', (port: number) => new SMTPPool({ host: '127.0.0.1', port, ignoreTLS: true, socketTimeout: 200, logger: false })]
    ] as const) {
        it(`${name}: reports a send once when the message stream fails after a socket timeout`, async () => {
            // the server accepts DATA and then stays silent until the client gives up
            const server = await withRawServer({});
            const transport = create(server.port);
            const { mail, stream } = stallingMail();
            const results: any[] = [];

            try {
                const first = await new Promise<any>(resolve => {
                    transport.send(mail, (err: any) => {
                        results.push(err);
                        resolve(err);
                    });
                });
                assert.ok(first);
                assert.strictEqual(first.code, 'ETIMEDOUT');

                stream.destroy(new Error('late stream failure'));
                // destroy() emits its error on the next tick
                await new Promise(resolve => setImmediate(resolve));

                assert.strictEqual(results.length, 1, results.map(err => err && err.message).join(', '));
            } finally {
                transport.close();
                await closeRawServer(server);
            }
        });
    }

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
