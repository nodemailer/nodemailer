/* eslint no-console: 0 */

'use strict';

var nodemailer = require('../../lib/nodemailer');
var stubTransport = require('nodemailer-stub-transport');

// Create a transporter object
var transporter = nodemailer.createTransport(stubTransport());

// Create a template based sender
var templateSender = transporter.templateSender({
    // rendered fields
    subject: 'Hello {{name}}!',
    text: 'This message is for {{name}}.',
    html: '<p>This message is for {{name}}.</p>'
}, {
    // default fields for all messages send using this template
    from: 'sender@gmail.com'
});

console.log('Template Configured');

// Message object, add mail specific fields here
var message = {
    to: 'receiver@example.com'
};

// context for the template renderer
var context = {
    name: 'Receiver Name'
};

console.log('Sending Mail');
// send using template
templateSender(message,  context, function (error, info) {
    if (error) {
        console.log('Error occurred');
        console.log(error.message);
        return;
    }
    // print rfc822 message to console
    console.log('Generated mime-message source:\n%s', info.response.toString());
});
