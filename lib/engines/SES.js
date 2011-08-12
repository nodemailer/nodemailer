var http = require('http');
var https = require('https');
var crypto = require('crypto');

//Taken shamelessly from the [MDN](https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Date)
function ISODateString(d){
	function pad(n){return n<10 ? '0'+n : n}
 	return d.getUTCFullYear()+'-'
		+ pad(d.getUTCMonth()+1)+'-'
		+ pad(d.getUTCDate())+'T'
		+ pad(d.getUTCHours())+':'
		+ pad(d.getUTCMinutes())+':'
		+ pad(d.getUTCSeconds())+'Z'
}

//Extracts the hostname from a given URL
function getHostname(url) {
	return url.replace(/^https?:\/\/([^\/]*)\/.*$/, "$1");
}

//Custom keyValPair construction that ignores "special" config keys
function buildKeyValPairs(config) {
	var keyValPairs = [];
	for(var key in config) {
		if(key != "ServiceUrl" && key != "AWSSecretKey") {
			keyValPairs.push((key + "=" + config[key]));
		}
	}
	return keyValPairs.join("&");
}

//Following the SES.pm signature implementation since Amazon's documentation sucks
function buildV2Signature(config) {
	var sha256 = crypto.createHash('sha256');
	sha256.update(
		"POST\n" +
		getHostname(config.ServiceUrl) +
		"\n/\n" +
		buildKeyValPairs(config) +
		config.AWSSecretKey
	);
	return sha256.digest('base64');
}

//Adds the callback to the response handler's scope
function buildResponseHandler(callback) {
	return function(response) {
		var body = "";
		console.log(response);
		//Re-assembles response data
		response.on('data', function(d) {
			body += d;
		});
		//Performs error handling and executes callback, if it exists
		response.on('close', function(err) {
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
	var email = "";
	var path = "/?";
	var hostname = "";
	//Check if required config settings set
	if(!config.AWSAccessKeyID || !config.AWSSecretKey) {
		return callback(new Error("Missing AWS Credentials"));
	}
	//Set defaults if necessary
	config.ServiceUrl = config.ServiceUrl || "https://email.us-east-1.amazonaws.com";
	config.Timestamp = config.Timestamp || ISODateString(new Date());
	//Build Email
	emailMessage.prepareVariables();
	email = emailMessage.generateHeaders() + "\r\n\r\n" + emailMessage.generateBody();
	//Unchangeable configuration settings for SES
	config.Version = '2010-12-01';
	config.SignatureVersion = '2';
	config.SignatureMethod = 'HmacSHA256';
	config.Action = 'SendRawEmail';
	config['RawMessage.Data'] = email;
	config.Signature = buildV2Signature(config);
	//Construct the http/https request object
	path += buildKeyValPairs(config);
	hostname = getHostname(config.ServiceUrl);
	var reqObj = {hostname: hostname, path: path};
	//Execute the request on the correct protocol
	if(/^https:/.test(config.ServiceUrl) {
		https.get(reqObj, buildResponseHandler(callback));
	} else {
		http.get(reqObj, buildResponseHandler(callback));
	}
};
