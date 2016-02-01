'use strict';

var mailcomposer = require('mailcomposer');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var shared = require('nodemailer-shared');
var directTransport = require('nodemailer-direct-transport');
var smtpTransport = require('nodemailer-smtp-transport');
var smtpPoolTransport = require('nodemailer-smtp-pool');
var templateSender = require('./template-sender');
var packageData = require('../package.json');

// Export createTransport method
module.exports.createTransport = function (transporter, defaults) {
    var urlConfig;
    var options;

    // if no transporter configuration is provided use direct as default
    transporter = transporter || directTransport({
        debug: true
    });

    if (
        // provided transporter is a configuration object, not transporter plugin
        (typeof transporter === 'object' && typeof transporter.send !== 'function') ||
        // provided transporter looks like a connection url
        (typeof transporter === 'string' && /^(smtps?|direct):/i.test(transporter))
    ) {

        if ((urlConfig = typeof transporter === 'string' ? transporter : transporter.url)) {
            // parse a configuration URL into configuration options
            options = shared.parseConnectionUrl(urlConfig);
        } else {
            options = transporter;
        }

        if (options.direct) {
            transporter = directTransport(options);
        } else if (options.pool) {
            transporter = smtpPoolTransport(options);
        } else {
            transporter = smtpTransport(options);
        }
    }

    return new Nodemailer(transporter, defaults);
};

/**
 * Creates an object for exposing the Nodemailer API
 *
 * @constructor
 * @param {Object} transporter Transport object instance to pass the mails to
 */
function Nodemailer(transporter, defaults) {
    EventEmitter.call(this);

    this._defaults = defaults || {};

    this._plugins = {
        compile: [],
        stream: []
    };

    this.transporter = transporter;
    this.logger = this.transporter.logger || shared.getLogger({
        logger: false
    });

    // setup emit handlers for the transporter
    if (typeof transporter.on === 'function') {

        // deprecated log interface
        this.transporter.on('log', function (log) {
            this.logger.debug('%s: %s', log.type, log.message);
        }.bind(this));

        // transporter errors
        this.transporter.on('error', function (err) {
            this.logger.error('Transport Error: %s', err.message);
            this.emit('error', err);
        }.bind(this));

        // indicates if the sender has became idle
        this.transporter.on('idle', function () {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('idle');
            this.emit.apply(this, args);
        }.bind(this));
    }
}
util.inherits(Nodemailer, EventEmitter);

/**
 * Creates a template based sender function
 *
 * @param {Object} templates Object with string values where key is a message field and value is a template
 * @param {Object} defaults Optional default message fields
 * @return {Function} E-mail sender
 */
Nodemailer.prototype.templateSender = function (templates, defaults) {
    return templateSender(this, templates, defaults);
};

Nodemailer.prototype.use = function (step, plugin) {
    step = (step || '').toString();
    if (!this._plugins.hasOwnProperty(step)) {
        this._plugins[step] = [plugin];
    } else {
        this._plugins[step].push(plugin);
    }
};

/**
 * Optional methods passed to the underlying transport object
 */
['close', 'isIdle'].forEach(function (method) {
    Nodemailer.prototype[method] = function ( /* possible arguments */ ) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof this.transporter[method] === 'function') {
            return this.transporter[method].apply(this.transporter, args);
        } else {
            return false;
        }
    };
});

/**
 * Sends an email using the preselected transport object
 *
 * @param {Object} data E-data description
 * @param {Function} callback Callback to run once the sending succeeded or failed
 */
Nodemailer.prototype.sendMail = function (data, callback) {
    var promise;

    if (!callback && typeof Promise === 'function') {
        promise = new Promise(function (resolve, reject) {
            callback = shared.callbackPromise(resolve, reject);
        });
    }

    data = data || {};
    data.headers = data.headers || {};
    callback = callback || function () {};

    // apply defaults
    Object.keys(this._defaults).forEach(function (key) {
        if (!(key in data)) {
            data[key] = this._defaults[key];
        } else if (key === 'headers') {
            // headers is a special case. Allow setting individual default headers
            Object.keys(this._defaults.headers || {}).forEach(function (key) {
                if (!(key in data.headers)) {
                    data.headers[key] = this._defaults.headers[key];
                }
            }.bind(this));
        }
    }.bind(this));

    var mail = {
        data: data,
        message: null,
        resolveContent: shared.resolveContent
    };

    if (typeof this.transporter === 'string') {
        return callback(new Error('Unsupported configuration, downgrade Nodemailer to v0.7.1 to use it'));
    }

    this.logger.info('Sending mail using %s/%s', this.transporter.name, this.transporter.version);

    this._processPlugins('compile', mail, function (err) {
        if (err) {
            this.logger.error('PluginCompile Error: %s', err.message);
            return callback(err);
        }

        mail.message = mailcomposer(mail.data);

        if (mail.data.xMailer !== false) {
            mail.message.setHeader('X-Mailer', mail.data.xMailer || this._getVersionString());
        }

        if (mail.data.priority) {
            switch ((mail.data.priority || '').toString().toLowerCase()) {
                case 'high':
                    mail.message.setHeader('X-Priority', '1 (Highest)');
                    mail.message.setHeader('X-MSMail-Priority', 'High');
                    mail.message.setHeader('Importance', 'High');
                    break;
                case 'low':
                    mail.message.setHeader('X-Priority', '5 (Lowest)');
                    mail.message.setHeader('X-MSMail-Priority', 'Low');
                    mail.message.setHeader('Importance', 'Low');
                    break;
                default:
                    // do not add anything, since all messages are 'Normal' by default
            }
        }

        this._processPlugins('stream', mail, function (err) {
            if (err) {
                this.logger.error('PluginStream Error: %s', err.message);
                return callback(err);
            }

            this.transporter.send(mail, function () {
                var args = Array.prototype.slice.call(arguments);
                if (args[0]) {
                    this.logger.error('Send Error: %s', args[0].message);
                }
                callback.apply(null, args);
            }.bind(this));
        }.bind(this));
    }.bind(this));

    return promise;
};

Nodemailer.prototype._getVersionString = function () {
    return util.format(
        '%s (%s; +%s; %s/%s)',
        packageData.name,
        packageData.version,
        packageData.homepage,
        this.transporter.name,
        this.transporter.version
    );
};

Nodemailer.prototype._processPlugins = function (step, mail, callback) {
    step = (step || '').toString();

    if (!this._plugins.hasOwnProperty(step) || !this._plugins[step].length) {
        return callback(null);
    }

    var plugins = Array.prototype.slice.call(this._plugins[step]);

    this.logger.debug('Using %s plugins for %s', plugins.length, step);

    var processPlugins = function () {
        if (!plugins.length) {
            return callback(null);
        }
        var plugin = plugins.shift();
        plugin(mail, function (err) {
            if (err) {
                return callback(err);
            }
            processPlugins();
        });
    }.bind(this);

    processPlugins();
};
