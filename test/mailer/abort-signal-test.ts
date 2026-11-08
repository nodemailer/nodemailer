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
    it('rejects signals on unsupported transports before plugins and send', async () => {
        await Promise.all(
            [
                nodemailer.createTransport({ jsonTransport: true }),
                nodemailer.createTransport({ streamTransport: true }),
                new Mail({
                    name: 'custom',
                    version: '1',
                    send() {
                        assert.fail('send called');
                    }
                })
            ].map(async transport => {
                let plugins = 0;
                transport.use('compile', (_mail, next) => {
                    plugins++;
                    next();
                });
                await assert.rejects(transport.sendMail({ ...message, signal: new AbortController().signal }), { code: 'ECONFIG' });
                assert.strictEqual(plugins, 0);
            })
        );
    });

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
