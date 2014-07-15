'use strict';

// This example demonstrates the 'stream' step with a plugin that converts all spaces to tabs

var nodemailer = require('../src/nodemailer');
var transporter = nodemailer.createTransport(require('nodemailer-stub-transport')());

var plugin = new(require('stream').Transform)();
plugin._transform = function(chunk, encoding, done) {
    // replace all spaces with tabs in the stream chunk
    for (var i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x20) {
            chunk[i] = 0x09;
        }
    }
    this.push(chunk);
    done();
};

transporter.use('stream', function(mail, callback) {
    // apply output transformer to the raw message stream
    mail.message.transform(plugin);
    callback();
});

transporter.sendMail({
    from: 'sender',
    to: 'receiver',
    subject: 'hello',
    text: 'hello world!'
}, function(err, info) {
    console.log(info.response.toString());
});