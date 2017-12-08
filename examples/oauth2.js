/* eslint no-console: 0 */

'use strict';

const bunyan = require('bunyan');
const nodemailer = require('../lib/nodemailer');

let logger = bunyan.createLogger({
    name: 'nodemailer'
});
logger.level('trace');

// Create a SMTP transporter object
let transporter = nodemailer.createTransport(
    {
        service: 'Gmail',
        auth: {
            type: 'OAuth2',
            user: 'mail',
            clientId: 'clientid',
            clientSecret: 'clientsecret',
            refreshToken: 'refreshtoken',
            accessToken: 'accesstoken',
            expires: 12345
        },
        logger,
        debug: true // include SMTP traffic in the logs
    },
    {
        // default message fields

        // sender info
        from: 'Testbox <andristestbox@gmail.com>',
        headers: {
            'X-Laziness-level': 1000 // just an example header, no need to use this
        }
    }
);

console.log('SMTP Configured');

// Message object
let message = {
    // Comma separated list of recipients
    to: 'Andris Reinman <andris.reinman@gmail.com>',

    // Subject of the message
    subject: 'Nodemailer is unicode friendly ✔ #', //

    // plaintext body
    text: 'Hello to myself!',

    // HTML body
    html:
        '<p><b>Hello</b> to myself <img src="cid:note@example.com"/></p>' +
        '<p>Here\'s a nyan cat for you as an embedded attachment:<br/><img src="cid:nyan@example.com"/></p>',

    // Apple Watch specific HTML body
    watchHtml: '<b>Hello</b> to myself',

    // An array of attachments
    attachments: [
        // String attachment
        {
            filename: 'notes.txt',
            content: 'Some notes about this e-mail',
            contentType: 'text/plain' // optional, would be detected from the filename
        },

        // Binary Buffer attachment
        {
            filename: 'image.png',
            content: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/' +
                    '//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U' +
                    'g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
                'base64'
            ),

            cid: 'note@example.com' // should be as unique as possible
        },

        // File Stream attachment
        {
            filename: 'nyan cat ✔.gif',
            path: __dirname + '/assets/nyan.gif',
            cid: 'nyan@example.com' // should be as unique as possible
        }
    ]
};

console.log('Sending Mail');
transporter.sendMail(message, (error, info) => {
    if (error) {
        console.log('Error occurred');
        console.log(error.message);
        return;
    }
    console.log('Message sent successfully!');
    console.log('Server responded with "%s"', info.response);
    transporter.close();
});
