/* eslint-env es6 */

'use strict';

// This example is for testing Gmail actions with a Google Apps account
// https://developers.google.com/gmail/markup/overview

// see https://cloudup.com/chLuRjJy61U for example output of this script

const nodemailer = require('nodemailer');
const nodemailerDkim = require('nodemailer-dkim');

// Gmail Actions are enabled by default for messages sent by the same user
// so this test script uses the same from: and to: addresses
const address = 'username@some-google-apps-domain.com';

// Messages with Gmail actions need to be authenticated either by SPF or DKIM
// Generate dkim keys online here: http://dkimcore.org/tools/keys.html
const dkimDomainName = 'some-google-apps-domain.com';
const dkimKeySelector = '1453194466.selector';
const dkimPrivateKey = require('fs').readFileSync('dkim-private.pem');

// We do not want to send test mail through Gmail, othewise DKIM is not processed
// (Gmail displays the same message in INBOX as in Sent folder) and action
// button is not displayed
let connection = {
    host: 'some-smtp-host.com',
    port: 465,
    secure: true,
    auth: {
        user: 'username',
        pass: 'password'
    },
    logger: true
};

// Create reusable transporter object using the default SMTP transport
let transporter = nodemailer.createTransport(connection);

// sign outgoing message with DKIM
transporter.use('stream', nodemailerDkim.signer({
    domainName: dkimDomainName,
    keySelector: dkimKeySelector,
    privateKey: dkimPrivateKey
}));

// setup e-mail data
var mailOptions = {
    from: address,
    to: address,
    subject: 'Go-To Test ✔', // Subject line
    html: `
        <p>This message includes a
        <a href="https://developers.google.com/gmail/markup/reference/go-to-action">Go-To action</a></p>

        <script type="application/ld+json">
        {
          "@context": "http://schema.org",
          "@type": "EmailMessage",
          "potentialAction": {
            "@type": "ViewAction",
            "url": "https://google.com",
            "name": "Go to Google"
          },
          "description": "Search for something from Google"
        }
        </script>`
};

// send mail
transporter.sendMail(mailOptions);
