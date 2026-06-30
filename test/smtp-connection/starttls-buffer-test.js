'use strict';

/**
 * STARTTLS response-injection regression test.
 *
 * RFC 3207 requires the client to discard any data buffered before the TLS
 * handshake. If the pre-TLS receive buffer (`_remainder`) is not cleared on
 * upgrade, an on-path attacker can append a CRLF-free fragment after the "220"
 * STARTTLS reply; that fragment survives the handshake and gets prepended to
 * the first genuine, cert-validated EHLO response, where `_actionEHLO`'s
 * substring capability regexes absorb attacker-chosen tokens into the trusted
 * post-TLS session.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const SMTPConnection = require('../../lib/smtp-connection');

const PORT_NUMBER = 28627;

// self-signed cert for CN=localhost (shared with the fetch test fixtures)
const TLS_KEY =
    '-----BEGIN RSA PRIVATE KEY-----\n' +
    'MIIEpAIBAAKCAQEA6Z5Qqhw+oWfhtEiMHE32Ht94mwTBpAfjt3vPpX8M7DMCTwHs\n' +
    '1xcXvQ4lQ3rwreDTOWdoJeEEy7gMxXqH0jw0WfBx+8IIJU69xstOyT7FRFDvA1yT\n' +
    'RXY2yt9K5s6SKken/ebMfmZR+03ND4UFsDzkz0FfgcjrkXmrMF5Eh5UXX/+9YHeU\n' +
    'xlp0gMAt+/SumSmgCaysxZLjLpd4uXz+X+JVxsk1ACg1NoEO7lWJC/3WBP7MIcu2\n' +
    'wVsMd2XegLT0gWYfT1/jsIH64U/mS/SVXC9QhxMl9Yfko2kx1OiYhDxhHs75RJZh\n' +
    'rNRxgfiwgSb50Gw4NAQaDIxr/DJPdLhgnpY6UQIDAQABAoIBAE+tfzWFjJbgJ0ql\n' +
    's6Ozs020Sh4U8TZQuonJ4HhBbNbiTtdDgNObPK1uNadeNtgW5fOeIRdKN6iDjVeN\n' +
    'AuXhQrmqGDYVZ1HSGUfD74sTrZQvRlWPLWtzdhybK6Css41YAyPFo9k4bJ2ZW2b/\n' +
    'p4EEQ8WsNja9oBpttMU6YYUchGxo1gujN8hmfDdXUQx3k5Xwx4KA68dveJ8GasIt\n' +
    'd+0Jd/FVwCyyx8HTiF1FF8QZYQeAXxbXJgLBuCsMQJghlcpBEzWkscBR3Ap1U0Zi\n' +
    '4oat8wrPZGCblaA6rNkRUVbc/+Vw0stnuJ/BLHbPxyBs6w495yBSjBqUWZMvljNz\n' +
    'm9/aK0ECgYEA9oVIVAd0enjSVIyAZNbw11ElidzdtBkeIJdsxqhmXzeIFZbB39Gd\n' +
    'bjtAVclVbq5mLsI1j22ER2rHA4Ygkn6vlLghK3ZMPxZa57oJtmL3oP0RvOjE4zRV\n' +
    'dzKexNGo9gU/x9SQbuyOmuauvAYhXZxeLpv+lEfsZTqqrvPUGeBiEQcCgYEA8poG\n' +
    'WVnykWuTmCe0bMmvYDsWpAEiZnFLDaKcSbz3O7RMGbPy1cypmqSinIYUpURBT/WY\n' +
    'wVPAGtjkuTXtd1Cy58m7PqziB7NNWMcsMGj+lWrTPZ6hCHIBcAImKEPpd+Y9vGJX\n' +
    'oatFJguqAGOz7rigBq6iPfeQOCWpmprNAuah++cCgYB1gcybOT59TnA7mwlsh8Qf\n' +
    'bm+tSllnin2A3Y0dGJJLmsXEPKtHS7x2Gcot2h1d98V/TlWHe5WNEUmx1VJbYgXB\n' +
    'pw8wj2ACxl4ojNYqWPxegaLd4DpRbtW6Tqe9e47FTnU7hIggR6QmFAWAXI+09l8y\n' +
    'amssNShqjE9lu5YDi6BTKwKBgQCuIlKGViLfsKjrYSyHnajNWPxiUhIgGBf4PI0T\n' +
    '/Jg1ea/aDykxv0rKHnw9/5vYGIsM2st/kR7l5mMecg/2Qa145HsLfMptHo1ZOPWF\n' +
    '9gcuttPTegY6aqKPhGthIYX2MwSDMM+X0ri6m0q2JtqjclAjG7yG4CjbtGTt/UlE\n' +
    'WMlSZwKBgQDslGeLUnkW0bsV5EG3AKRUyPKz/6DVNuxaIRRhOeWVKV101claqXAT\n' +
    'wXOpdKrvkjZbT4AzcNrlGtRl3l7dEVXTu+dN7/ZieJRu7zaStlAQZkIyP9O3DdQ3\n' +
    'rIcetQpfrJ1cAqz6Ng0pD0mh77vQ13WG1BBmDFa2A9BuzLoBituf4g==\n' +
    '-----END RSA PRIVATE KEY-----';

const TLS_CERT =
    '-----BEGIN CERTIFICATE-----\n' +
    'MIICpDCCAYwCCQCuVLVKVTXnAjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDEwls\n' +
    'b2NhbGhvc3QwHhcNMTUwMjEyMTEzMjU4WhcNMjUwMjA5MTEzMjU4WjAUMRIwEAYD\n' +
    'VQQDEwlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDp\n' +
    'nlCqHD6hZ+G0SIwcTfYe33ibBMGkB+O3e8+lfwzsMwJPAezXFxe9DiVDevCt4NM5\n' +
    'Z2gl4QTLuAzFeofSPDRZ8HH7wgglTr3Gy07JPsVEUO8DXJNFdjbK30rmzpIqR6f9\n' +
    '5sx+ZlH7Tc0PhQWwPOTPQV+ByOuReaswXkSHlRdf/71gd5TGWnSAwC379K6ZKaAJ\n' +
    'rKzFkuMul3i5fP5f4lXGyTUAKDU2gQ7uVYkL/dYE/swhy7bBWwx3Zd6AtPSBZh9P\n' +
    'X+OwgfrhT+ZL9JVcL1CHEyX1h+SjaTHU6JiEPGEezvlElmGs1HGB+LCBJvnQbDg0\n' +
    'BBoMjGv8Mk90uGCeljpRAgMBAAEwDQYJKoZIhvcNAQELBQADggEBABXm8GPdY0sc\n' +
    'mMUFlgDqFzcevjdGDce0QfboR+M7WDdm512Jz2SbRTgZD/4na42ThODOZz9z1AcM\n' +
    'zLgx2ZNZzVhBz0odCU4JVhOCEks/OzSyKeGwjIb4JAY7dh+Kju1+6MNfQJ4r1Hza\n' +
    'SVXH0+JlpJDaJ73NQ2JyfqELmJ1mTcptkA/N6rQWhlzycTBSlfogwf9xawgVPATP\n' +
    '4AuwgjHl12JI2HVVs1gu65Y3slvaHRCr0B4+Kg1GYNLLcbFcK+NEHrHmPxy9TnTh\n' +
    'Zwp1dsNQU+Xkylz8IUANWSLHYZOMtN2e5SKIdwTtl5C8YxveuY8YKb1gDExnMraT\n' +
    'VGXQDqPleug=\n' +
    '-----END CERTIFICATE-----';

describe('STARTTLS buffer handling', () => {
    let server;

    before((t, done) => {
        // Raw SMTP server that injects a CRLF-free fragment right after the
        // STARTTLS "220" reply, then upgrades the same socket to TLS. The
        // injected fragment advertises a bogus SMTPUTF8 capability; the genuine
        // post-TLS EHLO response below never advertises it.
        server = net.createServer(socket => {
            socket.on('error', () => {});
            socket.write('220 test ESMTP\r\n');

            const onPlainData = data => {
                const command = data.toString();
                if (/^EHLO/i.test(command)) {
                    socket.write('250-localhost\r\n250 STARTTLS\r\n');
                } else if (/^STARTTLS/i.test(command)) {
                    socket.removeListener('data', onPlainData);

                    // single write: "220 Ready\r\n" followed by an unterminated
                    // (CRLF-free) injected fragment that lands in the client's
                    // pre-TLS `_remainder`. The TLS server stays passive until it
                    // receives the client's ClientHello, so nothing else is sent
                    // in cleartext after the fragment.
                    socket.write('220 2.0.0 Ready to start TLS\r\n250-SMTPUTF8 INJECTED-MARKER ');

                    const secureSocket = new tls.TLSSocket(socket, {
                        isServer: true,
                        key: TLS_KEY,
                        cert: TLS_CERT
                    });
                    secureSocket.on('error', () => {});
                    secureSocket.on('data', secureData => {
                        const secureCommand = secureData.toString();
                        if (/^EHLO/i.test(secureCommand)) {
                            // genuine post-TLS capabilities — no SMTPUTF8 here
                            secureSocket.write('250-localhost\r\n250 HELP\r\n');
                        } else if (/^QUIT/i.test(secureCommand)) {
                            secureSocket.write('221 Bye\r\n');
                            secureSocket.end();
                        }
                    });
                }
            };

            socket.on('data', onPlainData);
        });

        server.listen(PORT_NUMBER, done);
    });

    after((t, done) => {
        server.close(done);
    });

    it('discards pre-TLS buffered bytes so they cannot inject post-TLS capabilities', (t, done) => {
        let client = new SMTPConnection({
            port: PORT_NUMBER,
            host: 'localhost',
            requireTLS: true,
            tls: { rejectUnauthorized: false },
            logger: false
        });

        client.on('error', err => {
            assert.ok(!err, err && err.message);
        });

        client.connect(() => {
            // upgrade must have succeeded
            assert.strictEqual(client.secure, true);

            // the injected fragment must NOT have leaked into the secured session
            assert.ok(!client._supportedExtensions.includes('SMTPUTF8'), 'injected SMTPUTF8 capability leaked across the TLS boundary');
            assert.ok(!/INJECTED-MARKER/.test(client.lastServerResponse || ''), 'injected fragment leaked into the post-TLS EHLO response');

            client.close();
        });

        client.on('end', done);
    });
});
