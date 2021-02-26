'use strict';

let nodemailer = require('nodemailer');
let aws = require('@aws-sdk/client-ses');

process.env.AWS_ACCESS_KEY_ID = '....';
process.env.AWS_SECRET_ACCESS_KEY = '....';

const ses = new aws.SES({
    apiVersion: '2010-12-01',
    region: 'us-east-1'
});

// create Nodemailer SES transporter
let transporter = nodemailer.createTransport({
    SES: { ses, aws }
});

// send some mail
transporter.sendMail(
    {
        from: 'andris.reinman@gmail.com',
        to: 'andris@kreata.ee',
        subject: 'Message',
        text: 'I hope this message gets sent!',
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
