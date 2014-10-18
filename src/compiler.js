'use strict';

var BuildMail = require('buildmail');
var libmime = require('libmime');

module.exports = Compiler;

/**
 * Creates the object for composing a BuildMail instance out from the mail options
 *
 * @constructor
 * @param {Object} mail Mail options
 */
function Compiler(mail) {
    this.mail = mail || {};
    this.message = false;
}

/**
 * Builds BuildMail instance
 */
Compiler.prototype.compile = function() {
    this._alternatives = this._getAlternatives();
    this._htmlNode = this._alternatives.filter(function(alternative) {
        return /^text\/html\b/i.test(alternative.contentType);
    }).pop();
    this._attachments = this._getAttachments(!!this._htmlNode);

    this._useRelated = !!(this._htmlNode && this._attachments.related.length);
    this._useAlternative = this._alternatives.length > 1;
    this._useMixed = this._attachments.attached.length > 1 || (this._alternatives.length && this._attachments.attached.length === 1);

    // Compose MIME tree
    if (this._useMixed) {
        this.message = this._createMixed();
    } else if (this._useAlternative) {
        this.message = this._createAlternative();
    } else if (this._useRelated) {
        this.message = this._createRelated();
    } else {
        this.message = this._createContentNode(false, [].concat(this._alternatives || []).concat(this._attachments.attached || []).shift() || {
            contentType: 'text/plain',
            content: ''
        });
    }

    // Add headers to the root node
    [
        'from',
        'sender',
        'to',
        'cc',
        'bcc',
        'reply-to',
        'in-reply-to',
        'references',
        'subject',
        'message-id',
        'date'
    ].forEach(function(header) {
        var key = header.replace(/-(\w)/g, function(o, c) {
            return c.toUpperCase();
        });
        if (this.mail[key]) {
            this.message.setHeader(header, this.mail[key]);
        }
    }.bind(this));

    // Add custom headers
    if (this.mail.headers) {
        this.message.addHeader(this.mail.headers);
    }

    // Sets custom envelope
    if (this.mail.envelope) {
        this.message.setEnvelope(this.mail.envelope);
    }

    return this.message;
};

/**
 * Builds multipart/mixed node. It should always contain different type of elements on the same level
 * eg. text + attachments
 *
 * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
 * @returns {Object} BuildMail node element
 */
Compiler.prototype._createMixed = function(parentNode) {
    var node;

    if (!parentNode) {
        node = new BuildMail('multipart/mixed');
    } else {
        node = parentNode.createChild('multipart/mixed');
    }

    if (this._useAlternative) {
        this._createAlternative(node);
    } else if (this._useRelated) {
        this._createRelated(node);
    }

    [].concat(!this._useAlternative && this._alternatives || []).concat(this._attachments.attached || []).forEach(function(element) {
        // if the element is a html node from related subpart then ignore it
        if (!this._useRelated || element !== this._htmlNode) {
            this._createContentNode(node, element);
        }
    }.bind(this));

    return node;
};

/**
 * Builds multipart/alternative node. It should always contain same type of elements on the same level
 * eg. text + html view of the same data
 *
 * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
 * @returns {Object} BuildMail node element
 */
Compiler.prototype._createAlternative = function(parentNode) {
    var node;

    if (!parentNode) {
        node = new BuildMail('multipart/alternative');
    } else {
        node = parentNode.createChild('multipart/alternative');
    }

    this._alternatives.forEach(function(alternative) {
        if (this._useRelated && this._htmlNode === alternative) {
            this._createRelated(node);
        } else {
            this._createContentNode(node, alternative);
        }
    }.bind(this));

    return node;
};

/**
 * Builds multipart/related node. It should always contain html node with related attachments
 *
 * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
 * @returns {Object} BuildMail node element
 */
Compiler.prototype._createRelated = function(parentNode) {
    var node;

    if (!parentNode) {
        node = new BuildMail('multipart/related; type="text/html"');
    } else {
        node = parentNode.createChild('multipart/related; type="text/html"');
    }

    this._createContentNode(node, this._htmlNode);

    this._attachments.related.forEach(function(alternative) {
        this._createContentNode(node, alternative);
    }.bind(this));

    return node;
};

/**
 * Creates a regular node with contents
 *
 * @param {Object} parentNode Parent for this note. If it does not exist, a root node is created
 * @param {Object} element Node data
 * @returns {Object} BuildMail node element
 */
Compiler.prototype._createContentNode = function(parentNode, element) {
    element = element || {};
    element.content = element.content || '';

    var node;
    var encoding = (element.encoding || 'utf8')
        .toString()
        .toLowerCase()
        .replace(/[-_\s]/g, '');

    if (!parentNode) {
        node = new BuildMail(element.contentType, {
            filename: element.filename
        });
    } else {
        node = parentNode.createChild(element.contentType, {
            filename: element.filename
        });
    }

    if (element.cid) {
        node.setHeader('Content-Id', '<' + element.cid.replace(/[<>]/g, '') + '>');
    }

    if (this.mail.encoding && /^text\//i.test(element.contentType)) {
        node.setHeader('Content-Transfer-Encoding', this.mail.encoding);
    }

    if (!/^text\//i.test(element.contentType) || element.contentDisposition) {
        node.setHeader('Content-Disposition', element.contentDisposition || 'attachment');
    }

    if (typeof element.content === 'string' && ['utf8', 'usascii', 'ascii'].indexOf(encoding) < 0) {
        element.content = new Buffer(element.content, encoding);
    }

    node.setContent(element.content);

    return node;
};

