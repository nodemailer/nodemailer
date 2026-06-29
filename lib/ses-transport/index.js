'use strict';

const EventEmitter = require('events');
const packageData = require('../../package.json');
const shared = require('../shared');
const errors = require('../errors');
const LeWindows = require('../mime-node/le-windows');
const MimeNode = require('../mime-node');

/**
 * Tags AWS SDK rejections that carry no `code` property (SDK v3 errors only
 * have a `name`) with the generic SES transport error code, keeping the
 * original error object intact
 */
function tagSesError(err) {
    if (err && typeof err === 'object' && !err.code) {
        err.code = errors.ESES;
    }
    return err;
}

/**
 * Generates a Transport object for AWS SES
 *
 * @constructor
 * @param {Object} optional config parameter
 */
class SESTransport extends EventEmitter {
    constructor(options) {
        super();
        options = options || {};

        this.options = options;
        this.ses = this.options.SES;

        this.name = 'SESTransport';
        this.version = packageData.version;

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'ses-transport'
        });
    }

    getRegion(cb) {
        if (this.ses.sesClient.config && typeof this.ses.sesClient.config.region === 'function') {
            // Resolve the region provider. Use the two-argument form of then() so that a
            // synchronous throw from cb is not recaught here and used to invoke cb a second time.
            return this.ses.sesClient.config.region().then(
                region => cb(null, region),
                err => cb(err)
            );
        }
        return cb(null, false);
    }

    /**
     * Compiles a mailcomposer message and forwards it to SES
     *
     * @param {Object} emailMessage MailComposer object
     * @param {Function} callback Callback function to run when the sending is completed
     */
    send(mail, callback) {
        let fromHeader = mail.message._headers.find(header => /^from$/i.test(header.key));
        if (fromHeader) {
            const mimeNode = new MimeNode('text/plain');
            fromHeader = mimeNode._convertAddresses(mimeNode._parseAddresses(fromHeader.value));
        }

        const envelope = mail.data.envelope || mail.message.getEnvelope();
        const messageId = mail.message.messageId();

        const recipients = [].concat(envelope.to || []);
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

        const getRawMessage = next => {
            // do not use Message-ID and Date in DKIM signature
            if (!mail.data._dkim) {
                mail.data._dkim = {};
            }
            if (mail.data._dkim.skipFields && typeof mail.data._dkim.skipFields === 'string') {
                mail.data._dkim.skipFields += ':date:message-id';
            } else {
                mail.data._dkim.skipFields = 'date:message-id';
            }

            const sourceStream = mail.message.createReadStream();
            const stream = sourceStream.pipe(new LeWindows());
            const chunks = [];
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

                const sesMessage = Object.assign(
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
                    mail.data.ses || {}
                );

                this.getRegion((err, region) => {
                    if (err || !region) {
                        region = 'us-east-1';
                    }

                    let sendPromise;
                    try {
                        // command construction or dispatch can throw synchronously on a
                        // misconfigured SDK; surface it as a single error callback instead
                        // of letting it escape into getRegion's promise chain
                        const command = new this.ses.SendEmailCommand(sesMessage);
                        sendPromise = this.ses.sesClient.send(command);
                    } catch (err) {
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

                            const info = {
                                envelope: {
                                    from: envelope.from,
                                    to: envelope.to
                                },
                                messageId: '<' + data.MessageId + (!/@/.test(data.MessageId) ? '@' + region + '.amazonses.com' : '') + '>',
                                response: data.MessageId,
                                raw
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
     * @param {Function} callback Callback function
     */
    verify(callback) {
        let promise;
        if (!callback) {
            promise = new Promise((resolve, reject) => {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        const cb = err => {
            if (err && !['InvalidParameterValue', 'MessageRejected'].includes(err.code || err.Code || err.name)) {
                return callback(tagSesError(err));
            }
            return callback(null, true);
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
            let sendPromise;
            try {
                const command = new this.ses.SendEmailCommand(sesMessage);
                sendPromise = this.ses.sesClient.send(command);
            } catch (err) {
                setImmediate(() => cb(err));
                return;
            }

            sendPromise.then(() => setImmediate(() => cb(null))).catch(err => setImmediate(() => cb(err)));
        });

        return promise;
    }
}

module.exports = SESTransport;
