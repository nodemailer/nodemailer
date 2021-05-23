'use strict';

const MailComposer = require('../lib/mail-composer');

const mailOptions = {
    from: 'mailer@kreata.ee',
    to: 'daemon@kreata.ee',
    envelope: {
        from: 'Daemon <deamon@kreata.ee>',
        to: 'mailer@kreata.ee, Mailer <mailer2@kreata.ee>'
    },
    text: `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'

So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.`,
    newline: '\r\n'
};

async function main() {
    let raw = await new MailComposer(mailOptions).compile().build();
    process.stdout.write(raw);
}

main();
