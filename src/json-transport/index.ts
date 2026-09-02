import * as packageData from '../package-info.js';
import * as shared from '../shared/index.js';
import type { Logger } from '../shared/index.js';
import type { MimeNodeEnvelope } from '../mime-node/index.js';
import type { default as MailMessage, MailMessageData } from '../mailer/mail-message.js';
import type { default as Mail, SendMailOptions, TransportOptions } from '../mailer/index.js';

/**
 * Options for the JSON transport
 */
export interface JSONTransportOptions extends TransportOptions {
    /** Selects this transport in createTransport */
    jsonTransport?: boolean;
    /** If true, the message is returned as an object instead of a JSON string */
    skipEncoding?: boolean;
}

/**
 * The value the JSON transport hands to the send callback
 */
export interface JSONSentMessageInfo {
    /** The envelope the message was generated with */
    envelope: MimeNodeEnvelope;
    /** Message-ID value of the message */
    messageId: string;
    /** The normalized message as a JSON string, or as the object itself when skipEncoding is set */
    message: string | MailMessageData;
}

/**
 * Generates a Transport object to generate JSON output
 *
 * @constructor
 * @param optional config parameter
 */
class JSONTransport {
    declare mailer: Mail<JSONSentMessageInfo>;
    options: JSONTransportOptions;
    name: string;
    version: string;
    logger: Logger;

    constructor(options?: JSONTransportOptions) {
        options = options || {};

        this.options = options;

        this.name = 'JSONTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'json-transport'
        });
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param mail MailComposer object
     * @param done Callback function to run when the sending is completed
     */
    send(mail: MailMessage<JSONSentMessageInfo>, done: (err: Error | null, info?: JSONSentMessageInfo) => void): void {
        // Sendmail strips this header line by itself. send() runs after the message was
        // compiled, so mail.message is set
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
            'Composing JSON structure of %s to <%s>',
            messageId,
            recipients.join(', ')
        );

        setImmediate(() => {
            mail.normalize((err, data) => {
                if (err) {
                    this.logger.error(
                        {
                            err,
                            tnx: 'send',
                            messageId
                        },
                        'Failed building JSON structure for %s. %s',
                        messageId,
                        err.message
                    );
                    return done(err);
                }

                delete data.envelope;
                delete data.normalizedHeaders;

                return done(null, {
                    envelope,
                    messageId,
                    message: this.options.skipEncoding ? data : JSON.stringify(data)
                });
            });
        });
    }
}

/**
 * Type aliases in the layout of @types/nodemailer, so `JSONTransport.Options` style references keep working
 */
declare namespace JSONTransport {
    export type Options = JSONTransportOptions;
    export type MailOptions = SendMailOptions;
    export type SentMessageInfo = JSONSentMessageInfo;
}

export default JSONTransport;
