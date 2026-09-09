/**
 * The DNS cache used to store the TLS server name of the first connection that
 * resolved a host, and later connections to that host sent it as SNI in place
 * of their own tls.servername. Three connections, three server names, and the
 * server records what each handshake carried.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import SMTPConnection from '../../src/smtp-connection/index.js';
import * as shared from '../../src/shared/index.js';
import { startServer, type TestServer } from '../smtp-transport/smtp-fixtures.js';

// a name, so the lookup goes through the DNS cache
const HOST = 'localhost';

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
        // a failed connection emits error and then end, call back once with the error
        let errored = false;
        client.on('error', err => {
            errored = true;
            callback(err);
        });
        client.on('end', () => {
            if (!errored) {
                return callback();
            }
        });
        client.connect(() => client.quit());
    };

    it('sends the server name of each connection, not the one of the first to resolve the host', (t, done) => {
        // the first connection resolves the host, the other two answer from the cache
        shared.dnsCache.delete(HOST);

        connect('first.example.com', err => {
            if (err) {
                return done(err);
            }
            assert.ok(shared.dnsCache.has(HOST));
            connect('second.example.com', err => {
                if (err) {
                    return done(err);
                }
                connect(undefined, err => {
                    if (err) {
                        return done(err);
                    }
                    assert.deepStrictEqual(observed, ['first.example.com', 'second.example.com', HOST]);
                    done();
                });
            });
        });
    });
});
