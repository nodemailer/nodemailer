/* eslint no-console: 0, prefer-arrow-callback: 0 */

// This script verifies that all lib/ modules can be loaded and executed
// on Node.js 6+. It uses only Node 6-safe syntax intentionally.

'use strict';

const nodemailer = require('../lib/nodemailer');

const transporter = nodemailer.createTransport({
    jsonTransport: true
});

const message = {
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Syntax compatibility test',
    text: 'Plain text body',
    html: '<p>HTML body</p>',
    attachments: [
        {
            filename: 'test.txt',
            content: 'attachment content'
        }
    ]
};

transporter.sendMail(message, function (err, info) {
    if (err) {
        console.error('FAIL: ' + err.message);
        process.exit(1);
    }

    try {
        const parsed = JSON.parse(info.message);
        if (parsed.subject !== message.subject) {
            console.error('FAIL: Subject mismatch');
            process.exit(1);
        }
    } catch (e) {
        console.error('FAIL: Could not parse JSON output: ' + e.message);
        process.exit(1);
    }

    console.log('PASS: All lib/ modules loaded and message composed successfully on Node ' + process.version);
    process.exit(0);
});
