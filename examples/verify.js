/* eslint no-console: 0 */

'use strict';

const nodemailer = require('../lib/nodemailer');

async function main() {
    // Generate SMTP service account from ethereal.email
    let account = await nodemailer.createTestAccount();

    console.log('Verifying obtained credentials...');

    // NB! Store the account object values somewhere if you want
    // to re-use the same account for future mail deliveries

    // Create a SMTP transporter object
    let transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: {
            user: account.user,
            pass: account.pass
        },
        logger: false,
        debug: false // include SMTP traffic in the logs
    });

    try {
        await transporter.verify();
        console.log('Credentials are valid');
    } catch (err) {
        // throws on invalid credentials
        console.log('Credentials are invalid');
        throw err;
    }
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
