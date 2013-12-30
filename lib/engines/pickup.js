"use strict";

var fs = require("fs"),
    path = require("path");

// Expose to the world
module.exports = PickupTransport;

/**
 * <p>Generates a Transport object which stores mails in a pickup directory</p>
 *
 * <p>Possible options can be the following:</p>
 *
 * <ul>
 *     <li><b>directory</b> - The directory where applications save e-mail for later processing by the SMTP server.</li>
 * </ul>
 *
 * @constructor
 * @param {Object} [options] Pickup directory options
 */
function PickupTransport(options) {

    if(typeof options == "string"){
        options = {
            directory: options
        };
    }

    this.options = options || {};

    // Check if target directory has been set.
    if (typeof this.options.directory === "undefined") {
        throw new Error('directory is not set.');
    }

    // Check if the target directory exists.
    fs.exists(this.options.directory, function(exists) {
        if (!exists) {
            throw new Error('directory does not exists.');
        }
    });
}

/**
 * <p>Generates a raw e-mail source and stores it in the pickup directory</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the e-mail is composed
 */
PickupTransport.prototype.sendMail = function(emailMessage, callback) {

    var directory = this.options.directory,
        callbackSent = false,
        target = path.join(
                directory,
                emailMessage._messageId + ".eml"),
        targetStream = fs.createWriteStream(target);

    emailMessage.options.keepBcc = true;

    emailMessage.on("error", function(err){
        if(callbackSent){
            return;
        }
        callbackSent = true;
        callback(err);
    });

    targetStream.on("error", function(err){
        if(callbackSent){
            return;
        }
        callbackSent = true;
        callback(err);
    });

    emailMessage.on("end", function(){
        if(callbackSent){
            return;
        }
        callbackSent = true;

        callback(null, {
            envelope: emailMessage.getEnvelope(),
            messageId: emailMessage._messageId,
            path: target
        });
    });

    emailMessage.pipe(targetStream);
    emailMessage.streamMessage();
};
