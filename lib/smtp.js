var netlib = require("net"),
    fslib = require("fs"),
    utillib = require("util"),
    oslib = require('os'),
    tlslib = require('tls'),
    EventEmitter = require('events').EventEmitter;

/**
 * smtp
 * 
 * This module handles the connection and message passing to a SMTP
 * server. SMTP is a simple text based protocol. Server is usually listening
 * on port 25. The client opens up a connection to the server,
 * server responds with "220 hostname message" thus indicating that
 * it is up and working. All server messages begin with a status code,
 * where codes starting with 4 or 5 are errors and 2 and 3 are normal states.
 * Most commands can't be used before a successful HELO or EHLO response.
 * E-mail message is ended with a single period on a line of itself. To not
 * create confusion, all periods in the beginning of ordinary lines should
 * be replaced with double periods. "\r\n.this" -> "\r\n..this"
 * 
 * Actual recipients for the message are not taken from the message source
 * (To: Cc: and Bcc: fields) but from RCPT TO: commands. If there is more than
 * one recipient then the command can be entered multiple times.
 * 
 *     {client establishes connection to the server}
 *     S: 220 node.ee
 *     C: HELO client.hostname
 *     S: 250 Hello client.hostname
 *     C: MAIL FROM:<andris@node.ee>
 *     S: 250 Ok
 *     C: RCPT TO:<andris@kreata.ee>
 *     S: 250 Ok
 *     C: RCPT TO:<andris.reinman@gmail.com>
 *     S: 250 Ok
 *     C: DATA
 *     S: 354 End with <CR><LF>.<CR><LF>
 *     C: From: Andris Reinman <andris@node.ee>\r\n
 *        To: Andris Reinman <andris@kreata.ee>\r\n
 *        Cc: Andris Reinman <andris.reinman@gmail.com>\r\n
 *        Subject: Test\r\n
 *        \r\n
 *        Hello, I'm sending myself a test message\r\n
 *        .\r\n
 *     S: 250 Ok: queued as B7AD718D9DFF
 *     C: QUIT
 *     S: 221 Good bye
 *     {the server closes the connection} 
 * 
 **/

// expose constructor SMTPClient to the world
exports.SMTPClient = SMTPClient;


/**
 * new smtp.SMTPClient(host, port[, options])
 * - host (String): SMTP server hostname
 * - port (Number): SMTP server port
 * - options (Object): optional additional settings
 * 
 * Constructs a wrapper for a SMTP connection as an EventEmitter type object.
 * 
 * options can include following data:
 * 
 * - hostname (String): hostname of the sending server, needed for handshake
 *   defaults to OS hostname or "localhost"
 * - use_authorization (Boolean): is authorization needed, default is false
 * - ssl (Boolean): use SSL (port 465)
 * - user (String): the username if authorization is needed
 * - pass (String): the password if authorization is needed
 * 
 * Authorization is somewhat problematic with Node.JS v0.3.x since it doesn't
 * support setSecure which is needed to enter TLS state AFTER non-encrypted
 * SMTP handshake. Most servers doesn't accept plaintext passwords without TLS. 
 * 
 * Supported events:
 * 
 * - 'connect' if a connection is opened successfully 
 * - 'error' if an uncatched error occurs
 * - 'close' when the connection closes
 *     
 **/
function SMTPClient(host, port, options){
    
    // Needed to convert this constructor into EventEmitter
    EventEmitter.call(this);
    
    // Public properties
    // -----------------
    this.host = host || "localhost";
    this.options = options || {};
    this.port = port || (this.options.ssl && 465 || 25);
    
    // defaul hostname is machine hostname or [IP]
    var defaultHostname = ("hostname" in oslib && oslib.hostname()) || 
                          ("getHostname" in oslib && oslib.getHostname()) ||
                          "";
    if(defaultHostname.indexOf('.')<0){
        defaultHostname = "[127.0.0.1]";
    }
    if(defaultHostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)){
        defaultHostname = "["+defaultHostname+"]";
    }
    
    this.hostname = this.options.hostname || defaultHostname;

    this.debug = !!this.options.debug;

    this.remote_pipelining = false; // Is pipelining enabled
    this.remote_starttls = false;   // Is TLS enabled, currently no effect
    this.remote_extended = true;    // Does the server support EHLO or HELO

    // Not so public properties
    // ------------------------
    this._connected = false;   // Indicates if an active connection is available
    this._connection = false;  // Holds connection info
    this._callbackQueue = [];  // Queues the responses FIFO (needed for pipelining)
    this._data_remainder = []; // Needed to group multi-line messages from server
    this._timeoutTimer = null;
}
// Needed to convert this constructor into EventEmitter
utillib.inherits(SMTPClient, EventEmitter);

