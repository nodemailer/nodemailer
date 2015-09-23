'use strict';

var mailcomposer = require('mailcomposer');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var directTransport = require('nodemailer-direct-transport');
var smtpTransport = require('nodemailer-smtp-transport');
var packageData = require('../package.json');
var fs = require('fs');
var hyperquest = require('hyperquest');

// Export createTransport method
module.exports.createTransport = function(transporter) {
    transporter = transporter || directTransport({
        debug: true
    });

    if (typeof transporter === 'object' && typeof transporter.send !== 'function') {
        transporter = smtpTransport(transporter);
    }

    return new Nodemailer(transporter);
};

/**
 * Creates an object for exposing the Nodemailer API
 *
 * @constructor
 * @param {Object} transporter Transport object instance to pass the mails to
 */
function Nodemailer(transporter) {
    EventEmitter.call(this);

    this._plugins = {
        compile: [],
        stream: []
    };

    this.transporter = transporter;

    if (typeof transporter.on === 'function') {
        this.transporter.on('log', this.emit.bind(this, 'log'));
        this.transporter.on('error', this.emit.bind(this, 'error'));
    }
}
util.inherits(Nodemailer, EventEmitter);

Nodemailer.prototype.use = function(step, plugin) {
    step = (step || '').toString();
    if (!this._plugins.hasOwnProperty(step)) {
        this._plugins[step] = [plugin];
    } else {
        this._plugins[step].push(plugin);
    }
};

/**
 * Optional close method, passed to the underlying transport object
 */
Nodemailer.prototype.close = function( /* possible arguments */ ) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof this.transporter.close === 'function') {
        this.transporter.close.apply(this.transporter, args);
    }
};

/**
 * Sends an email using the preselected transport object
 *
 * @param {Object} data E-data description
 * @param {Function} callback Callback to run once the sending succeeded or failed
 */
Nodemailer.prototype.sendMail = function(data, callback) {
    data = data || {};
    data.headers = data.headers || {};
    callback = callback || function() {};

    var mail = {
        data: data,
        message: null,
        resolveContent: this.resolveContent.bind(this)
    };

    if (typeof this.transporter === 'string') {
        return callback(new Error('Unsupported configuration, downgrade Nodemailer to v0.7.1 or see the migration guide https://github.com/andris9/Nodemailer#migration-guide'));
    }

    this._processPlugins('compile', mail, function(err) {
        if (err) {
            return callback(err);
        }

        mail.message = mailcomposer(mail.data);

        if (mail.data.xMailer !== false) {
            mail.message.setHeader('X-Mailer', mail.data.xMailer || this._getVersionString());
        }

        this._processPlugins('stream', mail, function(err) {
            if (err) {
                return callback(err);
            }
            this.transporter.send(mail, callback);
        }.bind(this));
    }.bind(this));
};

/**
 * Resolves a String or a Buffer value for content value. Useful if the value
 * is a Stream or a file or an URL. If the value is a Stream, overwrites
 * the stream object with the resolved value (you can't stream a value twice).
 *
 * This is useful when you want to create a plugin that needs a content value,
 * for example the `html` or `text` value as a String or a Buffer but not as
 * a file path or an URL.
 *
 * @param {Object} data An object or an Array you want to resolve an element for
 * @param {String|Number} key Property name or an Array index
 * @param {Function} callback Callback function with (err, value)
 */
Nodemailer.prototype.resolveContent = function(data, key, callback) {
    var content = data && data[key] && data[key].content || data[key];
    var encoding = (typeof data[key] === 'object' && data[key].encoding || 'utf8')
        .toString()
        .toLowerCase()
        .replace(/[-_\s]/g, '');

    if (!content) {
        return callback(null, content);
    }

    if (typeof content === 'object') {
        if (typeof content.pipe === 'function') {
            return this._resolveStream(content, function(err, value) {
                if (err) {
                    return callback(err);
                }
                // we can't stream twice the same content, so we need
                // to replace the stream object with the streaming result
                data[key] = value;
                callback(null, value);
            }.bind(this));
        } else if (/^https?:\/\//i.test(content.path || content.href)) {
            return this._resolveStream(hyperquest(content.path || content.href), callback);
        } else if (/^data:/i.test(content.path || content.href)) {
            var parts = (content.path || content.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
            if (!parts) {
                return callback(null, new Buffer(0));
            }
            return callback(null, /\bbase64$/i.test(parts[1]) ? new Buffer(parts[2], 'base64') : new Buffer(decodeURIComponent(parts[2])));
        } else if (content.path) {
            return this._resolveStream(fs.createReadStream(content.path), callback);
        }
    }

    if (typeof data[key].content === 'string' && ['utf8', 'usascii', 'ascii'].indexOf(encoding) < 0) {
        content = new Buffer(data[key].content, encoding);
    }

    // default action, return as is
    callback(null, content);
};

/**
 * Streams a stream value into a Buffer
 *
 * @param {Object} stream Readable stream
 * @param {Function} callback Callback function with (err, value)
 */
Nodemailer.prototype._resolveStream = function(stream, callback) {
    var responded = false;
    var chunks = [];
    var chunklen = 0;

    stream.on('error', function(err) {
        if (responded) {
            return;
        }

        responded = true;
        callback(err);
    });

    stream.on('data', function(chunk) {
        if (chunk && chunk.length) {
            chunks.push(chunk);
            chunklen += chunk.length;
        }
    });

    stream.on('end', function() {
        if (responded) {
            return;
        }
        responded = true;

        var value;

        try {
            value = Buffer.concat(chunks, chunklen);
        } catch (E) {
            return callback(E);
        }
        callback(null, value);
    });
};

Nodemailer.prototype._getVersionString = function() {
    return util.format(
        '%s (%s; +%s; %s/%s)',
        packageData.name,
        packageData.version,
        packageData.homepage,
        this.transporter.name,
        this.transporter.version
    );
};

Nodemailer.prototype._processPlugins = function(step, mail, callback) {
    step = (step || '').toString();

    if (!this._plugins.hasOwnProperty(step) || !this._plugins[step].length) {
        return callback(null);
    }

    var plugins = Array.prototype.slice.call(this._plugins[step]);

    var processPlugins = function() {
        if (!plugins.length) {
            return callback(null);
        }
        var plugin = plugins.shift();
        plugin(mail, function(err) {
            if (err) {
                return callback(err);
            }
            processPlugins();
        });
    }.bind(this);

    processPlugins();
};