import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type Nodemailer from '../../src/nodemailer.js';
import type { NodemailerError } from '../../src/errors.js';

interface ApiRequest {
    method: string | undefined;
    url: string | undefined;
    headers: http.IncomingHttpHeaders;
    body: string;
}

// The module reads ETHEREAL_API, ETHEREAL_API_KEY and ETHEREAL_WEB when it is loaded, so the
// environment is set up around a local server first and the module is imported after that.
// The account cache is module state as well, which is why the failing requests come first.
describe('createTestAccount', { timeout: 10000 }, () => {
    let server: http.Server;
    let nodemailer: typeof Nodemailer;
    let requests: ApiRequest[];
    let response: { status: number; body: string };

    before(async () => {
        requests = [];
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(response.body);
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

        // the trailing slashes and the whitespace around the key are stripped
        process.env.ETHEREAL_API = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/';
        process.env.ETHEREAL_API_KEY = ' unit-test-key ';
        process.env.ETHEREAL_WEB = 'https://web.example/';

        // a query string makes this a module instance of its own, so the environment above is
        // what it reads even when the test runner has loaded the module before (bun test runs
        // every file in one process)
        const specifier = '../../src/nodemailer.js?create-test-account';
        nodemailer = ((await import(specifier)) as { default: typeof Nodemailer }).default;
    });

    after(() => new Promise(resolve => server.close(resolve)));

    it('should build the message url from ETHEREAL_WEB before an account exists', () => {
        assert.strictEqual(
            nodemailer.getTestMessageUrl({ response: '250 Accepted [STATUS=new MSGID=abc]' }),
            'https://web.example/message/abc'
        );
    });

    it('should post to the API endpoint of the environment and report an error response', (t, done) => {
        response = { status: 200, body: JSON.stringify({ status: 'error', error: 'Quota exceeded' }) };

        nodemailer.createTestAccount((err, account) => {
            assert.ok(err);
            assert.strictEqual(err.message, 'Quota exceeded');
            assert.ok(!account);

            assert.strictEqual(requests.length, 1);
            const request = requests[0];
            assert.strictEqual(request.method, 'POST');
            assert.strictEqual(request.url, '/user');
            assert.strictEqual(request.headers['content-type'], 'application/json');
            assert.strictEqual(request.headers.authorization, 'Bearer unit-test-key');
            const body = JSON.parse(request.body);
            assert.strictEqual(body.requestor, 'nodemailer');
            assert.ok(/^\d+\.\d+\.\d+/.test(body.version), body.version);
            done();
        });
    });

    it('should reject a response without a success status', async () => {
        response = { status: 200, body: JSON.stringify({ user: 'someone@ethereal.email' }) };

        await assert.rejects(nodemailer.createTestAccount(), { message: 'Request failed' });
    });

    it('should reject a response that is not JSON', async () => {
        response = { status: 200, body: '<html>maintenance</html>' };

        await assert.rejects(nodemailer.createTestAccount(false), err => err instanceof SyntaxError);
    });

    it('should reject an HTTP error status', async () => {
        response = { status: 500, body: 'Internal Server Error' };

        await assert.rejects(nodemailer.createTestAccount(), { code: 'EFETCH', message: 'Invalid status code 500' });
    });

    it('should pass a connection failure on', (t, done) => {
        // a server that hangs up on every connection
        const broken = net.createServer(socket => socket.destroy());
        broken.listen(0, '127.0.0.1', () => {
            const apiUrl = 'http://127.0.0.1:' + (broken.address() as AddressInfo).port;

            nodemailer.createTestAccount(apiUrl, (err, account) => {
                assert.ok(err);
                assert.strictEqual((err as NodemailerError).code, 'EFETCH');
                assert.ok(!account);
                broken.close(done);
            });
        });
    });

    it('should return the account without the status field', (t, done) => {
        response = {
            status: 200,
            body: JSON.stringify({
                status: 'success',
                user: 'someone@ethereal.email',
                pass: 'secret',
                smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
                imap: { host: 'imap.ethereal.email', port: 993, secure: true },
                pop3: { host: 'pop3.ethereal.email', port: 995, secure: true },
                web: 'https://ethereal.test',
                mxEnabled: true
            })
        };
        const before = requests.length;

        nodemailer.createTestAccount(null, (err, account) => {
            assert.ok(!err);
            assert.strictEqual(requests.length, before + 1);
            assert.strictEqual(account.user, 'someone@ethereal.email');
            assert.strictEqual(account.pass, 'secret');
            assert.strictEqual(account.mxEnabled, true);
            assert.deepStrictEqual(account.smtp, { host: 'smtp.ethereal.email', port: 587, secure: false });
            assert.ok(!('status' in account));
            done();
        });
    });

    it('should hand out the cached account on later calls', async () => {
        const before = requests.length;
        response = { status: 500, body: 'the API is not consulted again' };

        const account = await nodemailer.createTestAccount();
        assert.strictEqual(account.user, 'someone@ethereal.email');

        const again = await new Promise((resolve, reject) =>
            nodemailer.createTestAccount((err, value) => (err ? reject(err) : resolve(value)))
        );
        assert.strictEqual(again, account);
        assert.strictEqual(requests.length, before);
    });

    it('should build the message url from the web address of the account', () => {
        assert.strictEqual(
            nodemailer.getTestMessageUrl({ response: '250 Accepted [STATUS=new MSGID=abc]' }),
            'https://ethereal.test/message/abc'
        );
    });
});
