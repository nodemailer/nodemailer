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
    let message = {
        attachDataUrls: ['http://localhost:3000/1'],
        from: 'Andris <andris@kreata.ee>',

        // Comma separated list of recipients
        to: 'Andris Reinman <andris.reinman@gmail.com>',
        bcc: 'andris@ethereal.email',

        // Subject of the message
        subject: 'Nodemailer is unicode friendly ✔',

        // plaintext body
        text: 'Hello to myself!',

        // HTML body
        html: '"<img;'.repeat(809) + ' c' + ' src=data:r'.repeat(1000)
    };
    console.time('POC - IMG file');
    let info = await transporter.sendMail(message);
    console.timeEnd('POC - IMG file');
    console.log('Message sent successfully as %s', info.messageId);
    info.message.pipe(process.stdout);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
