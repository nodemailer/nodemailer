'use strict';

const packageData = require('../../package.json');
const shared = require('../shared');
const LeWindows = require('../sendmail-transport/le-windows');
const LeUnix = require('../sendmail-transport/le-unix');

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
 * @param {Object} optional config parameter for the AWS Sendmail service
 */
class SendmailTransport {
    constructor(options) {
        options = options || {};

        this.options = options || {};

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });

        this.winbreak = ['win', 'windows', 'dos', '\r\n'].includes((options.newline || '').toString().toLowerCase());
    }

    /**
     * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, done) {
        // Sendmail strips this header line by itself
        mail.message.keepBcc = true;

        let envelope = mail.data.envelope || mail.message.getEnvelope();
        let messageId = mail.message.messageId();

        let recipients = [].concat(envelope.to || []);
        if (recipients.length > 3) {
            recipients.push('...and ' + recipients.splice(2).length + ' more');
        }
        this.logger.info({
            tnx: 'send',
            messageId
        }, 'Sending message %s to <%s> using %s line breaks', messageId, recipients.join(', '), this.winbreak ? '<CR><LF>' : '<LF>');

        setImmediate(() => {

            let stream;
            let transform;

            try {
                transform = this.winbreak ? new LeWindows() : new LeUnix();
                stream = mail.message.createReadStream().pipe(transform);
            } catch (E) {
                this.logger.error({
                    err: E,
                    tnx: 'send',
                    messageId
                }, 'Creating send stream failed for %s. %s', messageId, E.message);
                return done(E);
            }

            if (!this.options.buffer) {
                return done(null, {
                    envelope: mail.data.envelope || mail.message.getEnvelope(),
                    messageId,
                    message: stream
                });
            }

            let chunks = [];
            let chunklen = 0;
            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });
            stream.on('end', () => done(null, {
                envelope: mail.data.envelope || mail.message.getEnvelope(),
                messageId,
                message: Buffer.concat(chunks, chunklen)
            }));
        });
    }
}

module.exports = SendmailTransport;
