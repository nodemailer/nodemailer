var Transport = require("./transport").Transport,
    MailComposer = require("mailcomposer").MailComposer;

/*
 * Version constants
 */
var X_MAILER_NAME = "Nodemailer",
    X_MAILER_VERSION = "0.3.0; +http://www.nodemailer.org";


module.exports.Transport = Transport;

module.exports.sendMail = module.exports.send_mail = function(options, callback){
    var mailer = new Nodemailer(options);
    mailer.validateSettings(function(err){
        if(err){
            return callback(err);
        }else{
            mailer.sendMail(callback);
        }
    });
}


/**
 * 
 */
function Nodemailer(options){
    this.options = options || {};
    
    this.transport = this.options.transport;
    
    this.mailcomposer = new MailComposer();
    
    if(!this.transport){
        this.transport = this.getGlobalTransport();
    }
}

// support legacy transport settings
Nodemailer.prototype.getGlobalTransport = function(){
    if(this.options.SMTP){
        return new Transport("SMTP", this.options.SMTP);
    }else if(this.options.sendmail){
        return new Transport("sendmail", this.options.sendmail);
    }else if(this.options.SES){
        return new Transport("SES", this.options.SES);
    }else if(module.exports.SMTP){
        return new Transport("SMTP", module.exports.SMTP);
    }else if(module.exports.sendmail){
        return new Transport("sendmail", module.exports.sendmail);
    }else if(module.exports.SES){
        return new Transport("SES", module.exports.SES);
    }
    return false;
}

Nodemailer.prototype.validateSettings = function(callback){
    if(!this.transport || !this.transport.transport){
        return callback(new Error("No transport method defined"));
    }
    callback(null);
}

Nodemailer.prototype.sendMail = function(callback){
    // compose the e-mail
    this.generateMailObject();
    // send the message using preselected transport method
    this.transport.sendMail(this.mailcomposer, callback); 
};

Nodemailer.prototype.generateMailObject = function(){
    
    // set envelope data, subject etc.
    this.setGeneralOptions();
    
    // set module defined headers (date, message-id, etc.)
    this.setModuleHeaders();
    
    // set user defined headers (if any)
    this.setUserHeaders();
    
    // set attachments (if any)
    this.setAttachments();

}

Nodemailer.prototype.setGeneralOptions = function(){
    var acceptedFields = ["from", "sender", "to", "subject", "replyTo", "debug",
                          "reply_to", "cc", "bcc", "body", "text", "html"],
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
}

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
}

Nodemailer.prototype.setModuleHeaders = function(){
    
    // Mailer name + version
    this.mailcomposer.addHeader("X-Mailer", X_MAILER_NAME+
        (X_MAILER_VERSION?" ("+X_MAILER_VERSION+")":""));
    
    // Date
    this.mailcomposer.addHeader("Date", new Date().toUTCString());
    
    // Message ID
    this.mailcomposer.addHeader("Message-Id", "<"+
                Date.now()+Math.random().toString(16).substr(1)+"@"+
                X_MAILER_NAME+">");
}

Nodemailer.prototype.setAttachments = function(){
    if(!Array.isArray(this.options.attachments)){
        return;
    }
    var attachment;
    for(var i=0, len=this.options.attachments.length; i<len; i++){
        attachment = this.options.attachments[i];
        this.mailcomposer.addAttachment(attachment);
    }
}