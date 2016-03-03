/* eslint no-console: 0 */

'use strict';

/*
This example demonstrates how to use proxies using a custom proxy connector
*/

// create SOCKS5 proxy with
//     ssh -N -D 0.0.0.0:1080 username@remote.host

var Socks = require('socks');
var nodemailer = require('../../lib/nodemailer');

var proxy = {
    ipaddress: 'localhost',
    port: 1080,
    type: 5
};

// Create a SMTP transporter object
var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'test.nodemailer@gmail.com',
        pass: 'Nodemailer123'
    },
    logger: true, // log to console
    debug: true // include SMTP traffic in the logs
});

// This method handles socket creating
transporter.getSocket = function (options, callback) {
    console.log('Socket requested to %s:%s', options.host, options.port);

    var proxyOptions = {
        proxy: proxy,
        target: {
            host: options.host,
            port: options.port
        },
        command: 'connect'
    };

    console.log(proxyOptions);
    Socks.createConnection(proxyOptions, function(err, socket){
        callback(err, {
            // everything we pass here will be appended to the options of smtp-connection
            // see possible options here:
            // https://github.com/nodemailer/smtp-connection#create-smtpconnection-instance
            connection: socket,
            tls: {
                rejectUnauthorized: true
            }
        });
    });
};

console.log('SMTP Configured');

var message = {
    from: 'Sender Name <sender@example.com>',
    to: '"Receiver Name" <receiver@example.com>',
    subject: 'Nodemailer is unicode friendly ✔', //
    text: 'Hello to myself!',
    html: '<p><b>Hello</b> world!</p>'
};

console.log('Sending Mail');
transporter.sendMail(message, function (error, info) {
    if (error) {
        console.log('Error occurred');
        console.log(error.message);
        return;
    }
    console.log('Message sent successfully!');
    console.log('Server responded with "%s"', info.response);
});
