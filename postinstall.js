/* eslint no-control-regex:0  */
'use strict';

const packageData = require('./package.json');
const isEnabled = value => !!value && value !== '0' && value !== 'false';
const canUseColor = isEnabled(process.env.npm_config_color);

const title = `=== Nodemailer ${packageData.version} ===`;
const text = `
Thank you for using Nodemailer for your email sending needs! While Nodemailer itself is mostly meant to be a SMTP client there are other related projects in the Nodemailer project as well.

> IMAP API ( https://imapapi.com ) is a server application to easily access IMAP accounts via REST API
> ImapFlow ( https://imapflow.com/ ) is an async IMAP client library for Node.js
> NodemailerApp ( https://nodemailer.com/app/ ) is a cross platform GUI app to debug emails
> Project Pending ( https://projectpending.com/ ) allows you to host DNS of your project domains
> Pending DNS ( https://pendingdns.com/ ) is the DNS server used that powers Project Pending
> Ethereal Email ( https://ethereal.email/ ) is an email testing service that accepts all your test emails
`;

const secs = 4;

const formatCentered = (row, columns) => {
    if (columns <= row.length) {
        return row;
    }

    return ' '.repeat(Math.round(columns / 2 - row.length / 2)) + row;
};

const formatRow = (row, columns) => {
    if (row.length <= columns) {
        return [row];
    }
    // wrap!
    let lines = [];
    while (row.length) {
        if (row.length <= columns) {
            lines.push(row);
            break;
        }
        let slice = row.substr(0, columns);

        let prefix = slice.charAt(0) === '>' ? '  ' : '';

        let match = slice.match(/(\s+)[^\s]*$/);
        if (match && match.index) {
            let line = row.substr(0, match.index);
            row = prefix + row.substr(line.length + match[1].length);
            lines.push(line);
        } else {
            lines.push(row);
            break;
        }
    }
    return lines;
};

const wrapText = text => {
    let columns = Number(process.stdout.columns) || 80;
    columns = Math.min(columns, 80) - 1;

    return (formatCentered(title, columns) + '\n' + text)
        .split('\n')
        .flatMap(row => formatRow(row, columns))
        .join('\n');
};

const banner = wrapText(text)
    .replace(/^/gm, '\u001B[96m')
    .replace(/$/gm, '\u001B[0m')
    .replace(/(https:[^\s)]+)/g, '\u001B[94m $1 \u001B[96m');

console.log(canUseColor ? banner : banner.replace(/\u001B\[\d+m/g, ''));
if (canUseColor) {
    process.stdout.write('\u001B[96m');
}

setInterval(() => {
    process.stdout.write('.');
}, 500);

setTimeout(() => {
    if (canUseColor) {
        process.stdout.write('\u001B[0m\n');
    }
    process.exit(0);
}, secs * 1000 + 100);
