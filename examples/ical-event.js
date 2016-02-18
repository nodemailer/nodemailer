/* eslint no-console: 0 */

'use strict';

/*
This example sends a message with an attached icalendar event

Attached calendar events inside mime message are formatted identically to
calendar events sent from office365, eg. a single alternative encoded in base64
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

// Message object
var message = {
    from: '"Sender Name" <sender@example.com>',
    to: '"Receiver Name" <receiver@example.com>',
    subject: 'Calendar invite',
    text: 'This message contains a calendar event',
    icalEvent: {
        method: 'request',
        // content can be a string, a buffer or a stream
        // alternatively you could use `path` that points to a file or an url
        content: 'BEGIN:VCALENDAR\r\nPRODID:-//ACME/DesktopCalendar//EN\r\nMETHOD:REQUEST\r\nVERSION:2.0\r\n...'
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
