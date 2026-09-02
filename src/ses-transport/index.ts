import EventEmitter from 'node:events';
import * as packageData from '../package-info.js';
import * as shared from '../shared/index.js';
import type { Logger } from '../shared/index.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';
import LeWindows from '../mime-node/le-windows.js';
import MimeNode, { type MimeNodeAddressInput, type MimeNodeEnvelope, type MimeNodeHeader } from '../mime-node/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, SendMailOptions, TransportOptions, VerifyCallback } from '../mailer/index.js';

/**
 * Options for the SES transport
 */
export interface SESTransportOptions extends TransportOptions {
    /** The AWS SDK v3 objects to send with, `{ sesClient, SendEmailCommand }` from @aws-sdk/client-sesv2 */
    SES: {
        /** SESv2Client instance. Its config.region provider is resolved for the domain of the returned Message-ID */
        sesClient: {
            config?: {
                region?: () => Promise<string>;
                [key: string]: any;
            };
            send(command: unknown): Promise<any>;
        };
        /** SendEmailCommand class, constructed with the SendEmailCommandInput of every message */
        SendEmailCommand: new (input: any) => unknown;
    };
}

/**
 * The value the SES transport hands to the send callback
 */
export interface SESSentMessageInfo {
    /** The envelope the message was sent with */
    envelope: MimeNodeEnvelope;
    /** Message-ID built from the MessageId SES returned */
    messageId: string;
    /** The MessageId SES returned */
    response: string;
    /** The raw RFC822 message that was sent */
    raw: Buffer;
}

/**
 * An error rejected by the AWS SDK, either version carries its own code property
 */
interface SESError extends NodemailerError {
    Code?: string;
}

/**
 * Tags AWS SDK rejections that carry no `code` property (SDK v3 errors only
 * have a `name`) with the generic SES transport error code, keeping the
 * original error object intact
 */
function tagSesError(err: NodemailerError): NodemailerError {
    if (err && typeof err === 'object' && !err.code) {
        err.code = errors.ESES;
    }
    return err;
}

/**
 * Generates a Transport object for AWS SES
 *
 * @constructor
 * @param optional config parameter
 */
class SESTransport extends EventEmitter {
    declare mailer: Mail<SESSentMessageInfo>;
    options: SESTransportOptions;
    ses: SESTransportOptions['SES'];
    name: string;
    version: string;
    logger: Logger;

