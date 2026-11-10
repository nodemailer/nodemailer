import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { getEventListeners, once } from 'node:events';
import { PassThrough } from 'node:stream';
import nodemailer from '../../src/nodemailer.js';
import { startServer } from './smtp-fixtures.js';

const message = { from: 'test@valid.sender', to: 'test@valid.recipient', text: 'hello' };
const abortError = (reason: unknown) => (err: any) => err.name === 'AbortError' && err.code === 'EABORT' && err.cause === reason;

describe('SMTP transport AbortSignal', { timeout: 5000 }, () => {
    it('cancels a pending getSocket and destroys a socket returned later', async () => {
        let completeSocket!: (err: Error | null, options?: any) => void;
        let requested!: () => void;
        const request = new Promise<void>(resolve => {
            requested = resolve;
        });
        const transporter = nodemailer.createTransport({
            host: 'example.test',
            port: 25,
            getSocket(_options, done) {
                completeSocket = done;
                requested();
            }
        });
        const controller = new AbortController();
        const reason = new Error('cancel socket');
        const sending = transporter.sendMail({ ...message, signal: controller.signal });
        const cancelled = assert.rejects(sending, abortError(reason));
        await request;
        controller.abort(reason);
        await cancelled;
        const socket = new net.Socket();
        completeSocket(null, { connection: socket });
        assert.strictEqual(socket.destroyed, true);
        assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
    });

    it('closes an active socket while waiting for the SMTP greeting', async () => {
        let accepted!: (socket: net.Socket) => void;
        const connection = new Promise<net.Socket>(resolve => {
            accepted = resolve;
        });
        const server = net.createServer(socket => {
            socket.on('error', () => {});
            accepted(socket);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port });
        const controller = new AbortController();
        const reason = new Error('cancel greeting');
        let socket: net.Socket | undefined;
        try {
            const sending = transporter.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, abortError(reason));
            socket = await connection;
            const closed = once(socket, 'close');
            controller.abort(reason);
            await cancelled;
            await closed;
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            socket?.destroy();
            server.close();
        }
    });

    it('removes its listener after normal success and SMTP error', async () => {
        const ts = await startServer();
        const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, auth: { user: 'testuser', pass: 'testpass' } });
        try {
            const success = new AbortController();
            await transporter.sendMail({ ...message, signal: success.signal });
            assert.strictEqual(getEventListeners(success.signal, 'abort').length, 0);
            const failure = new AbortController();
            await assert.rejects(transporter.sendMail({ ...message, to: 'bad@invalid.test', signal: failure.signal }));
            assert.strictEqual(getEventListeners(failure.signal, 'abort').length, 0);
        } finally {
            await ts.close();
        }
    });
    it('cancels a delivery while SMTP authentication is pending', async () => {
        let authenticating!: () => void;
        const authStarted = new Promise<void>(resolve => {
            authenticating = resolve;
        });
        const ts = await startServer({
            onAuth() {
                authenticating();
            }
        });
        const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, auth: { user: 'testuser', pass: 'testpass' } });
        const controller = new AbortController();
        const reason = new Error('cancel auth');
        try {
            const sending = transporter.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, abortError(reason));
            await authStarted;
            controller.abort(reason);
            await cancelled;
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            await ts.close();
        }
    });
    it('releases an attachment source when aborted during DATA', async () => {
        let receiving!: () => void;
        const dataStarted = new Promise<void>(resolve => {
            receiving = resolve;
        });
        const ts = await startServer({
            onData(stream: any) {
                stream.once('data', receiving);
                stream.resume();
            }
        });
        const transporter = nodemailer.createTransport({ host: '127.0.0.1', port: ts.port, auth: { user: 'testuser', pass: 'testpass' } });
        const controller = new AbortController();
        const source = new PassThrough();
        const reason = new Error('cancel DATA');
        try {
            const sending = transporter.sendMail({ ...message, signal: controller.signal, attachments: [{ filename: 'test.txt', content: source }] });
            const cancelled = assert.rejects(sending, abortError(reason));
            source.write('partial attachment');
            await dataStarted;
            controller.abort(reason);
            await cancelled;
            assert.strictEqual(source.destroyed, true);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            source.destroy();
            await ts.close();
        }
    });

    for (const pool of [false, true]) {
        it(`does not acquire a socket for a pre-aborted ${pool ? 'pooled' : 'SMTP'} send`, async () => {
            let requests = 0;
            const transporter = nodemailer.createTransport({
                pool,
                host: 'example.test',
                port: 25,
                getSocket() {
                    requests++;
                }
            });
            const controller = new AbortController();
            const reason = new Error('pre-aborted');
            controller.abort(reason);
            try {
                await assert.rejects(transporter.sendMail({ ...message, signal: controller.signal }), abortError(reason));
                assert.strictEqual(requests, 0);
            } finally {
                transporter.close({ force: true });
            }
        });
    }
});
