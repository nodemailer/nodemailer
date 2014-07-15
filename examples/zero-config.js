'use strict';

var nodemailer = require('../src/nodemailer');
var transporter = nodemailer.createTransport();

transporter.sendMail({
    from: 'sender@address',
    to: 'receiver@address',
    subject: 'hello',
    text: 'hello world!'
}, function(err, response) {
    console.log(err || response);
});