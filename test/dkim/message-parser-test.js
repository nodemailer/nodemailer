/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

//let http = require('http');
const MessageParser = require('../../lib/dkim/message-parser');

chai.config.includeStack = true;

describe('DKIM MessageParser Tests', function () {
    it('should extract header and body', function (done) {
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
            expect(body).to.equal('tere tere\nteine rida\n');
            if (headers) {
                return done();
            }
        });

        parser.on('headers', data => {
            expect(data).to.deep.equal([
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
