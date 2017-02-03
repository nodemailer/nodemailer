'use strict';

const shared = require('../shared');

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
        if (!!this.message || !this.data.list || typeof this.data.list !== 'object') {
            return;
        }
        // add optional List-* headers
        if (this.data.list && typeof this.data.list === 'object') {
            this.getListHeaders(this.data.list).forEach(listHeader => {
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
                    value: [].concat(value || []).map(value => {
                        if (typeof value === 'string') {
                            return this._formatListUrl(value);
                        }
                        if (value && value.url) {
                            return this._formatListUrl(value.url) + (value.comment ? ' (' + value.comment + ')' : '');
                        }
                        return '';
                    }).join(', ')
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
