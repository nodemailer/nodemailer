var exec;

try{
    spawn = require('child_process').spawn;
}catch(E){
    // probably on Windows Node.js v0.5.0 - v0.5.2
}

module.exports = SendmailTransport;

function SendmailTransport(config){
    this.path = typeof config=="string"?config:"sendmail";
}

SendmailTransport.sendMail = function(emailMessage, callback) {

    if(!spawn){
        return callback && callback(new Error("No support for child processes in this version of Node.JS, use SMTP instead"));
    }

    // sendmail strips this header line
    emailMessage.options.keepBcc = true;
    
    var sendmail = spawn(this.path, "-t");
    
    sendmail.on('exit', function (code) {
        callback(code?new Error("Sendmail exited with "+code):null);
    });
    
    mailcomposer.pipe(sendmail.stdin);
    mailcomposer.streamMessage();
};