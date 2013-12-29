"use strict";

var fs = require("fs"),
    path = require("path");

// Expose to the world
module.exports = PickupDirectoryTransport;

/**
 * <p>Generates a Transport object which stores mails in a pickup directory</p>
 *
 * <p>Possible options can be the following:</p>
 *
 * <ul>
 *     <li><b>pickupDirectoryLocation</b> - The directory where applications save e-mail for later processing by the SMTP server.</li>
 * </ul>
 *
 * @constructor
 * @param {Object} [options] Pickup directory options
 */
function PickupDirectoryTransport(options) {
    this.options = options || {};

    // Check if target directory has been set.
    if (typeof this.options.pickupDirectoryLocation === "undefined") {
        throw new Error('pickupDirectoryLocation is not set.');
    }

    // Check if the target directory exists.
    fs.exists(this.options.pickupDirectoryLocation, function(exists) {
        if (!exists) {
            throw new Error('pickupDirectoryLocation does not exists.');
        }
    });
}

/**
 * <p>Generates a raw e-mail source and stores it in the pickup directory</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the e-mail is composed
 */
PickupDirectoryTransport.prototype.sendMail = function(emailMessage, callback) {

    var output = "";
    var pickupDirectoryLocation = this.options.pickupDirectoryLocation;

    // sendmail strips this header line by itself
    emailMessage.options.keepBcc = true;

    emailMessage.on("data", function(data) {
        output += (data || "").toString("utf-8");
    });

    emailMessage.on("error", function(err) {
        callback(err);
    });

    emailMessage.on("end", function() {
        
        var target = 
            path.join(
                pickupDirectoryLocation,
                emailMessage._messageId + ".eml");

        fs.writeFile(target, output, function (err) {

            if (err) {
                callback(err);
            }

            callback(null, { 
                message: output,
                envelope: emailMessage.getEnvelope(),
                messageId: emailMessage._messageId
            });
        });
    });

    emailMessage.streamMessage();
};