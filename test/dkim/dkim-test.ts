import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
// mailauth 5 needs Node.js 22 for its undici dependency, the end to end verification
// runs where it loads and is skipped elsewhere
const mailauth = await import('mailauth').then(
    module => module,
    () => null
);
import DKIM from '../../src/dkim/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIBywIBAAJhANCx7ncKUfQ8wBUYmMqq6ky8rBB0NL8knBf3+uA7q/CSxpX6sQ8N
dFNtEeEd7gu7BWEM7+PkO1P0M78eZOvVmput8BP9R44ARpgHY4V0qSCdUt4rD32n
wfjlGbh8p5ua5wIDAQABAmAm+uUQpQPTu7kg95wqVqw2sxLsa9giT6M8MtxQH7Uo
1TF0eAO0TQ4KOxgY1S9OT5sGPVKnag258m3qX7o5imawcuyStb68DQgAUg6xv7Af
AqAEDfYN5HW6xK+X81jfOUECMQDr7XAS4PERATvgb1B3vRu5UEbuXcenHDYgdoyT
3qJFViTbep4qeaflF0uF9eFveMcCMQDic10rJ8fopGD7/a45O4VJb0+lRXVdqZxJ
QzAp+zVKWqDqPfX7L93SQLzOGhdd7OECMQDeQyD7WBkjSQNMy/GF7I1qxrscIxNN
VqGTcbu8Lti285Hjhx/sqhHHHGwU9vB7oM8CMQDKTS3Kw/s/xrot5O+kiZwFgr+w
cmDrj/7jJHb+ykFNb7GaEkiSYqzUjKkfpweBDYECMFJUyzuuFJAjq3BXmGJlyykQ
TweUw+zMVdSXjO+FCPcYNi6CP1t1KoESzGKBVoqA/g==
-----END RSA PRIVATE KEY-----`;

/*
const publicKey = `-----BEGIN PUBLIC KEY-----
MHwwDQYJKoZIhvcNAQEBBQADawAwaAJhANCx7ncKUfQ8wBUYmMqq6ky8rBB0NL8k
nBf3+uA7q/CSxpX6sQ8NdFNtEeEd7gu7BWEM7+PkO1P0M78eZOvVmput8BP9R44A
RpgHY4V0qSCdUt4rD32nwfjlGbh8p5ua5wIDAQAB
-----END PUBLIC KEY-----`;
*/

describe('DKIM Tests', { timeout: 100 * 1000 }, () => {
    it('should sign message', (t, done) => {
        const message = `From: saatja aadress
To: Saaja aadress
Subject: pealkiri
  mitmel
  real
Message-Id: test

