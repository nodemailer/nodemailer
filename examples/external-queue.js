/* eslint no-console: 0 */

'use strict';

var nodemailer = require('../lib/nodemailer');

// Create a SMTP transporter object
var transporter = nodemailer.createTransport({
    pool: true,
    service: 'Gmail',
    auth: {
        user: 'test.nodemailer@gmail.com',
        pass: 'Nodemailer123'
    },
    logger: true, // log to console
    debug: true // include SMTP traffic in the logs
}, {
    // default message fields

    // sender info
    from: 'Sender Name <sender@example.com>',
    headers: {
        'X-Laziness-level': 1000 // just an example header, no need to use this
    }
});

console.log('SMTP Configured');

// Mock message queue. In reality you would be fetching messages from some external queue
var messages = [{
    to: '"Receiver Name" <receiver@example.com>',
    subject: 'Nodemailer is unicode friendly ✔', //
    text: 'Hello to myself!',
    html: '<p><b>Hello</b> world!</p>'
}];

// send mail only if there are free connection slots available
transporter.on('idle', function () {
    // if transporter is idling, then fetch next message from the queue and send it
    while (transporter.isIdle() && messages.length) {
        console.log('Sending Mail');
        transporter.sendMail(messages.shift(), function (error, info) {
            if (error) {
                console.log('Error occurred');
                console.log(error.message);
                return;
            }
            console.log('Message sent successfully!');
            console.log('Server responded with "%s"', info.response);
        });
    }
});
