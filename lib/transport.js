var SendmailTransport = require("./engines/sendmail"),
    SMTPTransport = require("./engines/smtp"),
    SESTransport = require("./engines/ses"),
    StubTransport = require("./engines/stub");


// Expose to the world
module.exports.Transport = Transport;

/**
 * <p>Generates a Transport object that can be used to deliver e-mail.</p>
 * 
 * <p>All transport objects need to have <code>sendMail</code> property defined 
 * and if needed, also an <code>close</code> method</p>
 * 
 * @constructor
 * @param {String} type The type of the transport, currently available: SMTP, SES and Sendmail
 */
function Transport(type, options){

    this.options = options;

    switch((type || "").toString().trim().toUpperCase()){
        case "SMTP":
            this.transport = new SMTPTransport(this.options);
            break;
        case "SES":
            this.transport = new SESTransport(this.options);
            break;
        case "SENDMAIL":
            this.transport = new SendmailTransport(this.options);
            break;
        case "STUB":
            this.transport = new StubTransport(this.options);
            break;
        default:
            this.transport = false;
    }
    
}

/**
 * <p>Forwards the generated mailcomposer object to the selected transport
 * object for message delivery</p>
 * 
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the sending is completed
 */
Transport.prototype.sendMailWithTransport = function(emailMessage, callback){
    if(!this.transport){
        return callback(new Error("Invalid transport method defined"));
    }
    
    this.transport.sendMail(emailMessage, callback);
};

/**
 * <p>Closes the transport when needed, useful with SMTP (which uses connection
 * pool) but not so much with SES or Sendmail</p>
 * 
 * @param {Function} Callback function to run when the connection is closed
 */
Transport.prototype.close = function(callback){
    if(!this.transport){
        return callback(new Error("Invalid transport method defined"));
    }
    
    if(typeof this.transport.close == "function"){
        this.transport.close(callback);
    }else{
        if(typeof callback == "function"){
            callback(null);
        }
    }
};