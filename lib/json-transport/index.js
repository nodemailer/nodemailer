'use strict';

const packageData = require('../../package.json');
const shared = require('../shared');

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
class JSONTransport {
    constructor(options) {
        options = options || {};

        this.options = options || {};

        this.name = 'StreamTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'stream-transport'
        });
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
        }, 'Composing JSON structure of %s to <%s>', messageId, recipients.join(', '));

        setImmediate(() => {
            mail.resolveAll((err, data) => {
                if (err) {
                    this.logger.error({
                        err,
                        tnx: 'send',
                        messageId
                    }, 'Failed building JSON structure for %s. %s', messageId, err.message);
                    return done(err);
                }

                data.messageId = messageId;

                ['html', 'text', 'watchHtml'].forEach(key => {
                    if (data[key] && data[key].content) {
                        if (typeof data[key].content === 'string') {
                            data[key] = data[key].content;
                        } else if (Buffer.isBuffer(data[key].content)) {
                            data[key] = data[key].content.toString();
                        }
                    }
                });

                if (data.icalEvent && Buffer.isBuffer(data.icalEvent.content)) {
                    data.icalEvent.content = data.icalEvent.content.toString('base64');
                    data.icalEvent.encoding = 'base64';
                }

                if (data.alternatives && data.alternatives.length) {
                    data.alternatives.forEach(alternative => {
                        if (alternative && alternative.content && Buffer.isBuffer(alternative.content)) {
                            alternative.content = alternative.content.toString('base64');
                            alternative.encoding = 'base64';
                        }
                    });
                }

                if (data.attachments && data.attachments.length) {
                    data.attachments.forEach(attachment => {
                        if (attachment && attachment.content && Buffer.isBuffer(attachment.content)) {
                            attachment.content = attachment.content.toString('base64');
                            attachment.encoding = 'base64';
                        }
                    });
                }

                return done(null, {
                    envelope: mail.data.envelope || mail.message.getEnvelope(),
                    messageId,
                    message: JSON.stringify(data)
                });
            });
        });
    }
}

module.exports = JSONTransport;
