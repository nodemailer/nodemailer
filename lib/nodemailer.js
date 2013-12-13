"use strict";

var Transport = require("./transport").Transport,
    MailComposer = require("mailcomposer").MailComposer,
    XOAuthGenerator = require("./xoauth").XOAuthGenerator,
    helpers = require("./helpers"),
    crypto = require("crypto"),
    os = require("os"),
    net = require("net"),
    packageData = require("../package.json"),
    publicAddress = require("public-address");

/*
 * Version constants
 */
var X_MAILER_NAME = "Nodemailer",
    X_MAILER_HOMEPAGE = packageData.homepage;

module.exports.X_MAILER_NAME = X_MAILER_NAME;
module.exports.X_MAILER_HOMEPAGE = X_MAILER_HOMEPAGE;

// Export createTransport method
module.exports.createTransport = function(type, options){
    var transport = new Transport(type, options);

    transport.sendMail = function(options, callback){
        options = options || {};
        options.transport = options.transport || transport;
        sendMail(options, callback);
    };

    return transport;
};

//Export createXOAuthGenerator function
module.exports.createXOAuthGenerator = function(options){
    return new XOAuthGenerator(options);
};

// exports mail generator
Object.defineProperty(module.exports, "mail", {
    get: function(){
        var transport = module.exports.createTransport("direct");
        return function(mailData){
            transport.sendMail(mailData);
        };
    }
});

// Export Transport constructor
module.exports.Transport = Transport;

// Export Nodemailer constructor
module.exports.Nodemailer = Nodemailer;

// Export sendMail function (and the alias send_mail for legacy)
module.exports.sendMail = module.exports.send_mail = sendMail;

function sendMail(options, callback){
    var mailer = new Nodemailer(options);
    mailer.validateSettings(function(err){
        if(err){
            // report validation error back to the client
            return callback(err);
        }else{
            // try to send the e-mail message
            mailer.sendMail(callback);
        }
    });

    return mailer;
}


/**
 * <p>Generates a Nodemailer object which is the main 'hub' for managing the
 * send process</p>
 *
 * @constructor
 * @param {Object} options Message options object, see README for the complete list of possible options
 */
function Nodemailer(options){
    var mailcomposerOptions = {};

    this.options = options || {};

    this.transport = this.options.transport;

    mailcomposerOptions.identityString = X_MAILER_NAME + " " + packageData.version;

    if(this.options.encoding){
        mailcomposerOptions.encoding = this.options.encoding;
    }

    if(this.options.charset){
        mailcomposerOptions.charset = this.options.charset;
    }

    if(!!this.options.forceEmbeddedImages){
        mailcomposerOptions.forceEmbeddedImages = true;
    }

    this.mailcomposer = new MailComposer(mailcomposerOptions);

    if(!this.transport){
        this.transport = this.getGlobalTransport();
    }
}

/**
 * <p>Generates an user agent string for Nodemailer with homepage, version etc.</p>
 *
 * @return {String} user agent string for X-Mailer value
 */
Nodemailer.prototype.generateUserAgentString = function(){
    var details = [];

    if(packageData.version){
        details.push(packageData.version);
    }

    if(X_MAILER_HOMEPAGE){
        details.push("+"+X_MAILER_HOMEPAGE);
    }

    if(this.transport){
        details.push((this.transport.transportType || "").toLowerCase() +
            (this.transport.version ? "/" + this.transport.version : ""));
    }

    return X_MAILER_NAME+ (details.length?" ("+details.join("; ")+")":"");
};

/**
 * <p>Add support for legacy transport settings by checking for global
 * variables SMTP, sendmail and SES</p>
 *
 * @return {Object} {@link Transport} object
 */
