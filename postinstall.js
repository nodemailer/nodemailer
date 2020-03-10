/* eslint no-control-regex:0  */
'use strict';

const packageData = require('./package.json');
const isEnabled = value => !!value && value !== '0' && value !== 'false';
const canUseColor = isEnabled(process.env.npm_config_color);

const text = `=== Nodemailer ${packageData.version} ===

Thank you for using Nodemailer for your email sending needs! While Nodemailer itself is mostly meant to be a SMTP client there are other related projects in the Nodemailer project as well.

For example:
> IMAP API ( https://imapapi.com ) is a server application to easily access IMAP accounts via REST API
> NodemailerApp ( https://nodemailer.com/app/ ) is a cross platform GUI app to debug emails
`;

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

        let match = slice.match(/(\s+)[^\s]*$/);
        if (match && match.index) {
            let line = row.substr(0, match.index);
            row = row.substr(line.length + match[1].length);
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

    return text
        .split('\n')
        .flatMap(row => formatRow(row, columns))
        .join('\n');
};

const banner = wrapText(text)
    .replace(/^/gm, '\u001B[96m')
    .replace(/$/gm, '\u001B[0m')
    .replace(/(https:[^\s)]+)/g, '\u001B[94m $1 \u001B[96m');

console.log(canUseColor ? banner : banner.replace(/\u001B\[\d+m/g, ''));
