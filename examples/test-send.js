/* eslint no-console: 0 */

'use strict';

const nodemailer = require('../lib/nodemailer');

// Create a SMTP transporter object
let transporter = nodemailer.createTransport({
    host: 'smtp.zoho.eu',
    port: 465,
    secure: true,
    logger: true,
    debug: true,
    auth: {
        user: 'project.1',
        pass: 'secret.1'
    }
});

transporter = nodemailer.createTransport({
    service: 'gmail',
    logger: true,
    debug: true,
    auth: {
        user: 'andris.reinman@gmail.com',
        pass: 'pajhpkpwjjnruqfn'
    }
});

// Message object
let message = {
    from: 'andristest@zone.ee', //'Nodemailer <example@nodemailer.com>',

    // Comma separated list of recipients
    to: 'andris@ekiri.ee', //'Nodemailer <example@nodemailer.com>, aaa@65tajh.catchall.delivery',

    // Subject of the message
    subject: 'Nodemailer is unicode friendly ✔' + Date.now(),

    // plaintext body
    text: 'Hello to myself!',

    // HTML body
    html: `<p><b>Hello</b> to myself <img src="cid:note@example.com"/></p>
        <p>Here's a nyan cat for you as an embedded attachment:<br/><img src="cid:nyan@example.com"/></p>`,

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
    /*
    list: {
        // List-Help: <mailto:admin@example.com?subject=help>
        help: 'admin@example.com?subject=help',

        // List-Unsubscribe: <http://example.com> (Comment)
        unsubscribe: [
            {
                url: 'http://example.com/unsubscribe',
                comment: 'A short note about this url'
            },
            'unsubscribe@example.com'
        ],

        // List-ID: "comment" <example.com>
        id: {
            url: 'mylist.example.com',
            comment: 'This is my awesome list'
        }
    }
    */
};

transporter.sendMail(message, (error, info) => {
    if (error) {
        console.log('Error occurred');
        console.log(error.message);
        return process.exit(1);
    }

    console.log('Message sent successfully!');
    console.log(info);

    // only needed when using pooled connections
    transporter.close();
});
