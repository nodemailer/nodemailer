/**
 * Minimal scripted SMTP server for tests that need byte-exact control over
 * every reply. smtp-server cannot be told to answer a given command with an
 * arbitrary status line, so the protocol failure tests use this instead.
 */

import net from 'node:net';
import SMTPConnection, { type SMTPConnectionOptions } from '../../src/smtp-connection/index.js';

/**
 * A reply for a command: the bytes to write, false to stay silent, or a function
 * that receives the command line and the socket and returns the reply (or nothing)
 */
export type RawReply = string | Buffer | false | ((line: string, socket: net.Socket) => string | Buffer | false | void);

/**
 * Replies keyed by the first word of the command (EHLO, MAIL, RCPT, DATA, ...).
 * `greeting` is sent when the connection opens, `DATA_END` answers the terminating
 * dot line and `DEFAULT` answers every command without an entry of its own, which
 * includes continuation lines such as the base64 blobs of AUTH LOGIN
 */
export interface RawServerScript {
    greeting?: RawReply;
    [command: string]: RawReply | undefined;
}

export interface RawServer extends net.Server {
    port: number;
    /** Every command line received, in order, message bodies excluded */
    commands: string[];
    /** Message bodies received, with the dot-stuffing removed */
    messages: string[];
    /** Destroys the open client sockets so close() does not have to wait for them */
    closeAll(): void;
}

const DEFAULT_REPLIES: { [command: string]: string } = {
    greeting: '220 test ESMTP\r\n',
    EHLO: '250 test\r\n',
    HELO: '250 test\r\n',
    LHLO: '250 test\r\n',
    STARTTLS: '454 4.7.0 TLS not available\r\n',
    AUTH: '235 2.7.0 Authentication successful\r\n',
    MAIL: '250 2.1.0 Sender OK\r\n',
    RCPT: '250 2.1.5 Recipient OK\r\n',
    DATA: '354 End data with <CR><LF>.<CR><LF>\r\n',
    DATA_END: '250 2.0.0 OK queued\r\n',
    RSET: '250 2.0.0 OK\r\n',
    NOOP: '250 2.0.0 OK\r\n',
    QUIT: '221 2.0.0 Bye\r\n',
    DEFAULT: '500 5.5.1 Command unrecognized\r\n'
};

/**
 * Starts the scripted server on an ephemeral port. The server emits 'command'
 * for every command line and 'body' for every line of a message body.
 */
export function startRawServer(script: RawServerScript, callback: (server: RawServer) => void): void {
    const sockets = new Set<net.Socket>();

    const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});

        let buffer = Buffer.alloc(0);
        let inData = false;
        let body: string[] = [];

        const send = (key: string, line: string): string | Buffer | false | void => {
            let reply: RawReply | undefined = Object.prototype.hasOwnProperty.call(script, key) ? script[key] : undefined;
            if (reply === undefined) {
                if (Object.prototype.hasOwnProperty.call(DEFAULT_REPLIES, key)) {
                    reply = DEFAULT_REPLIES[key];
                } else {
                    reply = script.DEFAULT !== undefined ? script.DEFAULT : DEFAULT_REPLIES.DEFAULT;
                }
            }
            const value = typeof reply === 'function' ? reply(line, socket) : reply;
            if (value) {
                socket.write(value);
            }
            return value;
        };

        send('greeting', '');

        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            let index: number;
            while ((index = buffer.indexOf('\r\n')) !== -1) {
                const line = buffer.subarray(0, index).toString();
                buffer = buffer.subarray(index + 2);

                if (inData) {
                    if (line === '.') {
                        inData = false;
                        server.messages.push(body.join('\r\n'));
                        body = [];
                        send('DATA_END', line);
                    } else {
                        body.push(line.replace(/^\./, ''));
                        server.emit('body', line);
                    }
                    continue;
                }

                server.commands.push(line);
                server.emit('command', line);

                const key = (line.split(/\s/)[0] || '').toUpperCase();
                const reply = send(key, line);
                if (key === 'DATA' && reply && reply.toString().charAt(0) === '3') {
                    inData = true;
                } else if (key === 'QUIT') {
                    socket.end();
                }
            }
        });
    }) as RawServer;

    server.commands = [];
    server.messages = [];
    server.closeAll = () => {
        for (const socket of sockets) {
            socket.destroy();
        }
    };

    server.listen(0, '127.0.0.1', () => {
        server.port = (server.address() as net.AddressInfo).port;
        callback(server);
    });
}

/**
 * Closes the server, runs the assertions and reports the outcome through `done`.
 * Assertion errors thrown inside a server close callback would otherwise escape
 * the test runner as uncaught exceptions
 */
export function finishRawServer(server: RawServer, done: (err?: unknown) => void, assertions?: () => void): void {
    server.closeAll();
    server.close(() => {
        try {
            if (assertions) {
                assertions();
            }
        } catch (err) {
            return done(err);
        }
        done();
    });
}

/**
 * A plaintext client for a scripted server, with the options a test needs on top
 */
export function createClient(server: RawServer, options?: Partial<SMTPConnectionOptions>): SMTPConnection {
    return new SMTPConnection(
        Object.assign(
            {
                port: server.port,
                host: '127.0.0.1',
                ignoreTLS: true,
                logger: false
            },
            options || {}
        )
    );
}
