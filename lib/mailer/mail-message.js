'use strict';

const shared = require('../shared');
const MimeNode = require('../mime-node');

class MailMessage {
    constructor(mailer, data) {
        this.mailer = mailer;
        this.data = {};
        this.message = null;

        data = data || {};
        let options = mailer.options || {};
        let defaults = mailer._defaults || {};

        Object.keys(data).forEach(key => {
            this.data[key] = data[key];
        });

        this.data.headers = this.data.headers || {};

        // apply defaults
        Object.keys(defaults).forEach(key => {
            if (!(key in this.data)) {
                this.data[key] = defaults[key];
            } else if (key === 'headers') {
                // headers is a special case. Allow setting individual default headers
                Object.keys(defaults.headers).forEach(key => {
                    if (!(key in this.data.headers)) {
                        this.data.headers[key] = defaults.headers[key];
                    }
                });
            }
        });

        // force specific keys from transporter options
        ['disableFileAccess', 'disableUrlAccess'].forEach(key => {
            if (key in options) {
                this.data[key] = options[key];
            }
        });
    }

    resolveContent(...args) {
        return shared.resolveContent(...args);
    }

    resolveAll(callback) {
        let keys = [[this.data, 'html'], [this.data, 'text'], [this.data, 'watchHtml'], [this.data, 'icalEvent']];

        if (this.data.alternatives && this.data.alternatives.length) {
            this.data.alternatives.forEach((alternative, i) => {
                keys.push([this.data.alternatives, i]);
            });
        }

        if (this.data.attachments && this.data.attachments.length) {
            this.data.attachments.forEach((alternative, i) => {
                keys.push([this.data.attachments, i]);
            });
        }

        let mimeNode = new MimeNode();

        let addressKeys = ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo'];

        addressKeys.forEach(address => {
            let value;
            if (this.message) {
                value = [].concat(mimeNode._parseAddresses(this.message.getHeader(address === 'replyTo' ? 'reply-to' : address)) || []);
            } else if (this.data[address]) {
                value = [].concat(mimeNode._parseAddresses(this.data[address]) || []);
            }
            if (value && value.length) {
                this.data[address] = value;
            } else if (address in this.data) {
                this.data[address] = null;
            }
        });

        let singleKeys = ['from', 'sender', 'replyTo'];
        singleKeys.forEach(address => {
            if (this.data[address]) {
                this.data[address] = this.data[address].shift();
            }
        });

        let pos = 0;
        let resolveNext = () => {
            if (pos >= keys.length) {
                return callback(null, this.data);
            }
            let args = keys[pos++];
            if (!args[0] || !args[0][args[1]]) {
                return resolveNext();
            }
            shared.resolveContent(...args, (err, value) => {
                if (err) {
                    return callback(err);
                }

                let node = {
                    content: value
                };
                if (args[0][args[1]] && typeof args[0][args[1]] === 'object' && !Buffer.isBuffer(args[0][args[1]])) {
                    Object.keys(args[0][args[1]]).forEach(key => {
                        if (!(key in node) && !['content', 'path', 'href', 'raw'].includes(key)) {
                            node[key] = args[0][args[1]][key];
                        }
                    });
                }

                args[0][args[1]] = node;
                resolveNext();
            });
        };

        setImmediate(() => resolveNext());
    }

    setMailerHeader() {
        if (!this.message || !this.data.xMailer) {
            return;
        }
        this.message.setHeader('X-Mailer', this.data.xMailer);
    }

    setPriorityHeaders() {
        if (!this.message || !this.data.priority) {
            return;
        }
        switch ((this.data.priority || '').toString().toLowerCase()) {
            case 'high':
                this.message.setHeader('X-Priority', '1 (Highest)');
                this.message.setHeader('X-MSMail-Priority', 'High');
                this.message.setHeader('Importance', 'High');
                break;
            case 'low':
                this.message.setHeader('X-Priority', '5 (Lowest)');
                this.message.setHeader('X-MSMail-Priority', 'Low');
                this.message.setHeader('Importance', 'Low');
                break;
            default:
            // do not add anything, since all messages are 'Normal' by default
        }
    }

    setListHeaders() {
        if (!this.message || !this.data.list || typeof this.data.list !== 'object') {
            return;
        }
        // add optional List-* headers
        if (this.data.list && typeof this.data.list === 'object') {
            this._getListHeaders(this.data.list).forEach(listHeader => {
                listHeader.value.forEach(value => {
                    this.message.addHeader(listHeader.key, value);
                });
            });
        }
    }

    _getListHeaders(listData) {
        // make sure an url looks like <protocol:url>
        return Object.keys(listData).map(key => ({
            key: 'list-' + key.toLowerCase().trim(),
            value: [].concat(listData[key] || []).map(value => {
                if (typeof value === 'string') {
                    return this._formatListUrl(value);
                }
                return {
                    prepared: true,
                    value: []
                        .concat(value || [])
                        .map(value => {
                            if (typeof value === 'string') {
                                return this._formatListUrl(value);
                            }
                            if (value && value.url) {
                                return this._formatListUrl(value.url) + (value.comment ? ' (' + value.comment + ')' : '');
                            }
                            return '';
                        })
                        .join(', ')
                };
            })
        }));
    }

    _formatListUrl(url) {
        url = url.replace(/[\s<]+|[\s>]+/g, '');
        if (/^(https?|mailto|ftp):/.test(url)) {
            return '<' + url + '>';
        }
        if (/^[^@]+@[^@]+$/.test(url)) {
            return '<mailto:' + url + '>';
        }

        return '<http://' + url + '>';
    }
}

module.exports = MailMessage;
