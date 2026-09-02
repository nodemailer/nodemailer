import net from 'node:net';
import util from 'node:util';
import { PassThrough } from 'node:stream';
import { SMTPServer } from 'smtp-server';
import xoauth2Server, { type OAuthServer } from '../smtp-connection/xoauth2-mock-server.js';
import { startRawServer } from '../smtp-connection/raw-smtp-server.js';
import type MailMessage from '../../src/mailer/mail-message.js';
import type { NodemailerError } from '../../src/errors.js';
import type { SMTPSentMessageInfo, SMTPTransportSendCallback } from '../../src/smtp-transport/index.js';

// Fixtures shared by the SMTP transport and SMTP pool behavior tests. Every server listens on
// an ephemeral port and tears its own connections down when closed

export interface MockEnvelope {
    from: string;
    to: string | string[];
}

/**
 * The parts of a compiled message the transports read: the envelope, the Message-ID and a body stream
 */
export class MockBuilder {
    envelope: MockEnvelope;
    rawMessage: string;
    mid: string;

    constructor(envelope: MockEnvelope, message: string, messageId?: string) {
        this.envelope = envelope;
        this.rawMessage = message;
        this.mid = messageId || '<test@valid.sender>';
    }

    getEnvelope() {
        return this.envelope;
    }

    messageId() {
        return this.mid;
    }

    createReadStream() {
        const stream = new PassThrough();
        setImmediate(() => stream.end(this.rawMessage));
        return stream;
    }

    getHeader(key: string) {
        return key === 'message-id' ? this.mid : '';
    }
}

export function mockMail(envelope: MockEnvelope, data: { [key: string]: any } = {}, body = 'teretere, vana kere'): MailMessage {
    // every message gets its own envelope object, the way MimeNode builds one per message:
    // the connection normalizes the envelope in place and keeps its recipient queue on it
    const ownEnvelope = { from: envelope.from, to: ([] as string[]).concat(envelope.to) };
    return { data, message: new MockBuilder(ownEnvelope, body) } as unknown as MailMessage;
}

export interface LogRecord {
    level: string;
    entry: { [key: string]: any };
    message: string;
    args: any[];
}

/**
 * A log call with its message formatted the way the logger would print it
 */
export interface LogLine {
    level: string;
    entry: { [key: string]: any };
    message: string;
}

/**
 * A bunyan style logger that records every call, so tests can assert on what gets logged:
 * `records` keep the format string and its arguments apart, `lines` carry the formatted message
 */
export function captureLogger(): { logger: { [level: string]: (...args: any[]) => void }; records: LogRecord[]; lines: LogLine[] } {
    const records: LogRecord[] = [];
    const lines: LogLine[] = [];
    const logger: { [level: string]: (...args: any[]) => void } = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
        logger[level] = (entry: { [key: string]: any }, message: string, ...args: any[]) => {
            records.push({ level, entry, message, args });
            lines.push({ level, entry, message: util.format(message, ...args) });
        };
    }
    return { logger, records, lines };
}

export interface TestServer {
    server: any;
    port: number;
    close(): Promise<void>;
}

/**
 * smtp-server on an ephemeral port. Accepts testuser/testpass, senders at valid.sender and
 * recipients at valid.recipient. Anything in options overrides these defaults
 */
export function startServer(options: { [key: string]: any } = {}): Promise<TestServer> {
    return new Promise(resolve => {
        const server = new SMTPServer(
            Object.assign(
                {
                    disabledCommands: ['STARTTLS'],
                    authMethods: ['PLAIN', 'LOGIN'],
                    onAuth(auth: any, session: any, done: any) {
                        if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                            return done(new Error('Invalid username or password'));
                        }
                        done(null, { user: 123 });
                    },
                    onMailFrom(address: any, session: any, done: any) {
                        if (!/@valid\.sender$/.test(address.address)) {
                            return done(new Error('Only user@valid.sender is allowed to send mail'));
                        }
                        done();
                    },
                    onRcptTo(address: any, session: any, done: any) {
                        if (!/@valid\.recipient$/.test(address.address)) {
                            return done(new Error('Only user@valid.recipient is allowed to receive mail'));
                        }
                        done();
                    },
                    onData(stream: any, session: any, done: any) {
                        stream.on('data', () => false);
                        stream.on('end', done);
                    },
                    logger: false
                },
                options
            )
        );

        server.listen(0, () => {
            resolve({
                server,
                port: server.server.address().port,
                close: () =>
                    new Promise<void>(closed => {
                        // do not wait for the smtp-server close timeout on connections a test left open
                        for (const connection of server.connections) {
                            connection.close();
                        }
                        server.close(() => closed());
                    })
            });
        });
    });
}

