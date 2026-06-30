'use strict';

/**
 * Regression test: a `secure` connection established over a caller-provided
 * `options.socket` (a not-yet-connected socket, as returned by a custom
 * getSocket handler) must still perform the TLS handshake. Otherwise AUTH and
 * the message body would be transmitted in cleartext even though the caller
 * requested a secure connection.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const SMTPConnection = require('../../lib/smtp-connection');
const SMTPServer = require('smtp-server').SMTPServer;

const PORT_NUMBER = 28628;

describe('Secure connection over a provided socket', () => {
    let secureServer;

    before((t, done) => {
        // TLS-only server: a client that does not perform the TLS handshake
        // cannot complete the SMTP greeting here.
        secureServer = new SMTPServer({
            secure: true,
            authOptional: true,
            onData: (stream, session, callback) => {
                stream.on('data', () => {});
                stream.on('end', callback);
            },
            logger: false
        });
        secureServer.listen(PORT_NUMBER, done);
    });

    after((t, done) => {
        secureServer.close(done);
    });

    it('upgrades a provided socket to TLS when secure is set', (t, done) => {
        let client = new SMTPConnection({
            port: PORT_NUMBER,
            secure: true,
            // a not-yet-connected socket supplied by the caller
            socket: new net.Socket(),
            tls: { rejectUnauthorized: false },
            logger: false
        });

        client.on('error', err => {
            assert.ok(!err, err && err.message);
        });

        client.connect(() => {
            assert.strictEqual(client.secure, true);
            // the underlying socket must actually be a TLS socket, not the
            // plain socket that was handed in
            assert.ok(client._socket instanceof tls.TLSSocket, 'connection was not upgraded to TLS');
            assert.strictEqual(client._socket.encrypted, true);
            client.close();
        });

        client.on('end', done);
    });
});
