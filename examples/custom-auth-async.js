/* eslint no-console: 0 */

'use strict';

const nodemailer = require('../lib/nodemailer');

async function main() {
    // Generate SMTP service account from ethereal.email
    let account = await nodemailer.createTestAccount();

    console.log('Credentials obtained, sending message...');

    // NB! Store the account object values somewhere if you want
    // to re-use the same account for future mail deliveries

    // Create a SMTP transporter object
    let transporter = nodemailer.createTransport(
        {
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            auth: {
                type: 'custom',

                user: account.user,
                pass: account.pass,

                method: 'x-login' // force custom method instead of choosing automatically from available methods
            },
            logger: false,
            debug: false, // if true then include SMTP traffic in the logs

            customAuth: {
                // can create multiple handlers
                'x-login': async ctx => {
                    // This custom method implements AUTH LOGIN even though Nodemailer supports it natively.
                    // AUTH LOGIN mechanism includes multiple steps, so it's great for a demo nevertheless

                    console.log('Performing custom authentication for %s', ctx.auth.credentials.user);
                    console.log('Supported extensions: %s', ctx.extensions.join(', '));
                    console.log('Supported auth methods: %s', ctx.authMethods.join(', '));

                    if (!ctx.authMethods.includes('LOGIN')) {
                        console.log('Server does not support AUTH LOGIN');
                        throw new Error('Can not log in');
                    }
                    console.log('AUTH LOGIN is supported, proceeding with login...');

                    let cmd;

                    cmd = await ctx.sendCommand('AUTH LOGIN');
                    if (cmd.status !== 334) {
                        // expecting '334 VXNlcm5hbWU6'
                        throw new Error('Invalid login sequence while waiting for "334 VXNlcm5hbWU6"');
                    }

                    console.log('Sending username: %s', ctx.auth.credentials.user);
                    cmd = await ctx.sendCommand(Buffer.from(ctx.auth.credentials.user, 'utf-8').toString('base64'));
                    if (cmd.status !== 334) {
                        // expecting '334 UGFzc3dvcmQ6'
                        throw new Error('Invalid login sequence while waiting for "334 UGFzc3dvcmQ6"');
                    }

                    console.log('Sending password: %s', '*'.repeat(ctx.auth.credentials.pass.length));
                    cmd = await ctx.sendCommand(Buffer.from(ctx.auth.credentials.pass, 'utf-8').toString('base64'));
                    if (cmd.status < 200 || cmd.status >= 300) {
                        // expecting a 235 response, just in case allow everything in 2xx range
                        throw new Error('User failed to authenticate');
                    }

                    console.log('User authenticated! (%s)', cmd.response);

                    // all checks passed
                    return true;
                }
            }
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
        html:
            '<p><b>Hello</b> to myself <img src="cid:note@example.com"/></p>' +
            '<p>Here\'s a nyan cat for you as an embedded attachment:<br/><img src="cid:nyan@example.com"/></p>',

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

    let info = await transporter.sendMail(message);

    console.log('Message sent successfully!');
    console.log(nodemailer.getTestMessageUrl(info));

    // only needed when using pooled connections
    transporter.close();
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