///////////// PUBLIC METHODS /////////////

/**
 * smtp.SMTPClient#send(data, callback) -> undefined
 * - data (String): text to be sent to the SMTP server
 * - callback (Function): callback to be used, gets params error and message
 * 
 * Main method for the SMTPClient object. Sends a string to the server and
 * if callback is set returns the response. If callback is not set then
 * the endline chars \r\n are not appended automatically
 * 
 * NB! This function is Pipelining safe but you should check the support for
 * it if needed (#remote_pipelining).
 * 
 * Usage:
 * 
 *     smtpclient.send("EHLO hostname", function(error, message){
 *         if(error){
 *             console.log("Server responded with error "+error.message);
 *         }else{
 *             console.log("Server responded with "+message);
 *         }
 *     });
 * 
 *     smtpclient.send("From: andris@node.ee\r\nTo: andris@kreata.ee\r\nSubject: test\r\n");
 * 
 * If there is no connection to the SMTP server, one is created automatically
 **/
SMTPClient.prototype.send = function(data, callback){

    if(!this._connected){
        return this._createConnection(this.send.bind(this, data, callback));
    }

    if(callback){
        this._sendCommand(data, callback);
    }else{
        this._sendData(data);
    }

}

/**
 * smtp.SMTPClient#close() -> undefined
 * 
 * Closes the current connection to the server. For some reason needed after
 * the e-mail is sent (with QUIT) but might be server specific.
 **/
SMTPClient.prototype.close = function(){
    this._connected && this._connection && this._connection.end();
    this._connected = false;
};

///////////// PRIVATE METHODS /////////////

/**
 * smtp.SMTPClient#_sendCommand(data, callback) -> undefined
 * - data (String): string value to be sent to the SMTP server
 * - callback (Function): function to be run after the server has responded
 * 
 * Sends a string to the server, appends \r\n to the end so this is not
 * meant to send data (mail body) but comands.
 **/
SMTPClient.prototype._sendCommand = function(data, callback){
    this._callbackQueue.push({callback: callback});
    this._connection.write(data+"\r\n");
    
    if(this.debug)
        console.log("SEND:\n"+JSON.stringify(data+"\r\n"));
}

/**
 * smtp.SMTPClient#_sendData(data) -> undefined
 * - data (String): Text to be sent to the server
 * 
 * Sends a string to the server. This is meant to send body data and such.
 **/
SMTPClient.prototype._sendData = function(data){
    this._connection.write(data);
    
    if(this.debug)
        console.log("SEND:\n"+JSON.stringify(data));
}

/**
 * smtp.SMTPClient#_loginHandler(callback) -> undefined
 * - callback (Function): function to be run after successful login
 * 
 * If authentication is needed, performs AUTH PLAIN and runs the
 * callback function after success or emits error on fail.
 * This method is called by #_handshake after successful connection
 * 
 * Callback is set by the caller of #_createConnection which forwards it
 * to #_handshake whic in turn forwards it to #_loginHandler
 **/
SMTPClient.prototype._loginHandler = function(callback){
    //FIXME: Plaintext AUTH generally needs TSL support, problematic with Node.JS v0.3
    
    if(!this.options.use_authentication){
        callback();
    }else{
        this.send("AUTH PLAIN "+new Buffer(
          this.options.user+"\u0000"+
          this.options.user+"\u0000"+
          this.options.pass).toString("base64"), (function(error, message){
            if(error){
                this.emit("error", error);
                this.close();
                return;
            }
            // login success
            callback();
        }).bind(this));
    }
}

/**
 * smtp.SMTPClient#_dataListener(data) -> undefined
 * - data(String): String received from the server
 * 
 * The default listener for incoming server messages. Checks if there's
 * no errors and runs a callback function from #_callbackQueue.
 * If the first char of the response is higher than 3 then the response
 * is considered erroneus.
 **/
SMTPClient.prototype._dataListener = function(data){
    var action = this._callbackQueue.shift();
    if(action && action.callback){
        if(parseInt(data.trim().charAt(0),10)>3){
            action.callback(new Error(data), null);
        }else{
            action.callback(null, data);
        }
    }else{
        if(parseInt(data.trim().charAt(0),10)>3){
            this.emit("error", new Error(data));
            this.close();
        }else{
            // what the hell just happened? this should never occur
        }
    }
}

