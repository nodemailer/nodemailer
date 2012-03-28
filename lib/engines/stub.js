
// Expose to the world
module.exports = StubTransport;

/**
 * <p>Generates a stub Transport object for testing purposes</p>
 * 
 * @constructor
 */
function StubTransport(){}

/**
 * <p>Generates a raw e-mail source and returns it with callback</p>
 * 
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the e-mail is composed
 */
StubTransport.prototype.sendMail = function(emailMessage, callback) {

    var output = "";

    // sendmail strips this header line by itself
    emailMessage.options.keepBcc = true;
    
    emailMessage.on("data", function(data){
        output += (data || "").toString("utf-8");
    });
    
    emailMessage.on("error", function(err){
        callback(err);
    });
    
    emailMessage.on("end", function(){
        callback(null, {message: output, envelope: emailMessage.getEnvelope()});
    });

    emailMessage.streamMessage();
    
};