var spawn = require('child_process').spawn;

// Expose to the world
module.exports = SendmailTransport;

/**
 * <p>Generates a Transport object for Sendmail</p>
 *
 * @constructor
 * @param {String} [config] path to the sendmail command
 */
function SendmailTransport(config){
    this.path = "sendmail";
    this.args = false;
    if(typeof config=="string") {
        this.path = config;
    } else if(typeof config=="object") {
        if(config.path) {
            this.path = config.path;
        }
        if(Array.isArray(config.args)) {
            this.args = config.args;
        }
    }
}

/**
 * <p>Spawns a <code>'sendmail -t'</code> command and streams the outgoing
 * message to sendmail stdin. Return callback checks if the sendmail process
 * ended with 0 (no error) or not.</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the sending is completed
 */
SendmailTransport.prototype.sendMail = function(emailMessage, callback) {

    var envelope = emailMessage.getEnvelope();
    var args = this.args || ["-f"].concat(envelope.from).concat(envelope.to);
    args.unshift("-i"); // force -i to keep single dots

    var sendmail = spawn(this.path, args);
    sendmail.on('exit', function (code) {
        var msg = "Sendmail exited with "+code;
        if(typeof callback == "function"){
            callback(code?new Error(msg):null, {message: msg, messageId: emailMessage._messageId});
        }
    });

    emailMessage.pipe(sendmail.stdin);
    emailMessage.streamMessage();

};