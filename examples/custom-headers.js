/* eslint no-console: 0 */

'use strict';

const nodemailer = require('../lib/nodemailer');

// Create a SMTP transporter object
let transporter = nodemailer.createTransport(
    {
        streamTransport: true,
        newline: 'unix',
        buffer: true,
        // use a normalizer method for header keys
        normalizeHeaderKey: key => key.toUpperCase()
    },
    {
        // default message fields

        // sender info
        from: 'Pangalink <no-reply@pangalink.net>',
        headers: {
            'X-Laziness-level': 1000 // just an example header, no need to use this
        }
    }
);

// Message object
let message = {
    // Comma separated list of recipients
    to: 'Andris Reinman <andris.reinman@gmail.com>',

    // Subject of the message
    subject: 'Nodemailer is unicode friendly ✔',

    // plaintext body
    text: 'Hello to myself!',

    // HTML body
    html: '<p><b>Hello</b> to myself <img src="cid:note@example.com"/></p>',

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
        }
    ]
};

transporter.sendMail(message, (error, info) => {
    if (error) {
        console.log('Error occurred');
        console.log(error.message);
        return process.exit(1);
    }

    console.log(info.envelope);
    console.log(info.messageId);
    console.log(info.message.toString());
});
