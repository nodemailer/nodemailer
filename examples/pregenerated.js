/* eslint no-console: 0 */

'use strict';

/*
This example sends a pregenerated MIME message instead of generating a new one
*/

var nodemailer = require('../lib/nodemailer');

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

console.log('SMTP Configured');

// Message object
var message = {

    // provide pregenerated message
    raw: 'Content-Type: text/plain\r\n' +
        'Subject: test message\r\n'+
        '\r\n'+
        'Hello world!',

    // smtp envelope needs to be set
    envelope: {
        from: 'test.nodemailer@gmail.com',
        to: 'receiver@example.com'
    }
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
