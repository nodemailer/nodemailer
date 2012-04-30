var Transport = require("./transport").Transport,
    MailComposer = require("mailcomposer").MailComposer,
    XOAuthGenerator = require("./xoauth").XOAuthGenerator,
    helpers = require("./helpers"),
    packageData;

try{
    packageData = require("../package.json");
}catch(E){
    // probably node 0.4 which doesn't support loading json files as objects
    packageData = JSON.parse(
            require("fs").
            readFileSync(
                require("path").
                join(
                    __dirname,
                    "..",
                    "package.json"
                )
            )
        );
}


/*
 * Version constants
 */
var X_MAILER_NAME = "Nodemailer",
    X_MAILER_HOMEPAGE = "http://andris9.github.com/Nodemailer/";

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
    this.options = options || {};

    this.transport = this.options.transport;

    if( this.options.encoding ){
      this.mailcomposer = new MailComposer({encoding: this.options.encoding});
    } else {
      this.mailcomposer = new MailComposer();
    }

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
    
    // set attachments (if any)
    this.setAttachments();
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
                          "envelope"],
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
            this.mailcomposer.addHeader(key, this.options.headers[key]);
        }
    }
};

/**
 * <p>Add some required headers to the message, such as Date: and Message-Id:</p>
 */
Nodemailer.prototype.setModuleHeaders = function(){
    
    // Mailer name + version
    this.mailcomposer.addHeader("X-Mailer", this.generateUserAgentString());
    
    // Date
    this.mailcomposer.addHeader("Date", new Date().toUTCString());
    
    // Message ID
    if(this.options.messageId){
        this.mailcomposer.addHeader("Message-Id", "<"+this.options.messageId+">");
    }else if(this.options.messageId !== false){
        this.mailcomposer.addHeader("Message-Id", "<"+
                Date.now()+Math.random().toString(16).substr(1)+"@"+
                X_MAILER_NAME+">");
    }
};

/**
 * <p>If attachment array is set on the options object, add these attachments
 * to the mailcomposer object</p>
 */
Nodemailer.prototype.setAttachments = function(){
    if(!Array.isArray(this.options.attachments)){
        return;
    }
    var attachment;
    for(var i=0, len=this.options.attachments.length; i<len; i++){
        attachment = this.options.attachments[i];
        attachment.userAgent = attachment.userAgent || this.generateUserAgentString();
        this.mailcomposer.addAttachment(attachment);
    }
};
