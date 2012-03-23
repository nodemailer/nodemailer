// this module is inspired by xoauth.py
// http://code.google.com/p/google-mail-xoauth-tools/

var crypto = require("crypto");

module.exports.XOAuthGenerator = XOAuthGenerator;

function XOAuthGenerator(options){
	this.options = options || {};
}

XOAuthGenerator.prototype.generate = function(callback){
	return generateXOAuthStr(this.options, callback);
};

function escapeAndJoin(arr){
	return arr.map(encodeURIComponent).join("&");
}

function hmacSha1(str, key){
	var hmac = crypto.createHmac("sha1", key);
	hmac.update(str);
	return hmac.digest("base64");
}

function initOAuthParams(options){
	return {
			oauth_consumer_key: options.consumerKey || "anonymous",
			oauth_nonce: options.nonce || "" + Date.now() + Math.round(Math.random()*1000000),
			oauth_signature_method: "HMAC-SHA1",
			oauth_version: "1.0",
			oauth_timestamp: options.timestamp || "" + Math.round(Date.now()/1000)
		};
}

function generateOAuthBaseStr(method, requestUrl, params){
	var reqArr = [method, requestUrl].concat(Object.keys(params).sort().map(function(key){
			return key + "=" + encodeURIComponent(params[key]);
		}).join("&"));
	
	return escapeAndJoin(reqArr);
}

function generateXOAuthStr(options, callback){
	options = options || {};
	
	var params = initOAuthParams(options),
		requestUrl = options.requestUrl || "https://mail.google.com/mail/b/" + (options.user || "") + "/smtp/",
		baseStr, signatureKey, paramsStr, returnStr;
	
	if(options.token){
		params.oauth_token = options.token;
	}
	
	baseStr = generateOAuthBaseStr(options.method || "GET", requestUrl, params);
	
	signatureKey = escapeAndJoin([options.consumerSecret || "anonymous", options.tokenSecret]);
	params.oauth_signature = hmacSha1(baseStr, signatureKey);

	paramsStr = Object.keys(params).sort().map(function(key){
		return key+"=\""+encodeURIComponent(params[key])+"\"";
	}).join(",");
	
	returnStr = [options.method || "GET", requestUrl, paramsStr].join(" ");
	
	if(typeof callback == "function"){
		callback(null, new Buffer(returnStr, "utf-8").toString("base64"));
	}else{
		return new Buffer(returnStr, "utf-8").toString("base64");
	}
}