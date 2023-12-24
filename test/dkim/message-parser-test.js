'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

//let http = require('http');
const MessageParser = require('../../lib/dkim/message-parser');

describe('DKIM MessageParser Tests', () => {
    it('should extract header and body', (t, done) => {
        let parser = new MessageParser();
        let message = `From: saatja aadress
To: Saaja aadress
Subject: pealkiri
  mitmel
  real
Message-Id: test

tere tere
teine rida
`;

        let chunks = [];
        let headers = false;
        let end = false;

        parser.on('data', chunk => {
            chunks.push(chunk);
        });

        parser.on('end', () => {
            end = true;
            let body = Buffer.concat(chunks).toString();
            assert.strictEqual(body, 'tere tere\nteine rida\n');
            if (headers) {
                return done();
            }
        });

        parser.on('headers', data => {
            assert.deepStrictEqual(data, [
                // fix auto format
                {
                    key: 'from',
                    line: 'From: saatja aadress'
                },
                {
                    key: 'to',
                    line: 'To: Saaja aadress'
                },
                {
                    key: 'subject',
                    line: 'Subject: pealkiri\n  mitmel\n  real'
                },
                {
                    key: 'message-id',
                    line: 'Message-Id: test'
                }
            ]);
            headers = true;
            if (end) {
                return done();
            }
        });

        parser.end(Buffer.from(message));
    });
});
