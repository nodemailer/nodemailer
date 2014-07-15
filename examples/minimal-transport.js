'use strict';

// This example creates a transport object that pipes the raw message to console

var transport = {
    name: 'minimal',
    version: '0.1.0',
    send: function(mail, callback) {
        var input = mail.message.createReadStream();
        input.pipe(process.stdout);
        input.on('end', function() {
            callback(null, true);
        });
    }
};

var nodemailer = require('../src/nodemailer');
var transporter = nodemailer.createTransport(transport);

transporter.sendMail({
    from: 'sender',
    to: 'receiver',
    subject: 'hello',
    text: 'hello world!'
});