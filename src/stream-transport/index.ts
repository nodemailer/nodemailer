import type { Readable } from 'node:stream';
import * as packageData from '../package-info.js';
import * as shared from '../shared/index.js';
import type { Logger } from '../shared/index.js';
import LeWindows from '../mime-node/le-windows.js';
import LeUnix from '../mime-node/le-unix.js';
import type { MimeNodeEnvelope } from '../mime-node/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, SentMessageInfo, SendMailOptions, TransportOptions } from '../mailer/index.js';

/**
 * Options for the Stream transport
 */
export interface StreamTransportOptions extends TransportOptions {
    /** Selects this transport in createTransport */
    streamTransport?: boolean;
    /** If true, the message is returned as a Buffer object instead of a stream */
    buffer?: boolean;
    /** Either 'windows' or 'unix', the line ending of the generated message */
    newline?: string;
}

/**
 * The value the Stream transport hands to the send callback
 */
export interface StreamSentMessageInfo extends SentMessageInfo {
    /** The envelope the message was generated with */
    envelope: MimeNodeEnvelope;
    /** Message-ID value of the message */
    messageId: string;
    /** The generated message, a Buffer when the buffer option is set, a readable stream otherwise */
    message: Readable | Buffer;
}

/**
 * Generates a Transport object for streaming
 *
 * Possible options can be the following:
 *
 *  * **buffer** if true, then returns the message as a Buffer object instead of a stream
 *  * **newline** either 'windows' or 'unix'
 *
 * @constructor
 * @param optional config parameter
 */
class StreamTransport {
    declare mailer: Mail<StreamSentMessageInfo>;
    options: StreamTransportOptions;
    name: string;
    version: string;
    logger: Logger;
    winbreak: boolean;

    constructor(options?: StreamTransportOptions) {
        options = options || {};

        this.options = options;

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });

        this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
    }

    /**
     * Compiles a mailcomposer message and forwards it to handler that sends it
     *
     * @param mail MailComposer object
     * @param done Callback function to run when the sending is completed
     */
    send(mail: MailMessage<StreamSentMessageInfo>, done: (err: Error | null, info?: StreamSentMessageInfo) => void): void {
        // We probably need this in the output. send() runs after the message was compiled,
        // so mail.message is set
        mail.message!.keepBcc = true;

        const envelope = mail.message!.getEnvelope();
        const messageId = mail.message!.messageId();

        const recipients = ([] as string[]).concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info(
            {
                tnx: 'send',
                messageId
            },
            'Sending message %s to <%s> using %s line breaks',
            messageId,
            recipients.join(', '),
            this.winbreak ? '<CR><LF>' : '<LF>'
        );

        setImmediate(() => {
            let stream: Readable;

            try {
                stream = mail.message!.createReadStream();
                if (this.options.newline) {
                    // apply the transport-level line ending transform; the message-level
                    // `newline` option is handled by MimeNode in createReadStream()
                    const sourceStream = stream;
                    stream = sourceStream.pipe(this.winbreak ? new LeWindows() : new LeUnix());
                    sourceStream.once('error', err => stream.emit('error', err));
                }
            } catch (E: any) {
                this.logger.error(
                    {
                        err: E,
                        tnx: 'send',
                        messageId
                    },
                    'Creating send stream failed for %s. %s',
                    messageId,
                    E.message
                );
                return done(E);
            }

            if (!this.options.buffer) {
                stream.once('error', err => {
                    this.logger.error(
                        {
                            err,
                            tnx: 'send',
                            messageId
                        },
                        'Failed creating message for %s. %s',
                        messageId,
                        err.message
                    );
                });
                return done(null, {
                    envelope,
                    messageId,
                    message: stream
                });
            }

            const chunks: Buffer[] = [];
            let chunklen = 0;
            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            stream.once('error', err => {
                this.logger.error(
                    {
                        err,
                        tnx: 'send',
                        messageId
                    },
                    'Failed creating message for %s. %s',
                    messageId,
                    err.message
                );
                return done(err);
            });

            stream.on('end', () =>
                done(null, {
                    envelope,
                    messageId,
                    message: Buffer.concat(chunks, chunklen)
                })
            );
        });
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `StreamTransport.Options` style references keep working
 */
declare namespace StreamTransport {
    export type Options = StreamTransportOptions;
    export type MailOptions = SendMailOptions;
    export type SentMessageInfo = StreamSentMessageInfo;
}

export default StreamTransport;