Nodemailer.prototype.getGlobalTransport = function(){
    if(this.options.SMTP){
        // cache the transport for SMTP as it is actually a connection pool
        if(!this.options.SMTP._smtp_transport){
            this.options.SMTP._smtp_transport = new Transport("SMTP", this.options.SMTP);
        }
        return this.options.SMTP._smtp_transport;
    }else if(this.options.sendmail){
        return new Transport("sendmail", this.options.sendmail);
    }else if(this.options.SES){
        return new Transport("SES", this.options.SES);
    }else if(module.exports.SMTP){
        // cache the transport for SMTP as it is actually a connection pool
        if(!module.exports._smtp_transport){
            module.exports._smtp_transport = new Transport("SMTP", module.exports.SMTP);
        }
        return module.exports._smtp_transport;
    }else if(module.exports.sendmail){
        return new Transport("sendmail", module.exports.sendmail);
    }else if(module.exports.SES){
        return new Transport("SES", module.exports.SES);
    }
    return false;
};

/**
 * <p>Doesn't do much currently, if the future should link to transport
 * validation methods. For example in case of SES should check that AWS
 * keys are set up etc.</p>
 *
 * @param {Function} callback Callback function to run after validation
 */
Nodemailer.prototype.validateSettings = function(callback){
    if(!this.transport || !this.transport.transport){
        return callback(new Error("No transport method defined"));
    }

    // transport.options.resolveHostname is set to true, resolve pulbic
    // hostname for the machine and use this when generating Message-ID values
    // or when communicating with SMTP
    if(this.transport.options && this.transport.options.resolveHostname && !this.transport.options.name){
        return publicHostnameResolver.resolve((function(err, resolved){
            this.transport.options.name = this.resolveHostname(
                resolved ? resolved.hostname : this.options.name);
            callback();
        }).bind(this));
    }

    callback(null);
};

/**
 * <p>Send the e-mail message by using data from the original options object
 * and selected transport</p>
 *
 * @param {Function} callback Callback function to run when the e-mail has been sent (or it failed)
 */
Nodemailer.prototype.sendMail = function(callback){
    // compose the e-mail
    this.generateMailObject();
    // send the message using preselected transport method
    this.transport.sendMailWithTransport(this.mailcomposer, callback);
};

/**
 * <p>Uses the data from the original options object to compose a mailcomposer
 * e-mail message that can be later streamed to the selected transport</p>
 */
Nodemailer.prototype.generateMailObject = function(){

    // set envelope data, subject etc.
    this.setGeneralOptions();

    // set module defined headers (date, message-id, etc.)
    this.setModuleHeaders();

    // set user defined headers (if any)
    this.setUserHeaders();

    // set alternatives (if any)
    this.setAlternatives();

    // set attachments (if any)
    this.setAttachments();

    // setup dsn
    if(this.options.dsn){
        this.mailcomposer.options.dsn = this.options.dsn;
    }
};

/**
 * <p>Uses the general options (message sender and receiver, subject body, etc.)
 * to set mailcomposer properties. Includes support for legacy properties.</p>
 */
Nodemailer.prototype.setGeneralOptions = function(){

    // generate plaintext if only HTML exists and generateTextFromHTML is true
    if(!(this.options.text || this.options.body) && (this.options.html) &&
      this.options.generateTextFromHTML){
        this.options.text = helpers.stripHTML(this.options.html);
    }

    var acceptedFields = ["from", "sender", "to", "subject", "replyTo", "debug",
                          "reply_to", "cc", "bcc", "body", "text", "html",
                          "envelope", "inReplyTo", "references"],
        mailOptions = {},
        keys = Object.keys(this.options),
        key;

    for(var i=0, len=keys.length; i<len; i++){
        key = keys[i];
        if(acceptedFields.indexOf(key) >=0 && this.options[key]){
            mailOptions[key] = this.options[key];
        }
    }

    if(this.options.debug){
        console.log(mailOptions);
    }

    this.mailcomposer.setMessageOption(mailOptions);
};

/**
 * <p>If the 'headers' property was set on the options, add the values to the
 * header of the e-mail message</p>
 */
Nodemailer.prototype.setUserHeaders = function(){
    if(typeof this.options.headers != "object"){
        return;
    }
    var keys = Object.keys(this.options.headers),
        key;

    for(var i=0, len=keys.length; i<len; i++){
        key = keys[i];
        if(this.options.headers[key]){
            this.mailcomposer.addHeader(key, this.options.headers[key], true);
        }
    }
};

