/* eslint no-console: 0 */

'use strict';

const nodemailer = require('../lib/nodemailer');

async function main() {
    // Create a SMTP transporter object
    let transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'windows',
        logger: false
    });

    // Message object
    // Message object
    let message = {
        from: 'Andris <andris@kreata.ee>',

        // Comma separated list of recipients
        to: 'Andris Reinman <andris.reinman@gmail.com>',
        bcc: 'andris@ethereal.email',

        // Subject of the message
        subject: 'Nodemailer is unicode friendly ✔',

        // plaintext body
        text: 'Hello to myself!',

        // HTML body
        html:
            '<p><b>Hello</b> to myself <img src="cid:note@example.com"/></p>' +
            '<p>Here\'s a nyan cat for you as an embedded attachment:<br/><img src="cid:nyan@example.com"/></p>',

        // An array of attachments
        attachments: [
            {
                filename: 'Embeded file',
                path: 'data:' + ';t'.repeat(60000)
            }
        ]
    };
    console.log(message);
    console.time('POC - Embedded file');
    let info = await transporter.sendMail(message);
    console.timeEnd('POC - IMG file');
    console.log('Message sent successfully as %s', info.messageId);
    info.message.pipe(process.stdout);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
