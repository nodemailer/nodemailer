'use strict';

let nodemailer = require('nodemailer');

/* --- Select AWS SDK version by uncommenting correct version --- */

let aws = require('@aws-sdk/client-ses');

/* --- Change these values to test --- */

const AWS_ACCESS_KEY_ID = 'access-key';
const AWS_SECRET_ACCESS_KEY = 'access-secret';

const FROM_ADDRESS = 'andris.reinman@gmail.com';
const TO_ADDRESS = 'andris@kreata.ee';

/* --- no need to change below this line when testing --- */

const ses = new aws.SES({
    apiVersion: '2010-12-01',
    region: 'us-east-1',
    credentials: {
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
        accessKeyId: AWS_ACCESS_KEY_ID
    }
});

// create Nodemailer SES transporter
let transporter = nodemailer.createTransport({
    SES: { ses, aws }
});

// send some mail
transporter.sendMail(
    {
        from: FROM_ADDRESS,
        to: TO_ADDRESS,

        subject: 'Message ✓ ' + Date.now(),
        text: 'I hope this message gets sent! ✓',
        ses: {
            // optional extra arguments for SendRawEmail
            Tags: [
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
