var SendmailTransport = require("./engines/sendmail"),
    SMTPTransport = require("./engines/smtp"),
    SESTransport = require("./engines/ses");


module.exports.Transport = Transport;

function Transport(type, options){

    this.options = options;

    switch((type || "").toString().trim().toUpperCase()){
        case "SMTP":
            this.transport = new SMTPTransport(this.options);
            break;
        case "SES":
            this.transport = new SESTransport(this.options);
            break;
        case "SENDMAIL":
            this.transport = new SendmailTransport(this.options);
            break;
        default:
            this.transport = false;
    }
    
}

Transport.prototype.sendMail = function(emailMessage, callback){
    if(!this.transport){
        return callback(new Error("Invalid transport method defined"));
    }
    
    this.transport.sendMail(emailMessage, callback);
}

Transport.prototype.close = function(callback){
    if(!this.transport){
        return callback(new Error("Invalid transport method defined"));
    }
    
    if(typeof this.transport.close == "function"){
        this.transport.close(callback);
    }
}