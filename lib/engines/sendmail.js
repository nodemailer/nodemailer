var spawn = require('child_process').spawn;

// Expose to the world
module.exports = SendmailTransport;

/**
 * @constructor
 * @param {String} [config] path to the sendmail command
 */
function SendmailTransport(config){
    this.path = typeof config=="string"?config:"sendmail";
}

SendmailTransport.prototype.sendMail = function(emailMessage, callback) {

    // sendmail strips this header line by itself
    emailMessage.options.keepBcc = true;
    
    var sendmail = spawn(this.path, ["-t"]);
    
    sendmail.on('exit', function (code) {
        callback(code?new Error("Sendmail exited with "+code):null);
    });
    
    emailMessage.pipe(sendmail.stdin);
    emailMessage.streamMessage();
    
};