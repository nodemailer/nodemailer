/*
 * This file is based on the original SES module for Nodemailer by dfellis
 * https://github.com/andris9/Nodemailer/blob/11fb3ef560b87e1c25e8bc15c2179df5647ea6f5/lib/engines/SES.js  
 */

// NB! Amazon SES does not allow unicode filenames on attachments!

var http = require('http'),
    https = require('https'),
    crypto = require('crypto'),
    urllib = require("url");

// Expose to the world
module.exports = SESTransport;

function SESTransport(options){
    this.options = options || {};
    
    //Set defaults if necessary
    this.options.ServiceUrl = this.options.ServiceUrl || "https://email.us-east-1.amazonaws.com";
}

SESTransport.prototype.sendMail = function(emailMessage, callback) {
    
    //Check if required config settings set
    if(!this.options.AWSAccessKeyID || !this.options.AWSSecretKey) {
        return callback(new Error("Missing AWS Credentials"));
    }
    
    this.generateMessage(emailMessage, (function(err, email){
        if(err){
            return callback(err);
        }
        this.handleMessage(email, callback);
    }).bind(this));
};

SESTransport.prototype.handleMessage = function(email, callback) {
    var request,
    
        date = new Date(),
    
        urlparts = urllib.parse(this.options.ServiceUrl),
        
        params = this.buildKeyValPairs({
            'Action': 'SendRawEmail',
            'RawMessage.Data': (new Buffer(email, "utf-8")).toString('base64'),
            'Version': '2010-12-01',
            'Timestamp': this.ISODateString(date)
        }),
        
        reqObj = {
            host: urlparts.hostname,
            path: urlparts.path || "/",
            method: "POST",
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': params.length,
                'Date': date.toUTCString(),
                'X-Amzn-Authorization':
                    ['AWS3-HTTPS AWSAccessKeyID='+this.options.AWSAccessKeyID,
                    "Signature="+this.buildSignature(date.toUTCString(), this.options.AWSSecretKey),
                    "Algorithm=HmacSHA256"].join(",")
            }
        };
    
    //Execute the request on the correct protocol
    if(urlparts.protocol.substr() == "https:") {
        request = https.request(reqObj, this.buildResponseHandler.bind(this, callback));
    } else {
        request = http.request(reqObj, this.buildResponseHandler.bind(this, callback));
    }
    request.end(params);
}

//Adds the callback to the response handler's scope
SESTransport.prototype.buildResponseHandler = function(callback, response) {
    var body = "";
    response.setEncoding('utf8');
    
    //Re-assembles response data
    response.on('data', function(d) {
        body += d.toString();
    });
    
    //Performs error handling and executes callback, if it exists
    response.on('end', function(err) {
        if(err instanceof Error) {
            return callback && callback(err, null);
        }
        if(response.statusCode != 200) {
            return callback &&
                callback(new Error('Email failed: ' + response.statusCode + '\n' + body), null);
        }
        return callback && callback(null, {
            message: body
        });
    });
}

SESTransport.prototype.generateMessage = function(emailMessage, callback) {
    var email = "";
    
    emailMessage.on("data", function(chunk){
        email += (chunk || "").toString("utf-8");
    });
    
    emailMessage.on("end", function(chunk){
        email += (chunk || "").toString("utf-8");
        callback(null, email);
    });
    
    emailMessage.streamMessage();
    
}

SESTransport.prototype.buildKeyValPairs = function(config){
    var keys = Object.keys(config).sort(),
        keyValPairs = [],
        key, i, len;
    
    for(i=0, len = keys.length; i < len; i++) {
        key = keys[i];
        if(key != "ServiceUrl") {
            keyValPairs.push((encodeURIComponent(key) + "=" + encodeURIComponent(config[key])));
        }
    }
    
    return keyValPairs.join("&");
}

SESTransport.prototype.buildSignature = function(date, AWSSecretKey) {
    var sha256 = crypto.createHmac('sha256', AWSSecretKey);
    sha256.update(date);
    return sha256.digest('base64');
}

SESTransport.prototype.ISODateString = function(d){
    return d.getUTCFullYear() +             '-' +
           this.strPad(d.getUTCMonth()+1) + '-' +
           this.strPad(d.getUTCDate()) +    'T' +
           this.strPad(d.getUTCHours()) +   ':' +
           this.strPad(d.getUTCMinutes()) + ':' +
           this.strPad(d.getUTCSeconds()) + 'Z';
}

SESTransport.prototype.strPad = function(n){
    return n<10 ? '0'+n : n;
}

