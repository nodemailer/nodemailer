// Target API:
//
//  var s = require('net').createStream(25, 'smtp.example.com');
//  s.on('connect', function() {
//   require('starttls')(s, options, function() {
//      if (!s.authorized) {
//        s.destroy();
//        return;
//      }
//
//      s.end("hello world\n");
//    });
//  });
//
//

module.exports = function starttls(socket, options, cb) {

    var sslcontext = require('crypto').createCredentials(options),
        pair = require('tls').createSecurePair(sslcontext, false),
        cleartext = pipe(pair, socket);

    pair.on('secure', function() {
        var verifyError = (pair._ssl || pair.ssl).verifyError();

        if (verifyError) {
            cleartext.authorized = false;
            cleartext.authorizationError = verifyError;
        } else {
            cleartext.authorized = true;
        }

        if (cb) cb();
    });

    cleartext._controlReleased = true;
    return cleartext;
};

function forwardEvents(events,emitterSource,emitterDestination) {
    var map = {}, name, handler;
    for(var i = 0; i < events.length; i++) {
        name = events[i];
        handler = (function generateForwardEvent(){
            return function forwardEvent(name) {
                return emitterDestination.emit.apply(emitterDestination, arguments);
            }
        })(name);
        map[name] = handler;
        emitterSource.on(name, handler);
    }
    return map;
}

function removeEvents(map,emitterSource) {
    for(var k in map) {
        emitterSource.removeListener(k,map[k])
    }
}

function pipe(pair, socket) {
    pair.encrypted.pipe(socket);
    socket.pipe(pair.encrypted);

    pair.fd = socket.fd;
    
    var cleartext = pair.cleartext;
  
    cleartext.socket = socket;
    cleartext.encrypted = pair.encrypted;
    cleartext.authorized = false;

    function onerror(e) {
        if (cleartext._controlReleased) {
            cleartext.emit('error', e);
        }
    }

    var map = forwardEvents(["timeout","end","close"], socket, cleartext);
  
    function onclose() {
        socket.removeListener('error', onerror);
        socket.removeListener('close', onclose);
        removeEvents(map,socket)
    }

    socket.on('error', onerror);
    socket.on('close', onclose);

    return cleartext;
}