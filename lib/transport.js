var SendmailTransport = require("./engines/sendmail"),
    SMTPTransport = require("./engines/smtp"),
    SESTransport = require("./engines/ses"),
    StubTransport = require("./engines/stub");


// Expose to the world
module.exports.Transport = Transport;

/**
 * Hash of available transports (uppercase) and their constructor methods
 */
Transport.transports = {
    "SMTP": SMTPTransport,
    "SES": SESTransport,
    "SENDMAIL": SendmailTransport,
    "STUB": StubTransport
}

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
    
    this.transportType = (type || "").toString().trim().toUpperCase();
    this.dkimOptions = false;

    var constructor = Transport.transports[this.transportType];
    if(constructor){
        this.transport = new constructor(this.options);
    }else{
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
    
    if(this.dkimOptions){
        emailMessage.useDKIM(this.dkimOptions);
    }
    
    this.transport.sendMail(emailMessage, callback);
};

/**
 * <p>Sets up DKIM signing for this transport object</p>
 * 
 * @param {Object} dkim DKIM options
 */
Transport.prototype.useDKIM = function(dkim){
    this.dkimOptions = dkim;
    
    // SES doesn't like Message-Id and Date fields in DKIM signed data
    if(this.dkimOptions && this.transportType == "SES"){
        if(!this.dkimOptions.headerFieldNames){
            this.dkimOptions.headerFieldNames = "From:Sender:Reply-To:Subject:To:" +
                "Cc:MIME-Version:Content-Type:Content-Transfer-Encoding:Content-ID:" +
                "Content-Description:Resent-Date:Resent-From:Resent-Sender:" +
                "Resent-To:Resent-Cc:Resent-Message-ID:In-Reply-To:References:" +
                "List-Id:List-Help:List-Unsubscribe:List-Subscribe:List-Post:" +
                "List-Owner:List-Archive";
        }else{
            // remove Message-Id and Date field names if present in the list
            this.dkimOptions.headerFieldNames = this.dkimOptions.headerFieldNames.
                    replace(/\:\s*(Message-Id|Date)\s*\:/ig, ":").
                    replace(/^\s*(Message-Id|Date)\s*\:/i, "").
                    replace(/\:\s*(Message-Id|Date)\s*$/i, "").
                    trim();
        }
    }
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
