"use strict";

var spawn = require('child_process').spawn;
var util = require('util');
var Transform = require('stream').Transform || require('readable-stream').Transform;


// Transforming stream that replaces SMTP-style \r\n line endings to
// Sendmail-style \n line endings.
function NewlineTransform(options) {
    Transform.call(this, options);
}
util.inherits(NewlineTransform, Transform);

NewlineTransform.prototype._transform = function(chunk, encoding, done) {
    this.push(chunk.toString().replace(/\r\n/g, "\n"));
    done();
};

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

    if(typeof config=="string"){
        this.path = config;
    }else if(typeof config=="object"){
        if(config.path) {
            this.path = config.path;
        }
        if(Array.isArray(config.args)){
            this.args = config.args;
        }
    }
}

/**
 * <p>Spawns a sendmail command either using <code>sendmail -i -f from_addr to_addr[]</code>
 * (by default) or <code>sendmail -i list_of_args[]</code> (if args property was given)
 * and pipes message to sendmail stdin. Return callback checks if the sendmail process
 * ended with 0 (no error) or not.</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the sending is completed
 */
SendmailTransport.prototype.sendMail = function(emailMessage, callback) {

    var envelope = emailMessage.getEnvelope(),
        args = this.args || ["-f"].concat(envelope.from).concat(envelope.to),
        sendmail,
        transform;
    
    args.unshift("-i"); // force -i to keep single dots

    sendmail = spawn(this.path, args);

    sendmail.on('exit', function (code) {
        var msg = "Sendmail exited with "+code;
        if(typeof callback == "function"){
            callback(code?new Error(msg):null, {message: msg, messageId: emailMessage._messageId});
        }
    });

    transform = new NewlineTransform();
    emailMessage.pipe(transform).pipe(sendmail.stdin);
    emailMessage.streamMessage();
};
