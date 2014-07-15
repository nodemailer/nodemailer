'use strict';

var Compiler = require('./compiler');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var directTransport = require('nodemailer-direct-transport');
var smtpTransport = require('nodemailer-smtp-transport');
var packageData = require('../package.json');

// Export createTransport method
module.exports.createTransport = function(transporter) {
    transporter = transporter || directTransport({
        debug: true
    });

    if (typeof transporter.send !== 'function') {
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
        this.transporter.on('log', function() {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('log');
            this.emit.apply(this, args);
        }.bind(this));

        this.transporter.on('error', function(err) {
            this.emit('error', err);
        }.bind(this));
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
        message: null
    };

    this._processPlugins('compile', mail, function(err) {
        if (err) {
            return callback(err);
        }

        mail.message = new Compiler(mail.data).compile();

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