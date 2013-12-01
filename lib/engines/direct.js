"use strict";

var createDirectmail = require("directmail");

// Expose to the world
module.exports = DirectTransport;

/**
 * <p>Generates a Transport object for DirectMail</p>
 *
 * <p>Possible options can be the following:</p>
 *
 * <ul>
 *     <li><b>debug</b> - If true, logs output to console</li>
 * </ul>
 *
 * @constructor
 * @param {Object} options Options object for the DirectMail transport
 */
function DirectTransport(options){
    this.directmail = createDirectmail(options);
}

// Setup version info for the transport
DirectTransport.prototype.version = createDirectmail.version;

/**
 * <p>Compiles a mailcomposer message and forwards it to handler that sends it.</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the sending is completed
 */
DirectTransport.prototype.sendMail = function(emailMessage, callback) {
    this.generateMessage(emailMessage, (function(err, email){
        if(err){
            return typeof callback == "function" && callback(err);
        }
        this.handleMessage(emailMessage, email, callback);
    }).bind(this));
};

/**
 * <p>Compiles and sends the request to SMTP with e-mail data</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {String} email Compiled raw e-mail as a string
 * @param {Function} callback Callback function to run once the message has been sent
 */
DirectTransport.prototype.handleMessage = function(emailMessage, email, callback) {
    var envelope = emailMessage.getEnvelope();

    try{
        this.directmail.send({
            from: envelope.from,
            recipients: envelope.to,
            message: email
        });
    }catch(E){
        if(typeof callback == "function"){
            callback(E);
        }
        return;
    }

    if(typeof callback == "function"){
        callback(null, {message: "Message Queued", messageId: emailMessage._messageId});
    }
};

/**
 * <p>Compiles the messagecomposer object to a string.</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run once the message has been compiled
 */

DirectTransport.prototype.generateMessage = function(emailMessage, callback) {
    var email = "";

    emailMessage.on("data", function(chunk){
        email += (chunk || "").toString("utf-8");
    });

    emailMessage.on("end", function(chunk){
        email += (chunk || "").toString("utf-8");
        callback(null, email);
    });

    emailMessage.streamMessage();
};
