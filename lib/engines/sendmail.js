var exec;

try{
    exec = require('child_process').exec;
}catch(E){
    // probably on Windows Node.js v0.5.0 - v0.5.2
}

exports.send = function(emailMessage, config, callback) {
    emailMessage.prepareVariables();
    
    if(!exec){
        return callback && callback(new Error("No support for child processes in this version of Node.JS, use SMTP instead"));
    }
    
    var headers = emailMessage.generateHeaders(),
        body = emailMessage.generateBody();
    
    var path = typeof config=="string"?config:"sendmail";
    exec('echo "'+(headers+"\r\n\r\n"+body).replace(/"/g,'\\"')+'" | '+path+" -t", function(error){
        process.nextTick(function(){
            if(error){
                callback && callback(error, null);
            }else{
                callback && callback(null, true);
            }
        });
    });
    return;
};
