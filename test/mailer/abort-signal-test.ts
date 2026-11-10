import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import Mail from '../../src/mailer/index.js';
import nodemailer from '../../src/nodemailer.js';

const message = { from: 'test@valid.sender', to: 'test@valid.recipient', text: 'hello' };
const abortError = (reason: unknown) => (err: any) => {
    assert.strictEqual(err.name, 'AbortError');
    assert.strictEqual(err.code, 'EABORT');
    assert.strictEqual(err.cause, reason);
    return true;
};

describe('sendMail AbortSignal', { timeout: 3000 }, () => {
    const unsupported: Record<string, (send?: () => void) => Mail<any>> = {
        json: () => nodemailer.createTransport({ jsonTransport: true }),
        stream: () => nodemailer.createTransport({ streamTransport: true, buffer: true }),
        custom: send =>
            new Mail({
                name: 'custom',
                version: '1',
                send(mail: any, callback: (err: Error | null, info?: any) => void) {
                    send?.();
                    setImmediate(() => callback(null, { custom: true, hasSignal: !!mail.data.signal }));
                }
            })
    };

    for (const [name, create] of Object.entries(unsupported)) {
        it(`ignores a live signal on the ${name} transport`, async () => {
            const transport = create();
            const controller = new AbortController();
            let plugins = 0;
            transport.use('compile', (_mail, next) => {
                plugins++;
                next();
            });
            const info = await transport.sendMail({ ...message, signal: controller.signal });
            assert.strictEqual(plugins, 1);
            if (name === 'json') {
                assert.strictEqual(JSON.parse(info.message).text, 'hello');
                assert.ok(!('signal' in JSON.parse(info.message)));
            } else if (name === 'stream') {
                assert.match(info.message.toString(), /hello/);
            } else {
                assert.deepStrictEqual(info, { custom: true, hasSignal: true });
            }
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
            // aborting after the send settled has no effect
            controller.abort();
        });

        it(`settles with EABORT for a pre-aborted signal on the ${name} transport`, async () => {
            let sent = 0;
            const transport = create(() => sent++);
            const controller = new AbortController();
            const reason = new Error('cancelled');
            controller.abort(reason);
            let plugins = 0;
            transport.use('compile', (_mail, next) => {
                plugins++;
                next();
            });
            await assert.rejects(transport.sendMail({ ...message, signal: controller.signal }), abortError(reason));
            const err = await new Promise<any>(resolve => transport.sendMail({ ...message, signal: controller.signal }, resolve));
            abortError(reason)(err);
            assert.strictEqual(plugins, 0);
            assert.strictEqual(sent, 0);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        });
    }

    for (const [label, value] of Object.entries({
        object: {},
        boolean: true,
        string: 'x',
        number: 1,
        abortedOnly: { aborted: false },
        listenerOnly: { addEventListener() {} }
    })) {
        it(`rejects a non-signal value (${label}) with ECONFIG without throwing`, async () => {
            let sent = 0;
            let plugins = 0;
            const transport = new Mail({
                name: 'supported',
                version: '1',
                supportsAbortSignal: true,
                send() {
                    sent++;
                }
            });
            transport.use('compile', (_mail, next) => {
                plugins++;
                next();
            });
            const isConfigError = (err: any) => {
                assert.strictEqual(err.code, 'ECONFIG');
                assert.match(err.message, /signal/);
                return true;
            };

            let promise: Promise<any> | undefined;
            assert.doesNotThrow(() => {
                promise = transport.sendMail({ ...message, signal: value } as any);
            });
            await assert.rejects(promise!, isConfigError);

            let calls = 0;
            const err = await new Promise<any>(resolve => {
                assert.doesNotThrow(() =>
                    transport.sendMail({ ...message, signal: value } as any, err => {
                        calls++;
                        resolve(err);
                    })
                );
            });
            isConfigError(err);
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.strictEqual(calls, 1);
            assert.strictEqual(plugins, 0);
            assert.strictEqual(sent, 0);
        });
    }

    it('rejects a non-signal value from the transport defaults with ECONFIG', async () => {
        const transport = nodemailer.createTransport({ jsonTransport: true }, { signal: {} } as any);
        await assert.rejects(transport.sendMail(message), { code: 'ECONFIG' });
    });

    it('accepts a signal-like object from another realm or a polyfill', async () => {
        const listeners: (() => void)[] = [];
        const signal = {
            aborted: false,
            reason: undefined,
            addEventListener(_type: string, fn: () => void) {
                listeners.push(fn);
            },
            removeEventListener(_type: string, fn: () => void) {
                listeners.splice(listeners.indexOf(fn), 1);
            }
        };
        const transport = nodemailer.createTransport({ jsonTransport: true });
        const info = await transport.sendMail({ ...message, signal } as any);
        assert.strictEqual(JSON.parse(info.message).text, 'hello');
        assert.strictEqual(listeners.length, 0);
    });

    for (const value of [null, undefined]) {
        for (const supportsAbortSignal of [true, false]) {
            it(`treats signal: ${value} as no signal (supportsAbortSignal: ${supportsAbortSignal})`, async () => {
                let seen: unknown = 'unset';
                const transport = new Mail({
                    name: 'custom',
                    version: '1',
                    supportsAbortSignal,
                    send(mail: any, callback: (err: Error | null, info?: any) => void) {
                        seen = mail.data.signal;
                        setImmediate(() => callback(null, { ok: true }));
                    }
                });
                assert.deepStrictEqual(await transport.sendMail({ ...message, signal: value } as any), { ok: true });
                assert.strictEqual(seen, value);
                const info = await new Promise<any>((resolve, reject) =>
                    transport.sendMail({ ...message, signal: value } as any, (err, info) => (err ? reject(err) : resolve(info)))
                );
                assert.deepStrictEqual(info, { ok: true });
            });
        }
    }

    it('honors a pre-aborted signal from defaults without dispatch', async () => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        controller.abort(reason);
        let sent = 0;
        const transport = {
            name: 'supported',
            version: '1',
            supportsAbortSignal: true,
            send() {
                sent++;
            }
        };
        const mail = new Mail(transport, {}, { signal: controller.signal });
        await assert.rejects(mail.sendMail(message), abortError(reason));
        assert.strictEqual(sent, 0);
    });

    for (const step of ['compile', 'stream']) {
        it(`aborts a stalled ${step} plugin once and ignores its late callback`, async () => {
            const controller = new AbortController();
            const reason = new Error('stop plugin');
            let sent = 0;
            let next!: (err?: Error | null) => void;
            const transport = {
                name: 'supported',
                version: '1',
                supportsAbortSignal: true,
                send() {
                    sent++;
                }
            };
            const mail = new Mail(transport);
            mail.use(step, (_mail, callback) => {
                next = callback;
            });
            let calls = 0;
            const result = new Promise<any>(resolve =>
                mail.sendMail({ ...message, signal: controller.signal } as any, err => {
                    calls++;
                    resolve(err);
                })
            );
            assert.ok(next);
            controller.abort(reason);
            abortError(reason)(await result);
            next();
            await new Promise<void>(resolve => setImmediate(resolve));
            assert.strictEqual(calls, 1);
            assert.strictEqual(sent, 0);
            assert.strictEqual(getEventListeners(controller.signal, 'abort').length, 0);
        });
    }
});
