'use strict';

// CommonJS smoke test for the built package, run by `npm run test:cjs` as plain Node with
// NODE_OPTIONS=--no-experimental-require-module. EmailEngine bundles Nodemailer into a
// @yao-pkg/pkg binary that can only load a CommonJS module graph, and Node 22+ enables
// require(esm) by default, which would hide an ES module reached through require(). With the
// flag set, such a module throws ERR_REQUIRE_ESM here instead of in the binary. Kept as plain
// JavaScript on purpose: running it through tsx would let its loader transpile an ES module to
// CommonJS and mask exactly the failure this guards against.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const pkg = require(path.join(root, 'package.json'));
const entry = path.join(root, pkg.exports['.'].require);

async function run() {
    const nodemailer = require(entry);
    assert.strictEqual(typeof nodemailer.createTransport, 'function');

    // Every directory module the exports map publishes, the way deep imports load them
    for (const name of Object.keys(pkg.exports)) {
        if (/^\.\/lib\/[^*]+$/.test(name)) {
            require('nodemailer' + name.slice(1));
        }
    }

    // Composition with DKIM signing through the stream transport
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const streamTransport = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        dkim: {
            domainName: 'example.com',
            keySelector: 'test',
            privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' })
        }
    });
    const composed = await streamTransport.sendMail({
        from: 'Sender <sender@example.com>',
        to: 'Jõgeva <recipient@example.com>',
        subject: 'Tere, maailm',
        text: 'Hello',
        html: '<p>Hello</p>',
        attachments: [{ filename: 'note.txt', content: 'attached' }]
    });
    const raw = composed.message.toString();
    assert.match(raw, /^DKIM-Signature: /m);
    assert.match(raw, /^To: =\?UTF-8\?Q\?J=C3=B5geva\?= <recipient@example.com>/m);
    assert.match(raw, /multipart\/mixed/);

    // A delivery over SMTP against an in-process server exercises smtp-transport and smtp-connection
    let received = '';
    const server = net.createServer(socket => {
        let buffer = '';
        let inData = false;
        socket.write('220 localhost ESMTP\r\n');
        socket.on('data', chunk => {
            buffer += chunk.toString('binary');
            let pos;
            while ((pos = buffer.indexOf('\r\n')) >= 0) {
                const line = buffer.slice(0, pos);
                buffer = buffer.slice(pos + 2);
                if (inData) {
                    if (line === '.') {
                        inData = false;
                        socket.write('250 2.0.0 queued as smoke\r\n');
                    } else {
                        received += line + '\r\n';
                    }
                    continue;
                }
                const command = line.split(' ')[0].toUpperCase();
                if (command === 'EHLO') {
                    socket.write('250-localhost\r\n250 8BITMIME\r\n');
                } else if (command === 'DATA') {
                    inData = true;
                    socket.write('354 go ahead\r\n');
                } else if (command === 'QUIT') {
                    socket.end('221 bye\r\n');
                } else {
                    socket.write('250 ok\r\n');
                }
            }
        });
        socket.on('error', () => false);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const smtpTransport = nodemailer.createTransport({
            host: '127.0.0.1',
            port: server.address().port,
            secure: false,
            ignoreTLS: true
        });
        const info = await smtpTransport.sendMail({
            from: 'sender@example.com',
            to: 'recipient@example.com',
            subject: 'Smoke',
            text: 'Delivered'
        });
        assert.deepStrictEqual(info.accepted, ['recipient@example.com']);
        assert.match(info.response, /queued as smoke/);
        assert.match(received, /^Subject: Smoke$/m);
        smtpTransport.close();
    } finally {
        server.close();
    }

    console.log('CommonJS smoke test passed (' + process.version + ', ' + (process.env.NODE_OPTIONS || 'no NODE_OPTIONS') + ')');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
