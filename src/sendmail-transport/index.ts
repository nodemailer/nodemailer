import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as packageData from '../package-info.js';
import * as shared from '../shared/index.js';
import type { Logger } from '../shared/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import LeWindows from '../mime-node/le-windows.js';
import LeUnix from '../mime-node/le-unix.js';
import type { MimeNodeEnvelope } from '../mime-node/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, TransportOptions } from '../mailer/index.js';

/**
 * Options for the Sendmail transport
 */
export interface SendmailTransportOptions extends TransportOptions {
    /** Selects this transport in createTransport, the binary itself is set with `path` */
    sendmail?: boolean | string;
    /** Path to the sendmail binary, defaults to 'sendmail' */
    path?: string;
    /** Either 'windows' or 'unix', the line ending of the message piped to sendmail */
    newline?: string;
    /** Arguments for the sendmail binary, replaces the default '-f <sender>' */
    args?: string[];
}

/**
 * The value the Sendmail transport hands to the send callback
 */
export interface SendmailSentMessageInfo {
    /** The envelope the message was sent with */
    envelope: MimeNodeEnvelope;
    /** Message-ID value of the message */
    messageId: string;
    /** Always 'Messages queued for delivery' */
    response: string;
}

/**
 * Generates a Transport object for Sendmail
 *
 * Possible options can be the following:
 *
 *  * **path** optional path to sendmail binary
 *  * **newline** either 'windows' or 'unix'
 *  * **args** an array of arguments for the sendmail binary
 *
 * @constructor
 * @param optional config parameter for Sendmail
 */
export default class SendmailTransport {
    declare mailer: Mail<SendmailSentMessageInfo>;
    _spawn: typeof spawn;
    options: SendmailTransportOptions;
    name: string;
    version: string;
    path: string;
    args: string[] | false;
    logger: Logger;
    winbreak: boolean;

    constructor(options?: SendmailTransportOptions | string) {
        options = options || {};

        // use a reference to spawn for mocking purposes
        this._spawn = spawn;

        this.options = options as SendmailTransportOptions;

        this.name = 'Sendmail';
        this.version = packageData.version;

        this.path = 'sendmail';
        this.args = false;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'sendmail'
        });

        if (typeof options === 'string') {
            this.path = options;
        } else if (typeof options === 'object') {
            if (options.path) {
                this.path = options.path;
            }
            if (Array.isArray(options.args)) {
                this.args = options.args;
            }
        }

        this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes(
            ((options as SendmailTransportOptions).newline || '').toString().toLowerCase()
        );
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param mail MailComposer object
     * @param done Callback function to run when the sending is completed
     */
    send(mail: MailMessage<SendmailSentMessageInfo>, done: (err: Error | null, info?: SendmailSentMessageInfo) => void): void {
        // Sendmail strips this header line by itself. send() runs after the message was
        // compiled, so mail.message is set
        mail.message!.keepBcc = true;

        const envelope = mail.message!.getEnvelope();
        const messageId = mail.message!.messageId();
        let returned: boolean | undefined;

        const hasInvalidAddresses = ([] as string[])
            .concat(envelope.from || [])
            .concat(envelope.to || [])
            // a local part is either a dot-atom or a quoted-string, so a leading dash sits at
            // offset 0 or, behind the opening quote, at offset 1. Only the first shape is read
            // as an option by sendmail, but both are the address this guard keeps out of argv
            .some(addr => /^"?-/.test(addr));
        if (hasInvalidAddresses) {
            const err: NodemailerError = new Error('Can not send mail. Invalid envelope addresses.');
            err.code = errors.ESENDMAIL;
            return done(err);
        }

        // force -i to keep single dots
        const args = this.args
            ? ['-i'].concat(this.args).concat(envelope.to)
            : ['-i'].concat(envelope.from ? ['-f', envelope.from] : []).concat(envelope.to);

        const callback = (err?: Error | null): void => {
            if (returned) {
                // ignore any additional responses, already done
                return;
            }
            returned = true;
            if (typeof done === 'function') {
                if (err) {
                    return done(err);
                }
                return done(null, {
                    envelope,
                    messageId,
                    response: 'Messages queued for delivery'
                });
            }
        };

        let sendmail: ChildProcessWithoutNullStreams;
        try {
            sendmail = this._spawn(this.path, args);
        } catch (E: any) {
            this.logger.error(
                {
                    err: E,
                    tnx: 'spawn',
                    messageId
                },
                'Error occurred while spawning sendmail. %s',
                E.message
            );
            return callback(E);
        }

        if (sendmail) {
            sendmail.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'spawn',
                        messageId
                    },
                    'Error occurred when sending message %s. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });

            sendmail.once('exit', code => {
                if (!code) {
                    return callback();
                }
                const err: NodemailerError = new Error(
                    code === 127 ? 'Sendmail command not found, process exited with code ' + code : 'Sendmail exited with code ' + code
                );
                err.code = errors.ESENDMAIL;

                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error sending message %s to sendmail. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });
            // the close listener is handed the exit code as its first argument, so a non-zero
            // code reaching it before the exit listener did counts as the error value
            sendmail.once('close', callback as (code: number | null) => void);

            sendmail.stdin.on('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error occurred when piping message %s to sendmail. %s',
                    messageId,
                    err.message
                );
                callback(err);
            });

            const recipients = ([] as string[]).concat(envelope.to || []);
            if (recipients.length > 3) {
                recipients.push('...and ' + recipients.splice(2).length + ' more');
            }
            this.logger.info(
                {
                    tnx: 'send',
                    messageId
                },
                'Sending message %s to <%s>',
                messageId,
                recipients.join(', ')
            );

            const sourceStream = mail.message!.createReadStream();
            let stream = sourceStream;
            if (this.options.newline) {
                // apply the transport-level line ending transform; the message-level
                // `newline` option is handled by MimeNode in createReadStream()
                stream = sourceStream.pipe(this.winbreak ? new LeWindows() : new LeUnix());
                sourceStream.once('error', err => stream.emit('error', err));
            }

            stream.once('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'stdin',
                        messageId
                    },
                    'Error occurred when generating message %s. %s',
                    messageId,
                    err.message
                );
                sendmail.kill('SIGINT'); // do not deliver the message
                callback(err);
            });

            stream.pipe(sendmail.stdin);
        } else {
            const err: NodemailerError = new Error('sendmail was not found');
            err.code = errors.ESENDMAIL;
            return callback(err);
        }
    }
}
