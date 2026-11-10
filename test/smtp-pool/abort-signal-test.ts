import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { getEventListeners } from 'node:events';
import nodemailer from '../../src/nodemailer.js';
import SMTPPool, { type SMTPPoolOptions } from '../../src/smtp-pool/index.js';
import type { SMTPTransportGetSocketCallback } from '../../src/smtp-transport/index.js';
import { startRawSmtpServer, startServer } from '../smtp-transport/smtp-fixtures.js';

const message = { from: 'test@valid.sender', to: 'test@valid.recipient', text: 'hello' };
const auth = { user: 'testuser', pass: 'testpass' };
const abortError = (reason: unknown) => (err: any) => err.name === 'AbortError' && err.code === 'EABORT' && err.cause === reason;

describe('SMTP pool AbortSignal', { timeout: 5000 }, () => {
    it('cancels a queued mail without disturbing the active and later deliveries', async () => {
        let release!: () => void;
        let held!: () => void;
        const holding = new Promise<void>(resolve => {
            held = resolve;
        });
        let messages = 0;
        const ts = await startServer({
            onData(stream: any, _session: any, done: any) {
                stream.resume();
                stream.on('end', () => {
                    messages++;
                    if (messages === 1) {
                        release = done;
                        held();
                    } else {
                        return done();
                    }
                });
            }
        });
        const transporter = nodemailer.createTransport({ pool: true, host: '127.0.0.1', port: ts.port, maxConnections: 1, auth });
        const controller = new AbortController();
        const reason = new Error('queued');
        try {
            const active = transporter.sendMail(message);
            await holding;
            const queued = transporter.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(queued, abortError(reason));
            const later = transporter.sendMail(message);
            controller.abort(reason);
            await cancelled;
            release();
            await Promise.all([active, later]);
            assert.strictEqual(messages, 2);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close();
            await ts.close();
        }
    });

    it('cancels an active delivery and permits the next mail to succeed', async () => {
        let held!: () => void;
        const holding = new Promise<void>(resolve => {
            held = resolve;
        });
        let messages = 0;
        const ts = await startServer({
            onData(stream: any, _session: any, done: any) {
                stream.resume();
                stream.on('end', () => {
                    messages++;
                    if (messages === 1) held();
                    else return done();
                });
            }
        });
        const transporter = nodemailer.createTransport({ pool: true, host: '127.0.0.1', port: ts.port, maxConnections: 1, auth });
        const controller = new AbortController();
        const reason = new Error('active');
        try {
            const sending = transporter.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, abortError(reason));
            await holding;
            controller.abort(reason);
            await cancelled;
            await transporter.sendMail(message);
            assert.strictEqual(messages, 2);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close();
            await ts.close();
        }
    });
    it('does not requeue an aborted entry during the delayed close window', async () => {
        let requested!: () => void;
        const request = new Promise<void>(resolve => {
            requested = resolve;
        });
        let socketRequests = 0;
        const transporter = nodemailer.createTransport({
            pool: true,
            host: 'example.test',
            port: 25,
            maxConnections: 1,
            getSocket() {
                socketRequests++;
                requested();
            }
        });
        const pool = transporter.transporter as SMTPPool;
        const controller = new AbortController();
        const reason = new Error('abort during close');
        let calls = 0;
        try {
            const result = new Promise<any>(resolve =>
                transporter.sendMail({ ...message, signal: controller.signal }, err => {
                    calls++;
                    resolve(err);
                })
            );
            await request;
            // Drive the resource close event directly to enter the 50 ms requeue window
            // without an SMTP error racing its callback and consuming the entry first.
            const resource = pool._connections[0];
            assert.ok(resource.queueEntry);
            resource.emit('close');
            controller.abort(reason);
            assert.ok(abortError(reason)(await result));
            // The pool schedules requeue processing 50 ms after close. Wait past that
            // scheduled callback to prove it cannot resurrect this entry.
            await new Promise<void>(resolve => setTimeout(resolve, 100));
            assert.strictEqual(calls, 1);
            assert.strictEqual(socketRequests, 1);
            assert.strictEqual(pool.pendingCount(), 0);
            assert.strictEqual(pool._queue.length, 0);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close({ force: true });
        }
    });
    it('removes the listener when the pool is closed with a queued message', async () => {
        let requested!: () => void;
        const request = new Promise<void>(resolve => {
            requested = resolve;
        });
        const transporter = nodemailer.createTransport({
            pool: true,
            host: 'example.test',
            port: 25,
            maxConnections: 1,
            getSocket() {
                requested();
            }
        });
        const controller = new AbortController();
        try {
            const active = transporter.sendMail(message);
            const activeFailed = assert.rejects(active);
            await request;
            const queued = transporter.sendMail({ ...message, signal: controller.signal });
            const queuedFailed = assert.rejects(queued);
            transporter.close({ force: true });
            await Promise.all([activeFailed, queuedFailed]);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close({ force: true });
        }
    });

    it('removes the listener when connection retries are exhausted', async () => {
        const ts = await startRawSmtpServer(Infinity);
        const transporter = nodemailer.createTransport({ pool: true, host: '127.0.0.1', port: ts.port, maxConnections: 1, maxRequeues: 1 });
        const controller = new AbortController();
        try {
            await assert.rejects(transporter.sendMail({ ...message, signal: controller.signal }));
            assert.strictEqual(ts.connections, 2);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close({ force: true });
            await ts.close();
        }
    });
    it('destroys a socket returned after an active pooled send was aborted', async () => {
        let completeSocket!: (err: Error | null, options?: any) => void;
        let requested!: () => void;
        const request = new Promise<void>(resolve => {
            requested = resolve;
        });
        const transporter = nodemailer.createTransport({
            pool: true,
            host: 'example.test',
            port: 25,
            getSocket(_options: SMTPPoolOptions, done: SMTPTransportGetSocketCallback) {
                completeSocket = done;
                requested();
            }
        });
        const controller = new AbortController();
        const reason = new Error('cancel pending pool socket');
        try {
            const sending = transporter.sendMail({ ...message, signal: controller.signal });
            const cancelled = assert.rejects(sending, abortError(reason));
            await request;
            controller.abort(reason);
            await cancelled;
            const socket = new net.Socket();
            completeSocket(null, { connection: socket });
            assert.strictEqual(socket.destroyed, true);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
            transporter.close({ force: true });
        }
    });

    it('aborts one active resource while another completes', async () => {
        const releases: Array<() => void> = [];
        let firstHeld!: () => void;
        const firstReady = new Promise<void>(resolve => {
            firstHeld = resolve;
        });
        let bothHeld!: () => void;
        const holding = new Promise<void>(resolve => {
            bothHeld = resolve;
        });
        const ts = await startServer({
            onData(stream: any, _session: any, done: any) {
                stream.resume();
                stream.on('end', () => {
                    releases.push(done);
                    if (releases.length === 1) firstHeld();
                    if (releases.length === 2) bothHeld();
                });
            }
        });
        const transporter = nodemailer.createTransport({ pool: true, host: '127.0.0.1', port: ts.port, maxConnections: 2, auth });
        const firstController = new AbortController();
        const secondController = new AbortController();
        const reason = new Error('one of two');
        try {
            // The first is already at DATA before starting the second so release order is known.
            const first = transporter.sendMail({ ...message, signal: firstController.signal });
            const cancelled = assert.rejects(first, abortError(reason));
            await firstReady;
            const second = transporter.sendMail({ ...message, signal: secondController.signal });
            await holding;
            firstController.abort(reason);
            await cancelled;
            releases[1]();
            await second;
            assert.strictEqual(getEventListeners(firstController.signal, 'abort').length, 0);
            assert.strictEqual(getEventListeners(secondController.signal, 'abort').length, 0);
        } finally {
            transporter.close({ force: true });
            await ts.close();
        }
    });

    it('cleans up after success and ignores a later abort', async () => {
        const ts = await startServer();
        const transporter = nodemailer.createTransport({ pool: true, host: '127.0.0.1', port: ts.port, maxConnections: 1, auth });
        const controller = new AbortController();
        let calls = 0;
        try {
            await new Promise<void>((resolve, reject) =>
                transporter.sendMail({ ...message, signal: controller.signal }, err => {
                    calls++;
                    if (err) reject(err);
                    else resolve();
                })
            );
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
            controller.abort(new Error('too late'));
            await transporter.sendMail(message);
            assert.strictEqual(calls, 1);
        } finally {
            transporter.close({ force: true });
            await ts.close();
        }
    });
});