/**
 * <p>Add some required headers to the message, such as Date: and Message-Id:</p>
 */
Nodemailer.prototype.setModuleHeaders = function(){
    var messageId,
        transportOptions = this.transport &&
            this.transport.options &&
            typeof this.transport.options == "object" &&
            this.transport.options || {};

    // Mailer name + version
    // if xMailer is explicitly set to false, skip the X-Mailer header
    if(transportOptions.xMailer !== false){
        this.mailcomposer.addHeader("X-Mailer",
            transportOptions.xMailer || this.generateUserAgentString());
    }

    // Date
    if(this.options.date){
        this.mailcomposer.addHeader("Date", this.options.date);
    }else{
        this.mailcomposer.addHeader("Date", new Date().toUTCString());
    }

    // Message ID
    if(this.options.messageId){
        messageId = this.options.messageId;
    }else if(this.options.messageId !== false){
        messageId = crypto.randomBytes(15).toString("hex") +"@"+ this.resolveHostname(this.options.name || transportOptions.name);
    }

    if(messageId){
        this.mailcomposer.addHeader("Message-Id", "<"+messageId+">");
        this.mailcomposer._messageId = messageId;
    }

};

/**
 * <p>If attachment array is set on the options object, add these alternatives
 * to the mailcomposer object</p>
 */
Nodemailer.prototype.setAlternatives = function(){
    var alternative;

    if(!this.options.alternatives){
        return;
    }

    // convert non array value to an array if needed
    this.options.alternatives = [].concat(this.options.alternatives);

    for(var i=0, len=this.options.alternatives.length; i<len; i++){
        alternative = this.options.alternatives[i];
        this.mailcomposer.addAlternative(alternative);
    }
};

/**
 * <p>If attachment array is set on the options object, add these attachments
 * to the mailcomposer object</p>
 */
Nodemailer.prototype.setAttachments = function(){
    var attachment;

    if(!this.options.attachments){
        return;
    }

    // convert non array value to an array if needed
    this.options.attachments = [].concat(this.options.attachments);

    for(var i=0, len=this.options.attachments.length; i<len; i++){
        attachment = this.options.attachments[i];
        attachment.userAgent = attachment.userAgent || this.generateUserAgentString();
        this.mailcomposer.addAttachment(attachment);
    }
};

/**
 * Resolves hostname, prefers given argument. If resolved
 * name is an IP address, "localhost" is used
 *
 * @param {String} [name] Preferred hostname
 * @return {String} Resolved hostname
 */
Nodemailer.prototype.resolveHostname = function(name){
    if(name === true){
        name = false;
    }

    if(!name || net.isIP(name.replace(/[\[\]]/g, "").trim())){
        name = (os.hostname && os.hostname()) || "";
    }

    if(!name || net.isIP(name.replace(/[\[\]]/g, "").trim())){
        name = "localhost";
    }

    return name.toLowerCase();
};

/**
 * Interface for resolving public hostname for the current machine
 * Resolves the hostname only once and uses the cached value later on
 */
var publicHostnameResolver = {

    _callbacks: [],
    _resolving: false,
    _resolved: false,

    /**
     * Resolve hostname for the current machine
     *
     * @param {Function} callback Function with an error object and resolved data as arguments
     */
    resolve: function(callback){
        if(this._resolved){
            return callback(null, this._resolved);
        }

        this._callbacks.push(callback);

        if(!this._resolving){
            this._startResolving();
        }
    },

    /**
     * Initiate hostname resolving
     */
    _startResolving: function(){
        this._resolving = true;

        publicAddress((function(err, data){
            this._resolving = false;

            // if the resolving failed, skip it
            this._resolved = data || {};

            // emit all queued callbacks
            this._callbacks.forEach((function(callback){
                callback(null, this._resolved);
            }).bind(this));
        }).bind(this));
    }
};
