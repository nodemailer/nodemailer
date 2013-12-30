"use strict";

var spawn = require("child_process").spawn;
var util = require("util");
var Transform = require("stream").Transform || require("readable-stream").Transform;


// Transforming stream that replaces SMTP-style \r\n line endings to
// Sendmail-style \n line endings.
function NewlineTransform(options){
    Transform.call(this, options);
}
util.inherits(NewlineTransform, Transform);

NewlineTransform.prototype._transform = function(chunk, encoding, done){
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
        if(config.path){
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
SendmailTransport.prototype.sendMail = function sendMail(emailMessage, callback){

    var envelope = emailMessage.getEnvelope(),
        args = this.args || ["-f"].concat(envelope.from).concat(envelope.to),
        sendmail,
        cbCounter = 2,
        didCb,
        marker = "SendmailTransport.sendMail",
        transform;

    args.unshift("-i"); // force -i to keep single dots

    try {
        sendmail = spawn(this.path, args);
    } catch (e){
        e[marker] = "spawn exception";
        sendmailResult(e);
    }

    if(sendmail){
        sendmail.on("error", sendmailError);
        sendmail.once("exit", sendmailExit);
        sendmail.once("close", endEvent);
        sendmail.stdin.on("error", sendmailStdinError);

        transform = new NewlineTransform();
        emailMessage.pipe(transform).pipe(sendmail.stdin);
        emailMessage.streamMessage();
    }

    function sendmailError(e){
        e[marker] = "sendmailError";
        sendmailResult(e);
    }

    function sendmailStdinError(e){
        e[marker] = "sendmailStdinError";
        sendmailResult(e);
    }

    function sendmailExit(code){
        if(!code){
            endEvent();
        }else{
            sendmailResult(new Error("Sendmail exited with " + code));
        }
    }

    function endEvent(){
        if(!--cbCounter){
            sendmailResult();
        }
    }

    function sendmailResult(e){
        if(!didCb){
            didCb = true;
            if(typeof callback === "function"){
                if(e){
                    callback(e);
                }else{
                    callback(null, {
                        messageId: emailMessage._messageId
                    });
                }

                e = null;
            }
        }
        if(e){
            /*
            The nodemailer module needs an events.EventEmitter so that additional errors can be emitted.
            As of 12/16/2013 it does not have that, so throw spurious errors here
            There should not be any, but the Titanic was unsinkable.
            */
            e.extra = true;
            throw e;
        }
    }
};
