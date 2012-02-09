
var wellKnownHosts = require("../wellknown"),
    simplesmtp = require("simplesmtp");


module.exports = SMTPTransport;

function SMTPTransport(options){
    var keys, key, i, len;
    
    this.options = options || {};
    
    this.initOptions();
    
    this.pool = simplesmtp.createClientPool(this.options.port, 
        this.options.host, this.options);
}

SMTPTransport.prototype.initOptions = function(){
    // provide support for legacy API
    if(this.options.use_authentication === false){
        delete this.options.auth;
        delete this.options.user;
        delete this.options.pass;
    }else if(this.options.user || this.options.pass){
        if(!this.options.auth){
            this.options.auth = {};
        }
        this.options.auth.user = this.options.auth.user || this.options.user;
        this.options.auth.pass = this.options.auth.pass || this.options.pass;
        delete this.options.user;
        delete this.options.pass;
    }
    
    if(this.options.ssl){
        this.options.secureConnection = true;
        delete this.options.ssl;
    }
    
    if(this.options.tls === false){
        this.options.ignoreTLS = true;
        delete this.options.tls;
    }
    
    // lets be modest just in case
    this.options.maxConnections = this.options.maxConnections || 1;
    
    // use well known settings if service is defined
    if(this.options.service && wellKnownHosts[this.options.service]){
        keys = Object.keys(wellKnownHosts[this.options.service]);
        for(i=0, len=keys.length; i<len; i++){
            key = keys[i];
            this.options[key] = this.options[key] || 
                    wellKnownHosts[this.options.service][key];
        }
    }
}

SMTPTransport.prototype.sendMail = function(emailMessage, callback){
    if(this.options.requiresAuth && 
      (!this.options.auth || !this.options.auth.user || !this.options.auth.pass)){
        return callback(new Error("Authentication required, invalid details provided"));
    }
    
    this.pool.sendMail(emailMessage, callback);
}

SMTPTransport.prototype.close = function(callback){
    this.pool.close(callback);
}