/**
 * List all attachments. Resulting attachment objects can be used as input for BuildMail nodes
 *
 * @param {Boolean} findRelated If true separate related attachments from attached ones
 * @returns {Object} An object of arrays (`related` and `attached`)
 */
Compiler.prototype._getAttachments = function(findRelated) {
    var attachments = [].concat(this.mail.attachments || []).map(function(attachment, i) {
        var data;

        if (/^data:/i.test(attachment.path || attachment.href)) {
            attachment = this._processDataUrl(attachment);
        }

        data = {
            contentType: attachment.contentType ||
                libmime.detectMimeType(attachment.filename || attachment.path || attachment.href || 'bin'),
            contentDisposition: attachment.contentDisposition || 'attachment'
        };

        if (attachment.filename) {
            data.filename = attachment.filename;
        } else {
            data.filename = (attachment.path || attachment.href || '').split('/').pop() || 'attachment-' + (i + 1);
            if (data.filename.indexOf('.') < 0) {
                data.filename += '.' + libmime.detectExtension(data.contentType);
            }
        }

        if (/^https?:\/\//i.test(attachment.path)) {
            attachment.href = attachment.path;
            attachment.path = undefined;
        }

        if (attachment.cid) {
            data.cid = attachment.cid;
        }

        if (attachment.path) {
            data.content = {
                path: attachment.path
            };
        } else if (attachment.href) {
            data.content = {
                href: attachment.href
            };
        } else {
            data.content = attachment.content || '';
        }

        if (attachment.encoding) {
            data.encoding = attachment.encoding;
        }

        return data;
    }.bind(this));

    if (!findRelated) {
        return {
            attached: attachments,
            related: []
        };
    } else {
        return {
            attached: attachments.filter(function(attachment) {
                return !attachment.cid;
            }),
            related: attachments.filter(function(attachment) {
                return !!attachment.cid;
            })
        };
    }
};

/**
 * List alternatives. Resulting objects can be used as input for BuildMail nodes
 *
 * @returns {Array} An array of alternative elements. Includes the `text` and `html` values as well
 */
Compiler.prototype._getAlternatives = function() {
    var alternatives = [],
        text, html;

    if (this.mail.text) {
        if (typeof this.mail.text === 'object' && this.mail.text.content || this.mail.text.path || this.mail.text.href) {
            text = this.mail.text;
        } else {
            text = {
                content: this.mail.text
            };
        }
        text.contentType = 'text/plain' + (!text.encoding && libmime.isPlainText(text.content) ? '' : '; charset=utf-8');
    }

    if (this.mail.html) {
        if (typeof this.mail.html === 'object' && this.mail.html.content || this.mail.html.path || this.mail.html.href) {
            html = this.mail.html;
        } else {
            html = {
                content: this.mail.html
            };
        }
        html.contentType = 'text/html' + (!html.encoding && libmime.isPlainText(html.content) ? '' : '; charset=utf-8');
    }

    [].concat(text || []).concat(html || []).concat(this.mail.alternatives || []).forEach(function(alternative) {
        var data;

        if (/^data:/i.test(alternative.path || alternative.href)) {
            alternative = this._processDataUrl(alternative);
        }

        data = {
            contentType: alternative.contentType ||
                libmime.detectMimeType(alternative.filename || alternative.path || alternative.href || 'txt')
        };

        if (alternative.filename) {
            data.filename = alternative.filename;
        }

        if (/^https?:\/\//i.test(alternative.path)) {
            alternative.href = alternative.path;
            alternative.path = undefined;
        }

        if (alternative.path) {
            data.content = {
                path: alternative.path
            };
        } else if (alternative.href) {
            data.content = {
                href: alternative.href
            };
        } else {
            data.content = alternative.content || '';
        }

        if (alternative.encoding) {
            data.encoding = alternative.encoding;
        }

        alternatives.push(data);
    }.bind(this));

    return alternatives;
};

/**
 * Parses data uri and converts it to a Buffer
 *
 * @param {Object} element Content element
 * @return {Object} Parsed element
 */
Compiler.prototype._processDataUrl = function(element) {
    var parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
    if (!parts) {
        return element;
    }

    element.content = /\bbase64$/i.test(parts[1]) ? new Buffer(parts[2], 'base64') : new Buffer(decodeURIComponent(parts[2]));

    if ('path' in element) {
        element.path = false;
    }

    if ('href' in element) {
        element.href = false;
    }

    parts[1].split(';').forEach(function(item) {
        if (/^\w+\/[^\/]+$/i.test(item)) {
            element.contentType = element.contentType || item.toLowerCase();
        }
    });

    return element;
};