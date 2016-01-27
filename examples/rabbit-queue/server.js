/* eslint no-console: 0 */

'use strict';

// This script runs a local SMTP server for testing

var SMTPServer = require('smtp-server').SMTPServer;
var crypto = require('crypto');

var counter = 0;

// Setup server
var server = new SMTPServer({

    logger: false,

    // not required but nice-to-have
    banner: 'Welcome to My Nodemailer testserver',

    // Accept messages up to 10 MB
    size: 10 * 1024 * 1024,

    // Setup authentication
    // Allow only users with username 'testuser' and password 'testpass'
    onAuth: function (auth, session, callback) {
        // check username and password
        if (auth.username === 'testuser' && auth.password === 'testpass') {
            return callback(null, {
                user: 'userdata'
            });
        }
        return callback(new Error('Authentication failed'));
    },

    // Handle message stream
    onData: function (stream, session, callback) {
        var bytesize = 0;
        var hash = crypto.createHash('md5');
        stream.on('readable', function () {
            var chunk;
            while ((chunk = stream.read()) !== null) {
                bytesize += chunk.length;
                hash.update(chunk);
            }
        });
        stream.on('end', function () {
            var err;
            if (stream.sizeExceeded) {
                err = new Error('Error: message exceeds fixed maximum message size 10 MB');
                err.responseCode = 552;
                return callback(err);
            }
            hash = hash.digest('hex');
            console.log('Received %s byte message %s (%s)', bytesize, hash, ++counter);
            callback(null, 'Message hash ' + hash);
        });
    }
});

server.on('error', function (err) {
    console.log(err.stack);
});

// start listening
server.listen(2525);