export interface RawSmtpServer {
    port: number;
    /** Number of accepted connections so far, dropped ones included */
    connections: number;
    close(): Promise<void>;
}

/**
 * Bare SMTP server on an ephemeral port. Destroys the first `dropFirst` connections right after
 * accepting them, before any greeting is written, and serves a minimal SMTP dialogue after that
 */
export function startRawSmtpServer(dropFirst: number): Promise<RawSmtpServer> {
    return new Promise(resolve => {
        let connections = 0;
        startRawServer(
            {
                greeting: (line, socket) => {
                    connections++;
                    if (connections <= dropFirst) {
                        socket.destroy();
                        return false;
                    }
                    return '220 raw.test ESMTP\r\n';
                },
                EHLO: '250-raw.test\r\n250 8BITMIME\r\n'
            },
            server =>
                resolve({
                    port: server.port,
                    get connections() {
                        return connections;
                    },
                    close: () =>
                        new Promise<void>(closed => {
                            server.closeAll();
                            server.close(() => closed());
                        })
                })
        );
    });
}

export interface OAuthFixture {
    x2server: OAuthServer;
    /** Token endpoint url for the XOAuth2 accessUrl option */
    accessUrl: string;
    /** Access tokens the endpoint generated for refresh requests, in order */
    issued: string[];
    stop(): Promise<void>;
}

/**
 * The mock OAuth2 token endpoint from the smtp-connection tests, with the user 'testuser' and
 * the refresh token 'refresh-token' registered
 */
export function startOAuthServer(): Promise<OAuthFixture> {
    const issued: string[] = [];
    const x2server = xoauth2Server({
        onUpdate: (username, accessToken) => {
            issued.push(accessToken);
        }
    });
    // the constructor falls back to a fixed port for 0, so ask for an ephemeral port afterwards
    x2server.options.port = 0;
    x2server.addUser('testuser', 'refresh-token');
    // addUser generated an initial token as well, only count the tokens the clients ask for
    issued.length = 0;

    return new Promise(resolve => {
        x2server.start(() => {
            const port = (x2server.server.address() as net.AddressInfo).port;
            resolve({
                x2server,
                accessUrl: 'http://127.0.0.1:' + port,
                issued,
                stop: () => new Promise<void>(stopped => x2server.stop(() => stopped()))
            });
        });
    });
}

/**
 * smtp-server options for an XOAUTH2 only server that validates tokens against the mock endpoint.
 * Every presented access token is appended to `attempts`
 */
export function oauthServerOptions(x2server: OAuthServer, attempts: string[]): { [key: string]: any } {
    return {
        authMethods: ['XOAUTH2'],
        onAuth(auth: any, session: any, done: any) {
            attempts.push(auth.accessToken);
            if (auth.method === 'XOAUTH2' && x2server.validateAccessToken(auth.username, auth.accessToken)) {
                return done(null, { user: 123 });
            }
            done(null, {
                data: {
                    status: '401',
                    schemes: 'bearer mac',
                    scope: 'https://mail.google.com/'
                }
            });
        }
    };
}

export interface SendOutcome {
    err: NodemailerError | null;
    info?: SMTPSentMessageInfo;
}

/**
 * Runs send() and resolves with whatever the callback received, so the assertions can live in
 * the test body instead of inside a callback the transport might swallow errors from
 */
export function settle(
    transport: { send(mail: MailMessage, callback: SMTPTransportSendCallback): unknown },
    mail: MailMessage
): Promise<SendOutcome> {
    return new Promise(resolve => {
        transport.send(mail, (err, info) => resolve({ err, info }));
    });
}

/**
 * A TCP port nothing listens on
 */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, () => {
            const port = (probe.address() as net.AddressInfo).port;
            probe.close(() => resolve(port));
        });
    });
}