    constructor(options?: SESTransportOptions) {
        super();
        options = options || ({} as SESTransportOptions);

        this.options = options;
        this.ses = this.options.SES;

        this.name = 'SESTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'ses-transport'
        });
    }

    getRegion(cb: (err: Error | null, region?: string | false) => void): void {
        if (this.ses.sesClient.config && typeof this.ses.sesClient.config.region === 'function') {
            // Resolve the region provider. Use the two-argument form of then() so that a
            // synchronous throw from cb is not recaught here and used to invoke cb a second time.
            this.ses.sesClient.config.region().then(
                region => cb(null, region),
                err => cb(err)
            );
            return;
        }
        return cb(null, false);
    }

    /**
     * Compiles a mailcomposer message and forwards it to SES
     *
     * @param mail MailComposer object
     * @param callback Callback function to run when the sending is completed
     */
    send(mail: MailMessage<SESSentMessageInfo>, callback: (err: Error | null, info?: SESSentMessageInfo) => void): void {
        // send() runs after the message was compiled, so mail.message is set
        let fromHeader: MimeNodeHeader | string | undefined = mail.message!._headers.find(header => /^from$/i.test(header.key));
        if (fromHeader) {
            const mimeNode = new MimeNode('text/plain');
            fromHeader = mimeNode._convertAddresses(mimeNode._parseAddresses(fromHeader.value as MimeNodeAddressInput));
        }

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
            'Sending message %s to <%s>',
            messageId,
            recipients.join(', ')
        );

        const getRawMessage = (next: (err: Error | null, raw?: Buffer) => void): void => {
            // do not use Message-ID and Date in DKIM signature
            if (!mail.data._dkim) {
                mail.data._dkim = {};
            }
            if (mail.data._dkim.skipFields && typeof mail.data._dkim.skipFields === 'string') {
                mail.data._dkim.skipFields += ':date:message-id';
            } else {
                mail.data._dkim.skipFields = 'date:message-id';
            }

            const sourceStream = mail.message!.createReadStream();
            const stream = sourceStream.pipe(new LeWindows());
            const chunks: Buffer[] = [];
            let chunklen = 0;

            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            sourceStream.once('error', err => stream.emit('error', err));

            stream.once('error', err => next(err));

            stream.once('end', () => next(null, Buffer.concat(chunks, chunklen)));
        };

        setImmediate(() =>
            getRawMessage((err, raw) => {
                if (err) {
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
                    return callback(err);
                }

                // mail.data.ses is caller supplied message data, so copy its own keys only
                const sesMessage = shared.copyOwnKeys(
                    {
                        Content: {
                            Raw: {
                                // required
                                Data: raw // required
                            }
                        },
                        FromEmailAddress: fromHeader || envelope.from,
                        Destination: {
                            ToAddresses: envelope.to
                        }
                    },
                    mail.data.ses
                );

                this.getRegion((err, region) => {
                    if (err || !region) {
                        region = 'us-east-1';
                    }

                    let sendPromise: Promise<any>;
                    try {
                        // command construction or dispatch can throw synchronously on a
                        // misconfigured SDK; surface it as a single error callback instead
                        // of letting it escape into getRegion's promise chain
                        const command = new this.ses.SendEmailCommand(sesMessage);
                        sendPromise = this.ses.sesClient.send(command);
                    } catch (err: any) {
                        tagSesError(err);
                        this.logger.error(
                            {
                                err,
                                tnx: 'send'
                            },
                            'Send error for %s: %s',
                            messageId,
                            err.message
                        );
                        setImmediate(() => callback(err));
                        return;
                    }

                    sendPromise
                        .then(data => {
                            if (region === 'us-east-1') {
                                region = 'email';
                            }

                            const info: SESSentMessageInfo = {
                                envelope: {
                                    from: envelope.from,
                                    to: envelope.to
                                },
                                messageId: '<' + data.MessageId + (!/@/.test(data.MessageId) ? '@' + region + '.amazonses.com' : '') + '>',
                                response: data.MessageId,
                                raw: raw as Buffer
                            };

                            // invoke the callback outside the promise chain so a throw from it
                            // is not recaught by .catch() and used to call it a second time
                            setImmediate(() => callback(null, info));
                        })
                        .catch(err => {
                            tagSesError(err);
                            this.logger.error(
                                {
                                    err,
                                    tnx: 'send'
                                },
                                'Send error for %s: %s',
                                messageId,
                                err.message
                            );
                            setImmediate(() => callback(err));
                        });
                });
            })
        );
    }

    /**
     * Verifies SES configuration
     *
     * @param callback Callback function
     */
    verify(): Promise<true>;
    verify(callback: VerifyCallback): void;
    verify(callback?: VerifyCallback): Promise<true> | void {
        let promise: Promise<true> | undefined;
        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }
        const done = callback as VerifyCallback;

        const cb = (err?: SESError | null): void => {
            if (err && !['InvalidParameterValue', 'MessageRejected'].includes(err.code || err.Code || err.name)) {
                return done(tagSesError(err));
            }
            return done(null, true);
        };

        const sesMessage = {
            Content: {
                Raw: {
                    Data: Buffer.from('From: <invalid@invalid>\r\nTo: <invalid@invalid>\r\n Subject: Invalid\r\n\r\nInvalid')
                }
            },
            FromEmailAddress: 'invalid@invalid',
            Destination: {
                ToAddresses: ['invalid@invalid']
            }
        };

        // the region value is not used for anything when verifying, but the lookup
        // exercises the client configuration the same way as send() does
        this.getRegion(() => {
            let sendPromise: Promise<any>;
            try {
                const command = new this.ses.SendEmailCommand(sesMessage);
                sendPromise = this.ses.sesClient.send(command);
            } catch (err: any) {
                setImmediate(() => cb(err));
                return;
            }

            sendPromise.then(() => setImmediate(() => cb(null))).catch(err => setImmediate(() => cb(err)));
        });

        return promise;
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `SESTransport.Options` style references keep working
 */
declare namespace SESTransport {
    export type Options = SESTransportOptions;
    export type MailOptions = SendMailOptions;
    export type SentMessageInfo = SESSentMessageInfo;
}

export default SESTransport;
