var http = require('http'),
    https = require('https'),
    crypto = require('crypto');

//Taken shamelessly from the [MDN](https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Date)
function ISODateString(d){
     return d.getUTCFullYear() + '-' +
            pad(d.getUTCMonth()+1)+'-' +
            pad(d.getUTCDate())+'T' +
            pad(d.getUTCHours())+':' +
            pad(d.getUTCMinutes())+':' +
            pad(d.getUTCSeconds())+'Z';
}

function pad(n){
    return n<10 ? '0'+n : n;
}

//Extracts the hostname from a given URL
function getHostname(url) {
    return url.replace(/^https?:\/\/([^\/]*).*$/, "$1");
}

//Custom keyValPair construction that ignores "special" config keys
function buildKeyValPairs(config) {
    var keys = Object.keys(config).sort(),
        keyValPairs = [], 
        k, 
        len;
    
    for(k=0, len = keys.length; k < len; k++) {
        if(keys[k] != "ServiceUrl") {
            keyValPairs.push((encodeURIComponent(keys[k]) + "=" + encodeURIComponent(config[keys[k]])));
        }
    }
    
    return keyValPairs.join("&");
}

//Following signature documentation from [here](http://docs.amazonwebservices.com/ses/latest/DeveloperGuide/index.html?HMACShaSignatures.html)
function buildSignature(date, AWSSecretKey) {
    var sha256 = crypto.createHmac('sha256', AWSSecretKey);
    sha256.update(date);
    return sha256.digest('base64');
}

//Adds the callback to the response handler's scope
function buildResponseHandler(callback) {
    return function(response) {
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
            return callback && callback(null, body);
        });
    };
}

//Constructs the email to be send and sends it to Amazon SES
exports.send = function(emailMessage, config, callback) {
    var email = "",
        params = "",
        request,
        reqObj,
        date = new Date();
        
    //Check if required config settings set
    if(!config.AWSAccessKeyID || !config.AWSSecretKey) {
        return callback(new Error("Missing AWS Credentials"));
    }
    
    //Set defaults if necessary
    config.ServiceUrl = config.ServiceUrl || "https://email.us-east-1.amazonaws.com";
    
    //Build Email
    emailMessage.prepareVariables();
    email = emailMessage.generateHeaders() + "\r\n\r\n" + emailMessage.generateBody();
    
    //Construct the http/https request object
    params = buildKeyValPairs({
        Action: 'SendRawEmail',
        'RawMessage.Data': (new Buffer(email)).toString('base64'),
        Version: '2010-12-01',
        Timestamp: ISODateString(date)
    });
    
    reqObj = {
        host: getHostname(config.ServiceUrl),
        path: "/",
        method: "POST",
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': params.length,
            'Date': date.toUTCString(),
            'X-Amzn-Authorization':
                ['AWS3-HTTPS AWSAccessKeyID='+config.AWSAccessKeyID,
                "Signature="+buildSignature(date.toUTCString(), config.AWSSecretKey),
                "Algorithm=HmacSHA256"].join(",")
        }
    };
    
    //Execute the request on the correct protocol
    if(/^https:/.test(config.ServiceUrl)) {
        request = https.request(reqObj, buildResponseHandler(callback));
    } else {
        request = http.request(reqObj, buildResponseHandler(callback));
    }
    request.end(params);
};
