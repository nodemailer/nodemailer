'use strict';

const MailComposer = require('../lib/mail-composer');

const mailOptions = {
    from: 'mailer@kreata.ee',
    to: 'daemon@kreata.ee',
    envelope: {
        from: 'Daemon <deamon@kreata.ee>',
        to: 'mailer@kreata.ee, Mailer <mailer2@kreata.ee>'
    },
    text: 'Test message'
};

async function main() {
    let raw = await new MailComposer(mailOptions).compile().build();
    process.stdout.write(raw);
}

main();
