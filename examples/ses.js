'use strict';

let nodemailer = require('../lib/nodemailer');

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

/* --- Change these values to test --- */

const AWS_ACCESS_KEY_ID = 'access-key';
const AWS_SECRET_ACCESS_KEY = 'access-secret';
const AWS_REGION = 'us-east-1';

const FROM_ADDRESS = 'sender@example.com';
const TO_ADDRESS = 'recipient@example.com';

/* --- no need to change below this line when testing --- */

const sesClient = new SESv2Client({
    apiVersion: '2010-12-01',
    region: AWS_REGION,
    credentials: {
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
        accessKeyId: AWS_ACCESS_KEY_ID
    }
});

// create Nodemailer SES transporter
let transporter = nodemailer.createTransport({
    SES: { sesClient, SendEmailCommand }
});

// send some mail
transporter.sendMail(
    {
        from: FROM_ADDRESS,
        to: TO_ADDRESS,

        subject: 'Message ✓ ' + Date.now(),
        text: 'I hope this message gets sent! ✓',
        ses: {
            // optional extra arguments for SendEmailCommand
            EmailTags: [
                {
                    Name: 'tag_name',
                    Value: 'tag_value'
                }
            ]
        }
    },
    (err, info) => {
        console.log(err || info);
    }
);