/**
 * smtp.SMTPClient#_handshakeListener(data) -> undefined
 * - data(String): String received from the server
 * 
 * Server data listener for the handshake - waits for the 220 response
 * from the server (connection established).
 **/
SMTPClient.prototype._handshakeListener = function(data, callback){
    if(this.debug)
        console.log("CONNECTION: "+data.toString("utf-8").trim());
    if(data.toString("utf-8").trim().substr(0,3)=="220"){
        this._connected = true; // connection established
        
        if(this.debug)
            console.log("Connection established!");
        
        this._handshake(callback);
    }else{
        
        if(this.debug)
            console.log("Connection failed!");
        
        var error = new Error("Server responded with "+data);
        this.emit("error", error);
        this.close();
        return;
    }
}

/**
 * smtp.SMTPClient#_handshake(callback) -> undefined
 * - callback (Function): will be forwarded to login after successful connection
 * 
 * Will be run after a TCP connection to the server is established. Makes
 * a EHLO command (fallbacks to HELO on failure) and forwards the callback to
 * login function on success.
 **/
SMTPClient.prototype._handshake = function(callback){
    
    this.emit("connect");
    this._sendCommand("EHLO "+this.hostname, (function(error, data){
        if(error){

            // fallback to HELO
            this._sendCommand("HELO "+this.hostname, (function(error, data){
                if(error){
                    this.emit("error", error);
                    this.close();
                    return;
                }
                this.remote_extended = false;
                this._loginHandler(callback);    
            }).bind(this));
            
        }
        
        // check for pipelining support
        if(data.match(/PIPELINING/i)){
            this.remote_pipelining = true;
        }
        
        // check for TLS support
        if(data.match(/STARTTLS/i)){
            this.remote_starttls = true;
        }

        // check login after successful handshake
        this._loginHandler(callback);
    }).bind(this));
}

/**
 * smtp.SMTPClient#_waitForTimeout() -> function
 * 
 * Waits for 10 seconds after connection and if nothing happened emits an error
 **/
SMTPClient.prototype._waitForTimeout = function(){
    this._timeoutTimer = setTimeout((function(){
        this.emit("error", new Error("Timeout waiting for response from server"));
        this.close();
    }).bind(this), 0.1*1000);
}

/**
 * smtp.SMTPClient#_onData(data) -> function
 * - callback (Function): callback function to be used with connection
 * - data (Buffer): binary data from the server
 * 
 * Receives binary data from the server, converts it to string and forwards
 * to a registered listener. Concatenates multiline messages etc.
 **/
SMTPClient.prototype._onData = function(callback, data){

    clearTimeout(this._timeoutTimer);

    if(!this._connected){
        return this._handshakeListener(data, callback);
    }
    
    if(this.debug)
        console.log("RECEIVE:\n"+JSON.stringify(data.toString("utf-8")));
    
    var lines = data.toString("utf-8").split("\r\n"), i, length, parts;
    for(i=0, length=lines.length; i<length; i++){
        if(!lines[i].trim())
            continue;
        
        this._data_remainder.push(lines[i]);
        
        parts = lines[i].match(/^\d+(.)/);
        if(parts && parts[1]==" "){
            this._dataListener(this._data_remainder.join("\r\n"));
            this._data_remainder = [];
        }
    }
}

/**
 * smtp.SMTPClient#_createConnection(callback) -> function
 * - callback (Function): function to be run after successful connection,
 *   smtp handshake and login
 * 
 * Creates a TCP connection to the SMTP server and sets up needed listeners.
 **/
SMTPClient.prototype._createConnection = function(callback){
    if (this.options.ssl) {
		this._connection = tlslib.connect(this.port, this.host);
	} else {
	    this._connection = netlib.createConnection(this.port, this.host);
	}

    this._connection.on("end", (function(){
        this._connected = false;
    }).bind(this));
    
    this._connection.on("close", (function(){
        this._connected = false;
        this.emit("close");
    }).bind(this));
    
    this._connection.on("timeout", (function(){
        this.close();
    }).bind(this));
    
    this._connection.on("error", (function(error){
        this.emit("error", error);
        this.close();
    }).bind(this));
    
    this._connection.on("connect", this._waitForTimeout.bind(this));
    this._connection.on("data", this._onData.bind(this, callback));
}