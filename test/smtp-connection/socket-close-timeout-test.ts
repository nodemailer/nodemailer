import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import SMTPConnection from '../../src/smtp-connection/index.js';

describe('SMTP connection socketCloseTimeout', () => {
    it('keeps the five-second graceful close by default', t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const socket = new net.Socket();
        const client = new SMTPConnection({ logger: false });
        client._socket = socket;
        client.stage = 'connected';
        const end = t.mock.method(socket, 'end', () => socket);
        const destroy = t.mock.method(socket, 'destroy');

        client.close();
        assert.strictEqual(end.mock.callCount(), 1);
        assert.strictEqual(destroy.mock.callCount(), 0);
        t.mock.timers.tick(4999);
        assert.strictEqual(destroy.mock.callCount(), 0);
        t.mock.timers.tick(1);
        assert.strictEqual(destroy.mock.callCount(), 1);
        assert.strictEqual(socket.destroyed, true);
    });

    it('destroys immediately without calling end when configured with zero', t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const socket = new net.Socket();
        const client = new SMTPConnection({ logger: false, socketCloseTimeout: 0 });
        client._socket = socket;
        client.stage = 'connected';
        const end = t.mock.method(socket, 'end', () => socket);
        const destroy = t.mock.method(socket, 'destroy');
        let ends = 0;
        client.on('end', () => ends++);

        client.close();
        client.close();
        assert.strictEqual(socket.destroyed, true);
        assert.strictEqual(end.mock.callCount(), 0);
        assert.strictEqual(destroy.mock.callCount(), 1);
        assert.strictEqual(ends, 1);
        t.mock.timers.tick(5000);
        assert.strictEqual(destroy.mock.callCount(), 1);
    });

    it('uses the configured positive grace period', t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const socket = new net.Socket();
        const client = new SMTPConnection({ logger: false, socketCloseTimeout: 250 });
        client._socket = socket;
        client.stage = 'connected';
        const end = t.mock.method(socket, 'end', () => socket);
        const destroy = t.mock.method(socket, 'destroy');

        client.close();
        assert.strictEqual(end.mock.callCount(), 1);
        t.mock.timers.tick(249);
        assert.strictEqual(destroy.mock.callCount(), 0);
        t.mock.timers.tick(1);
        assert.strictEqual(destroy.mock.callCount(), 1);
    });

    for (const value of [-1, NaN, Infinity, '0' as unknown as number]) {
        it(`keeps the five-second graceful close for an invalid value (${String(value)})`, t => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const socket = new net.Socket();
            const client = new SMTPConnection({ logger: false, socketCloseTimeout: value });
            client._socket = socket;
            client.stage = 'connected';
            const end = t.mock.method(socket, 'end', () => socket);
            const destroy = t.mock.method(socket, 'destroy');

            client.close();
            assert.strictEqual(end.mock.callCount(), 1);
            t.mock.timers.tick(4999);
            assert.strictEqual(destroy.mock.callCount(), 0);
            t.mock.timers.tick(1);
            assert.strictEqual(destroy.mock.callCount(), 1);
        });
    }

    it('does not keep a destroy timer after the peer closes', t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const socket = new net.Socket();
        const client = new SMTPConnection({ logger: false, socketCloseTimeout: 250 });
        client._socket = socket;
        client.stage = 'connected';
        t.mock.method(socket, 'end', () => socket);
        const destroy = t.mock.method(socket, 'destroy');

        client.close();
        socket.emit('close');
        t.mock.timers.tick(5000);
        assert.strictEqual(destroy.mock.callCount(), 0);
        socket.destroy();
    });

    it('still destroys a connection in the init stage without a grace period', t => {
        const socket = new net.Socket();
        const client = new SMTPConnection({ logger: false, socketCloseTimeout: 250 });
        client._socket = socket;
        const end = t.mock.method(socket, 'end', () => socket);

        client.close();
        assert.strictEqual(socket.destroyed, true);
        assert.strictEqual(end.mock.callCount(), 0);
    });
});
