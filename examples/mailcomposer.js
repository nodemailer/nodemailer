'use strict';

const MailComposer = require('../lib/mail-composer');

const mailOptions = {
    from: 'mailer@kreata.ee',
    to: 'daemon@kreata.ee',
    envelope: {
        from: 'Daemon <deamon@kreata.ee>',
        to: 'mailer@kreata.ee, Mailer <mailer2@kreata.ee>'
    },
    text: 'Test\n 000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ö\r\nsage',
    newline: '\r\n'
};

async function main() {
    let raw = await new MailComposer(mailOptions).compile().build();
    process.stdout.write(raw);
}

main();
