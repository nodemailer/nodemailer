import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import SMTPConnection from '../../src/smtp-connection/index.js';
import * as shared from '../../src/shared/index.js';

describe('SMTPConnection cancellation lifecycle', () => {
    it('does not connect a supplied socket after close while DNS is pending', () => {
        const originalResolver = dns.Resolver;
        const answers: Array<(err: Error | null, addresses?: string[]) => void> = [];
        (dns as any).Resolver = class {
            resolve4(_host: string, callback: (err: Error | null, addresses?: string[]) => void) {
                answers.push(callback);
            }
            resolve6(_host: string, callback: (err: Error | null, addresses?: string[]) => void) {
                answers.push(callback);
            }
            cancel() {}
        };
        shared.dnsCache.clear();
        const socket = new net.Socket();
        let connects = 0;
        socket.connect = (() => {
            connects++;
            return socket;
        }) as typeof socket.connect;
        const client = new SMTPConnection({ host: 'pending-cancellation.example.test', port: 25, socket, logger: false });
        try {
            client.connect();
            assert.strictEqual(answers.length, 2);
            client.close();
            answers[0](null, ['127.0.0.1']);
            answers[1](null, []);
            assert.strictEqual(connects, 0);
        } finally {
            client.close();
            (dns as any).Resolver = originalResolver;
            shared.dnsCache.clear();
        }
    });

    it('does not start a deferred TLS upgrade after close', async t => {
        const upgrade = t.mock.method(tls, 'connect', () => {
            throw new Error('unexpected TLS upgrade');
        });
        const socket = new net.Socket();
        const client = new SMTPConnection({ host: 'localhost', port: 465, secure: true, connection: socket, logger: false });
        client.on('error', () => {});
        try {
            client.connect();
            client.close();
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.strictEqual(upgrade.mock.callCount(), 0);
            assert.strictEqual(client._phaseTimer, false);
        } finally {
            client.close();
        }
    });
});
