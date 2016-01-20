'use strict';

var shared = require('nodemailer-shared');

module.exports = templateSender;

// expose for testing
module.exports.render = render;

/**
 * Create template based e-mail sender
 *
 * @param {Object} transport Nodemailer transport object to use for actual sending
 * @param {Object} templates Either an object with template strings or an external renderer
 * @param {Object} [defaults] Default fields set for every mail sent using this sender
 * @return {Function} Template based sender
 */
function templateSender(transport, templates, defaults) {
    templates = templates || {};
    defaults = defaults || {};

    // built in renderer
    var defaultRenderer = function (context, callback) {
        var rendered = {};
        Object.keys(templates).forEach(function (key) {
            rendered[key] = render(templates[key], {
                escapeHtml: key === 'html'
            }, context);
        });
        callback(null, rendered);
    };

    // actual renderer
    var renderer = (typeof templates.render === 'function' ? templates.render.bind(templates) : defaultRenderer);

    return function (fields, context, callback) {

        var promise;

        if (!callback && typeof Promise === 'function') {
            promise = new Promise(function (resolve, reject) {
                callback = shared.callbackPromise(resolve, reject);
            });
        }

        // render data
        renderer(context, function (err, rendered) {
            if (err) {
                return callback(err);
            }
            var mailData = mix(defaults, fields, rendered);
            setImmediate(function () {
                transport.sendMail(mailData, callback);
            });
        });

        return promise;
    };
}

/**
 * Merges multiple objects into one. Assumes single level, except 'headers'
 */
function mix( /* obj1, obj2, ..., objN */ ) {
    var args = Array.prototype.slice.call(arguments);
    var result = {};

    args.forEach(function (arg) {
        Object.keys(arg || {}).forEach(function (key) {
            if (key === 'headers') {
                if (!result.headers) {
                    result.headers = {};
                }
                Object.keys(arg[key]).forEach(function (hKey) {
                    if (!(hKey in result.headers)) {
                        result.headers[hKey] = arg[key][hKey];
                    }
                });
            } else if (!(key in result)) {
                result[key] = arg[key];
            }
        });
    });

    return result;
}

/**
 * Renders a template string using provided context. Values are marked as {{key}} in the template.
 *
 * @param {String} str Template string
 * @param {Object} options Render options. options.escapeHtml=true escapes html specific characters
 * @param {Object} context Key-value pairs for the template, eg {name: 'User Name'}
 * @return {String} Rendered template
 */
function render(str, options, context) {
    str = (str || '').toString();
    context = context || {};
    options = options || {};

    var re = /\{\{[ ]*([^{}\s]+)[ ]*\}\}/g;

    return str.replace(re, function (match, key) {
        var value;
        if (context.hasOwnProperty(key)) {
            value = context[key].toString();
            if (options.escapeHtml) {
                value = value.replace(/["'&<>]/g, function (char) {
                    switch (char) {
                        case '&':
                            return '&amp;';
                        case '<':
                            return '&lt;';
                        case '>':
                            return '&gt;';
                        case '"':
                            return '&quot;';
                        case '\'':
                            return '&#039;';
                        default:
                            return char;
                    }
                });
            }
            return value;
        }
        return match;
    });
}
