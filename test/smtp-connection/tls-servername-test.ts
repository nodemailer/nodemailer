/**
 * The DNS cache used to store the TLS server name of the first connection that
 * resolved a host, and later connections to that host sent it as SNI in place
 * of their own tls.servername. Three connections, three server names, and the
 * server records what each handshake carried.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import SMTPConnection from '../../src/smtp-connection/index.js';
import * as shared from '../../src/shared/index.js';
import { startServer, type TestServer } from '../smtp-transport/smtp-fixtures.js';

// resolved by a stubbed resolver, so the lookup lands in the cache without any network
const HOST = 'servername.invalid';

describe('TLS server name', () => {
    let server: TestServer;
    // the SNI value of each handshake, in connection order
    const observed: string[] = [];

    before(async () => {
        server = await startServer({
            secure: true,
            authOptional: true,
            onSecure(socket: any, session: any, done: () => void) {
                observed.push(session.servername);
                done();
            }
        });
    });

    after(() => server.close());

    const connect = (servername: string | undefined, callback: (err?: Error | null) => void) => {
        const client = new SMTPConnection({
            host: HOST,
            port: server.port,
            secure: true,
            tls: servername ? { rejectUnauthorized: false, servername } : { rejectUnauthorized: false },
            logger: false
        });
        client.on('error', callback);
        client.on('end', () => callback());
        client.connect(() => client.quit());
    };

    it('sends the server name of each connection, not the one of the first to resolve the host', (t, done) => {
        shared.dnsCache.delete(HOST);
        t.mock.method(dns.Resolver.prototype, 'resolve4', (hostname: string, cb: (err: Error | null, addresses: string[]) => void) => {
            cb(null, ['127.0.0.1']);
        });
        t.mock.method(dns.Resolver.prototype, 'resolve6', (hostname: string, cb: (err: Error | null, addresses: string[]) => void) => {
            cb(null, []);
        });

        const finish = (err?: Error | null) => {
            t.mock.restoreAll();
            shared.dnsCache.delete(HOST);
            if (err) {
                return done(err);
            }
            assert.deepStrictEqual(observed, ['first.example.com', 'second.example.com', HOST]);
            done();
        };

        connect('first.example.com', err => {
            if (err) {
                return finish(err);
            }
            // the first connection resolved the host, the others answer from the cache
            assert.ok(shared.dnsCache.has(HOST));
            connect('second.example.com', err => {
                if (err) {
                    return finish(err);
                }
                connect(undefined, finish);
            });
        });
    });
});
