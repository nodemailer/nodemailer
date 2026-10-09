import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from '../../src/nodemailer.js';
import { closeRawServer, startRawServerAsync, type RawServer } from '../smtp-connection/raw-smtp-server.js';
import { captureLogger } from '../smtp-transport/smtp-fixtures.js';

interface ScriptedServer {
    server: RawServer;
    port: number;
    /** Connections accepted so far */
    connections: number;
    /** Replies to MAIL FROM, keyed by the running count of MAIL commands. Replying with a 421 also closes the connection */
    mailReplies: { [count: number]: string };
    /** Recipients answered with a 550 */
    rejected: Set<string>;
    /** Sent on the connection, then the connection is closed, this long after a message was accepted */
    closeAfterMessage?: { delay: number; reply: string } | undefined;
}

// An SMTP server whose answers the tests decide, so the pool can be shown a connection that the
// server drops in between two messages or a recipient it refuses
async function startServer(): Promise<ScriptedServer> {
    let mailCount = 0;
    const state = { connections: 0, mailReplies: {}, rejected: new Set() } as ScriptedServer;

    state.server = await startRawServerAsync({
        greeting: () => {
            state.connections++;
            return '220 test ESMTP\r\n';
        },
        EHLO: '250-test\r\n250 PIPELINING\r\n',
        MAIL: (line, socket) => {
            const reply = state.mailReplies[++mailCount] || '250 2.1.0 ok\r\n';
            if (reply.startsWith('421')) {
                socket.end(reply);
                return false;
            }
            return reply;
        },
        RCPT: line =>
            state.rejected.has((line.match(/<([^>]*)>/) || [])[1] as string) ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n',
        DATA_END: (line, socket) => {
            if (state.closeAfterMessage) {
                const { delay, reply } = state.closeAfterMessage;
                setTimeout(() => socket.end(reply), delay);
            }
            return '250 2.0.0 queued\r\n';
        }
    });
    state.port = state.server.port;
    return state;
}

// the warn and error lines, the pool must not report a server that closed an idle connection
const problems = (lines: { level: string; message: string }[]): string[] =>
    lines.filter(line => ['warn', 'error', 'fatal'].includes(line.level)).map(line => line.level + ': ' + line.message);

const message = (to = 'rcpt@example.com') => ({ from: 'sender@example.com', to, subject: 'test', text: 'hello' });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('SMTP pool connection reuse', { timeout: 20000 }, () => {
    it('sends a message over a new connection when the server dropped the reused one', async () => {
        const server = await startServer();
        // the second message finds the server closing the connection it is about to reuse
        server.mailReplies[2] = '421 4.4.2 closing, idle\r\n';
        const { logger } = captureLogger();
        const transport = nodemailer.createTransport({
            pool: true,
            maxConnections: 1,
            host: '127.0.0.1',
            port: server.port,
            logger
        } as any);
        try {
            await transport.sendMail(message());
            await pause(200);
            const info = await transport.sendMail(message());
            assert.strictEqual(info.response, '250 2.0.0 queued');
            assert.strictEqual(server.connections, 2);
        } finally {
            transport.close();
            await closeRawServer(server.server);
        }
    });

    it('keeps the connection after the server refused a message', async () => {
        const server = await startServer();
        server.rejected.add('missing@example.com');
        const transport = nodemailer.createTransport({
            pool: true,
            maxConnections: 1,
            host: '127.0.0.1',
            port: server.port,
            logger: false
        } as any);
        try {
            const results = [];
            for (const to of ['a@example.com', 'missing@example.com', 'b@example.com', 'missing@example.com', 'c@example.com']) {
                results.push(
                    // eslint-disable-next-line no-await-in-loop
                    await transport.sendMail(message(to)).then(
                        () => 'sent',
                        (err: any) => err.code
                    )
                );
            }
            assert.deepStrictEqual(results, ['sent', 'EENVELOPE', 'sent', 'EENVELOPE', 'sent']);
            assert.strictEqual(server.connections, 1);
            assert.strictEqual(server.server.commands.filter(line => line === 'RSET').length, 2);
        } finally {
            transport.close();
            await closeRawServer(server.server);
        }
    });

    it('treats a server closing an idle connection as a normal close', async () => {
        const server = await startServer();
        server.closeAfterMessage = { delay: 100, reply: '421 4.4.2 idle timeout\r\n' };
        const { logger, lines } = captureLogger();
        const transport = nodemailer.createTransport({
            pool: true,
            maxConnections: 1,
            host: '127.0.0.1',
            port: server.port,
            logger
        } as any);
        try {
            await transport.sendMail(message());
            await pause(300);
            await transport.sendMail(message());
            assert.strictEqual(server.connections, 2);
            assert.deepStrictEqual(problems(lines), []);
        } finally {
            transport.close();
            await closeRawServer(server.server);
        }
    });

    it('treats a server dropping an idle connection without a reply as a normal close', async () => {
        const server = await startServer();
        server.closeAfterMessage = { delay: 100, reply: '' };
        const { logger, lines } = captureLogger();
        const transport = nodemailer.createTransport({
            pool: true,
            maxConnections: 1,
            host: '127.0.0.1',
            port: server.port,
            logger
        } as any);
        try {
            await transport.sendMail(message());
            await pause(300);
            await transport.sendMail(message());
            assert.strictEqual(server.connections, 2);
            // the connection logs the close itself, the pool does not count it as a failure
            assert.deepStrictEqual(
                problems(lines).filter(line => /Pool Error/.test(line)),
                []
            );
        } finally {
            transport.close();
            await closeRawServer(server.server);
        }
    });

    it('closes a connection that stayed idle for idleTimeout', async () => {
        const server = await startServer();
        const transport = nodemailer.createTransport({
            pool: true,
            idleTimeout: 200,
            host: '127.0.0.1',
            port: server.port,
            logger: false
        } as any);
        try {
            await transport.sendMail(message());
            await pause(600);
            assert.ok(server.server.commands.includes('QUIT'), server.server.commands.join(', '));
            assert.strictEqual(server.connections, 1);

            // the pool opens a new connection for the next message
            await transport.sendMail(message());
            assert.strictEqual(server.connections, 2);
        } finally {
            transport.close();
            await closeRawServer(server.server);
        }
    });
});
