'use strict';

// This example demonstrates the 'compile' step with a plugin that adds a new header 'X-Sss'

var nodemailer = require('../src/nodemailer');
var transporter = nodemailer.createTransport(require('nodemailer-stub-transport')());

var plugin = function(mail, callback) {
    mail.data.headers['X-SSS'] = 'tere tere';
    return callback(null);
};

transporter.use('compile', plugin);

transporter.sendMail({
    from: 'sender',
    to: 'receiver',
    subject: 'hello',
    text: 'hello world!'
}, function(err, info) {
    console.log(info.response.toString());
});