tere tere
teine rida
`;
        const s = new PassThrough();
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        });

        const output = dkim.sign(s);

        const chunks: Buffer[] = [];

        let reading = false;
        const readNext = () => {
            const chunk = output.read(10 * 1024);
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            const message = Buffer.concat(chunks).toString();
            assert.strictEqual(
                message,
                'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=node.ee; q=dns/txt;\r\n' +
                    ' s=dkim; bh=h2JdEKA6yVYSGuI3DQCDlg2KL+96GxA7Yw7owvsYDUM=;\r\n' +
                    ' h=from:subject:message-id:to;\r\n' +
                    ' b=tey8mL2VQVuy/phh7yEKi86Y0Yyzyy04qTy73G4yg3qdEDB7uymjNr32ruRPVFmC9PimIK75p\r\n' +
                    ' KVPF5T1oB8/oY6TFqyyuECRrI4D2CfG3VXWBShK32r1Wtv7eWN04b4s\r\n' +
                    'From: saatja aadress\n' +
                    'To: Saaja aadress\n' +
                    'Subject: pealkiri\n' +
                    '  mitmel\n' +
                    '  real\n' +
                    'Message-Id: test\n' +
                    '\n' +
                    'tere tere\n' +
                    'teine rida\n'
            );
            done();
        });

        let inputPos = 0;
        const messageBuf = Buffer.from(message);
        const writeNext = () => {
            if (inputPos >= messageBuf.length) {
                return s.end();
            }
            s.write(Buffer.from([messageBuf[inputPos++]]));
            setImmediate(writeNext);
        };
        writeNext();
    });

    it('should sign large message using cache dir', (t, done) => {
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        const output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            assert.ok(!err);
            done();
        });

        const chunks: Buffer[] = [];

        let reading = false;
        const readNext = () => {
            const chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            const message = Buffer.concat(chunks).toString();
            assert.ok(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=') >= 0);
            assert.strictEqual(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex'),
                '16078d67ecb4c9954f2568b3bd20e8b5'
            );
            assert.ok(output.usingCache);
            done();
        });
    });

    it('should sign large message without cache dir', (t, done) => {
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        });

        const output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            assert.ok(!err);
            done();
        });

        const chunks: Buffer[] = [];

        let reading = false;
        const readNext = () => {
            const chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            const message = Buffer.concat(chunks).toString();
            assert.ok(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=') >= 0);
            assert.strictEqual(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex'),
                '16078d67ecb4c9954f2568b3bd20e8b5'
            );
            assert.strictEqual(output.usingCache, false);
            done();
        });
    });

    it('should emit cache error', (t, done) => {
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: '/rootertewywrtyreetwert' // expecting that this location does not exist or is unwritable
        });

        const output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            assert.ok(err);
            done();
        });
    });

    it('should sign large message as Buffer', (t, done) => {
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        const output = dkim.sign(fs.readFileSync(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            assert.ok(!err);
            done();
        });

        const chunks: Buffer[] = [];

        let reading = false;
        const readNext = () => {
            const chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            const message = Buffer.concat(chunks).toString();
            assert.ok(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=') >= 0);
            assert.strictEqual(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex'),
                '16078d67ecb4c9954f2568b3bd20e8b5'
            );
            assert.ok(output.usingCache);
            done();
        });
    });

    it('should sign large message as String', (t, done) => {
        const dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        const output = dkim.sign(fs.readFileSync(__dirname + '/fixtures/large.eml', 'utf-8'));
        output.on('error', err => {
            assert.ok(!err);
            done();
        });

        const chunks: Buffer[] = [];

        let reading = false;
        const readNext = () => {
            const chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            const message = Buffer.concat(chunks).toString();
            assert.ok(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=') >= 0);
            assert.strictEqual(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex'),
                '16078d67ecb4c9954f2568b3bd20e8b5'
            );
            assert.ok(output.usingCache);
            done();
        });
    });
});

describe(
    'DKIM signatures verified by mailauth',
    { timeout: 100 * 1000, skip: mailauth ? false : 'mailauth does not load on this Node.js version' },
    () => {
        // raw messages that were not built by nodemailer, signed here and verified by an
        // independent implementation
        const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const dnsRecord = 'v=DKIM1; k=rsa; p=' + keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        const resolver = async (name: string, rr: string) => {
            if (rr === 'TXT' && name === 'test._domainkey.example.com') {
                return [[dnsRecord]];
            }
            const err: NodeJS.ErrnoException = new Error('queryTxt ENOTFOUND ' + name);
            err.code = 'ENOTFOUND';
            throw err;
        };

        const dkim = new DKIM({
            domainName: 'example.com',
            keySelector: 'test',
            privateKey: keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
        });

        const signMessage = (input: Buffer | string): Promise<Buffer> =>
            new Promise((resolve, reject) => {
                const chunks: Buffer[] = [];
                const output = dkim.sign(input);
                output.on('data', chunk => chunks.push(chunk));
                output.on('error', reject);
                output.on('end', () => resolve(Buffer.concat(chunks)));
            });

        const verify = async (message: Buffer) => {
            const result = await mailauth!.dkimVerify(message, { resolver });
            return result.results.map((entry: any) => entry.status.result);
        };

        const cases: [string, Buffer | string][] = [
            ['body without a final line break', 'From: a@example.com\r\nSubject: x\r\n\r\nabc'],
            ['body with trailing whitespace only lines', 'From: a@example.com\r\nSubject: x\r\n\r\nabc \t\r\n  \r\n\t\r\n\r\n'],
            ['body of a single byte', 'From: a@example.com\r\nSubject: x\r\n\r\nA'],
            ['empty body', 'From: a@example.com\r\nSubject: x\r\n\r\n'],
            ['body of empty lines only', 'From: a@example.com\r\nSubject: x\r\n\r\n\r\n\r\n'],
            ['LF line endings', 'From: a@example.com\nSubject: x\n\nline 1\nline 2\n'],
            ['tabs and runs of spaces in the body', 'From: a@example.com\r\nSubject: x\r\n\r\na \t b   c\t\r\n\td\r\n'],
            ['folded header with tabs', 'From: a@example.com\r\nSubject: first\r\n\tsecond  \r\n \t third\r\n\r\nbody\r\n'],
            ['UTF-8 header with an ideographic space', Buffer.from('From: a@example.com\r\nSubject: 日本　語\r\n\r\nbody\r\n')],
            ['8-bit header bytes', Buffer.from('From: a@example.com\r\nSubject: j\xf5geva\r\n\r\nbody\r\n', 'binary')],
            ['duplicate header fields', 'Subject: first\r\nFrom: a@example.com\r\nSubject: second\r\n\r\nbody\r\n'],
            ['multipart fixture message', fs.readFileSync(__dirname + '/fixtures/message1.eml')]
        ];

        for (const [name, message] of cases) {
            it('should sign a message with a ' + name, async () => {
                const signed = await signMessage(message);
                assert.deepStrictEqual(await verify(signed), ['pass']);
                // the message itself is not changed
                assert.ok(signed.subarray(signed.length - Buffer.byteLength(message)).equals(Buffer.from(message)));
            });
        }

        it('should sign a message without a body', async () => {
            const signed = await signMessage('From: a@example.com\r\nSubject: x');
            assert.ok(signed.toString().startsWith('DKIM-Signature: '));
            assert.ok(signed.toString().endsWith('\r\nFrom: a@example.com\r\nSubject: x'));
            // the verifier expects a header separator, an empty body does not change the signature
            assert.deepStrictEqual(await verify(Buffer.concat([signed, Buffer.from('\r\n\r\n')])), ['pass']);
        });

        it('should produce a signature that does not verify once the body changes', async () => {
            const signed = await signMessage('From: a@example.com\r\nSubject: x\r\n\r\nabc\r\n');
            const tampered = Buffer.concat([signed, Buffer.from('more\r\n')]);
            assert.notDeepStrictEqual(await verify(tampered), ['pass']);
        });

        it('should produce a signature that does not verify once a signed header changes', async () => {
            const signed = await signMessage('From: a@example.com\r\nSubject: x\r\n\r\nabc\r\n');
            const tampered = Buffer.from(signed.toString().replace('Subject: x', 'Subject: y'));
            assert.notDeepStrictEqual(await verify(tampered), ['pass']);
        });
    }
);
