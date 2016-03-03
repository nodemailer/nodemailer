/* eslint no-console: 0 */

'use strict';

/*
This example demonstrates how to use a HTTP proxy
*/

var nodemailer = require('../../lib/nodemailer');

// Assumes HTTP/S proxy (eg. Squid) running on port 3128
// NB! The proxy must allow CONNECT tunnels to SMTP ports

// Create a SMTP transporter object
var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'test.nodemailer@gmail.com',
        pass: 'Nodemailer123'
    },
    logger: true, // log to console
    debug: true, // include SMTP traffic in the logs

    // define proxy configuration
    proxy: 'http://localhost:3128/'
});

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
