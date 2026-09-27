import * as packageData from '../package-info.js';
import * as shared from '../shared/index.js';
import type { Logger } from '../shared/index.js';
import type { MimeNodeEnvelope } from '../mime-node/index.js';
import type MailMessage from '../mailer/mail-message.js';
import type { default as Mail, SentMessageInfo, SendMailOptions, TransportOptions } from '../mailer/index.js';

/**
 * Options for the JSON transport
 */
export interface JSONTransportOptions extends TransportOptions {
    /** Selects this transport in createTransport */
    jsonTransport?: boolean | undefined;
    /** If true, the message is returned as an object instead of a JSON string */
    skipEncoding?: boolean | undefined;
}

/**
 * The value the JSON transport hands to the send callback. M is the type of the message
 * field: a JSON string by default, the message object itself when skipEncoding is set
 */
export interface JSONSentMessageInfo<M = string> extends SentMessageInfo {
    /** The envelope the message was generated with */
    envelope: MimeNodeEnvelope;
    /** Message-ID value of the message */
    messageId: string;
    /** The normalized message as a JSON string, or as the object itself when skipEncoding is set */
    message: M;
}

/**
 * The value the JSON transport hands to the send callback when skipEncoding is set: the
 * message field holds the message object. Typed loosely so that a transporter created with
 * skipEncoding still fits a variable declared with the plain result type
 */
export type JSONSentMessageObjectInfo = JSONSentMessageInfo<any>;

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
        mail.message.keepBcc = true;

        const envelope = mail.message.getEnvelope();
        const messageId = mail.message.messageId();

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

                // the message field is the object itself with skipEncoding, the
                // createTransport overload for that option types the result accordingly
                return done(null, {
                    envelope,
                    messageId,
                    message: this.options.skipEncoding ? data : JSON.stringify(data)
                } as JSONSentMessageInfo);
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
    export type SentMessageObjectInfo = JSONSentMessageObjectInfo;
}

/** The same aliases as module level exports, for `import * as JSONTransport` and `import JSONTransport = require()` */
export type {
    JSONTransportOptions as Options,
    SendMailOptions as MailOptions,
    JSONSentMessageInfo as SentMessageInfo,
    JSONSentMessageObjectInfo as SentMessageObjectInfo
};

export default JSONTransport;
