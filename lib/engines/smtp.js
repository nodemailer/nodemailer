"use strict";

var wellKnownHosts = require("../wellknown"),
    simplesmtp = require("simplesmtp"),
    wellKnownDomains = {};

// Expose to the world
module.exports = SMTPTransport;

// Convert Wellknown keys to lowercase
wellKnownHosts = Object.keys(wellKnownHosts).reduce(function(lowerCaseKeys, currentKey){

    [].concat(wellKnownHosts[currentKey].domains || []).forEach(function(domain){
        wellKnownDomains[domain] = currentKey.toLowerCase().trim();
    });

    lowerCaseKeys[currentKey.toLowerCase().trim()] = wellKnownHosts[currentKey];
    return lowerCaseKeys;
},{});

/**
 * <p>Generates a Transport object for SMTP</p>
 *
 * <p>NB! This is a pool of connections that try to keep themselves alive. The
 * connection is not closed to the server once the message is delivered.</p>
 *
 * <p>Possible options can be the following:</p>
 *
 * <ul>
 *     <li><b>service</b> - a well known service identifier ("Gmail", "Hotmail"
 *         etc.) for auto-completing host, port and secure connection settings</li>
 *     <li><b>host</b> - hostname of the SMTP server</li>
 *     <li><b>port</b> - port of the SMTP server</li>
 *     <li><b>secureConnection</b> - use SSL</li>
 *     <li><b>name</b> - the name of the client server</li>
 *     <li><b>authMethod</b> -specified the authMethod, value can be ["plain", "login"], default is "plain"</li>
 *     <li><b>auth</b> - authentication object as <code>{user:"...", pass:"..."}</code>
 *     <li><b>ignoreTLS</b> - ignore server support for STARTTLS</li>
 *     <li><b>debug</b> - output client and server messages to console</li>
 *     <li><b>maxConnections</b> - how many connections to keep in the pool</li>
 *     <li><b>maxMessages</b> - limit the count of messages to send through a single connection</li>
 * </ul>
 *
 * @constructor
 * @param {Object} [options] SMTP options
 */
function SMTPTransport(options){


    this.options = options || {};

    this.initOptions();

    this.pool = simplesmtp.createClientPool(this.options.port,
        this.options.host, this.options);
}

SMTPTransport.wellKnownHosts = wellKnownHosts;

/**
 * <p>Initializes the SMTP connection options. Needed mostly for legacy option
 * values and also for filling in the well known hosts data if needed.</p>
 */
SMTPTransport.prototype.initOptions = function(){
    var keys, key, i, len, service;

    // provide support for legacy API
    if(this.options.use_authentication === false){
        this.options.auth = false;
    }else if(this.options.user || this.options.pass || this.options.XOAuthToken){
        if(!this.options.auth){
            this.options.auth = {};
        }
        this.options.authMethod = this.options.authMethod || "PLAIN";
        this.options.auth.user = this.options.auth.user || this.options.user;
        this.options.auth.pass = this.options.auth.pass || this.options.pass;
        this.options.auth.XOAuthToken = this.options.auth.XOAuthToken || this.options.XOAuthToken;
        this.options.auth.XOAuth2 = this.options.auth.XOAuth2 || this.options.XOAuth2;
    }

    if(this.options.ssl){
        this.options.secureConnection = true;
    }

    if(this.options.tls === false){
        this.options.ignoreTLS = true;
    }

    // lets be modest just in case
    this.options.maxConnections = this.options.maxConnections || 5;

    // detect service from the e-mail address if host is not provided before falling to localhost
    if(!this.options.host && !this.options.port && !this.options.service && this.options.auth && this.options.auth.user){
        this.options.service = wellKnownDomains[(this.options.auth.user || "").toString().split("@").pop().toLowerCase().trim()] || false;
    }

    // use well known settings if service is defined
    if((service = this.options.service) && (service = service.toString().toLowerCase().trim()) && wellKnownHosts[service]){
        keys = Object.keys(wellKnownHosts[service]);
        for(i=0, len=keys.length; i<len; i++){
            key = keys[i];
            this.options[key] = this.options[key] ||
                    wellKnownHosts[service][key];
        }
    }
};

/**
 * <p>Forwards the mailcomposer message object to the simplesmpt client pool</p>
 *
 * @param {Object} emailMessage MailComposer object
 * @param {Function} callback Callback function to run when the sending is completed
 */
SMTPTransport.prototype.sendMail = function(emailMessage, callback){
    // force SMTP encoding
    emailMessage.options.escapeSMTP = true;

    if(this.options.requiresAuth &&
      (!this.options.auth || !((this.options.auth.user && this.options.auth.pass) || this.options.auth.XOAuth2 || this.options.auth.XOAuthToken))){
        return typeof callback == "function" &&
            callback(new Error("Authentication required, invalid details provided"));
    }

    this.pool.sendMail(emailMessage, callback);
};

/**
 * <p>Closes the client pool</p>
 *
 * @param {Function} callback Callback function to run once the pool is closed
 */
SMTPTransport.prototype.close = function(callback){
    this.pool.close(callback);
};
