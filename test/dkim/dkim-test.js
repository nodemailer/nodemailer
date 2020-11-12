/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const PassThrough = require('stream').PassThrough;
const DKIM = require('../../lib/dkim');

chai.config.includeStack = true;

const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIBywIBAAJhANCx7ncKUfQ8wBUYmMqq6ky8rBB0NL8knBf3+uA7q/CSxpX6sQ8N
dFNtEeEd7gu7BWEM7+PkO1P0M78eZOvVmput8BP9R44ARpgHY4V0qSCdUt4rD32n
wfjlGbh8p5ua5wIDAQABAmAm+uUQpQPTu7kg95wqVqw2sxLsa9giT6M8MtxQH7Uo
1TF0eAO0TQ4KOxgY1S9OT5sGPVKnag258m3qX7o5imawcuyStb68DQgAUg6xv7Af
AqAEDfYN5HW6xK+X81jfOUECMQDr7XAS4PERATvgb1B3vRu5UEbuXcenHDYgdoyT
3qJFViTbep4qeaflF0uF9eFveMcCMQDic10rJ8fopGD7/a45O4VJb0+lRXVdqZxJ
QzAp+zVKWqDqPfX7L93SQLzOGhdd7OECMQDeQyD7WBkjSQNMy/GF7I1qxrscIxNN
VqGTcbu8Lti285Hjhx/sqhHHHGwU9vB7oM8CMQDKTS3Kw/s/xrot5O+kiZwFgr+w
cmDrj/7jJHb+ykFNb7GaEkiSYqzUjKkfpweBDYECMFJUyzuuFJAjq3BXmGJlyykQ
TweUw+zMVdSXjO+FCPcYNi6CP1t1KoESzGKBVoqA/g==
-----END RSA PRIVATE KEY-----`;

/*
const publicKey = `-----BEGIN PUBLIC KEY-----
MHwwDQYJKoZIhvcNAQEBBQADawAwaAJhANCx7ncKUfQ8wBUYmMqq6ky8rBB0NL8k
nBf3+uA7q/CSxpX6sQ8NdFNtEeEd7gu7BWEM7+PkO1P0M78eZOvVmput8BP9R44A
RpgHY4V0qSCdUt4rD32nwfjlGbh8p5ua5wIDAQAB
-----END PUBLIC KEY-----`;
*/

describe('DKIM Tests', function () {
    this.timeout(100 * 1000); // eslint-disable-line

    it('should sign message', function (done) {
        let message = `From: saatja aadress
To: Saaja aadress
Subject: pealkiri
  mitmel
  real
Message-Id: test

tere tere
teine rida
`;
        let s = new PassThrough();
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        });

        let output = dkim.sign(s);

        let chunks = [];

        let reading = false;
        let readNext = () => {
            let chunk = output.read(10 * 1024);
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            let message = Buffer.concat(chunks).toString();
            expect(message).to.equal(
                'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=node.ee; q=dns/txt;\r\n' +
                    ' s=dkim; bh=h2JdEKA6yVYSGuI3DQCDlg2KL+96GxA7Yw7owvsYDUM=;\r\n' +
                    ' h=from:subject:message-id:to;\r\n' +
                    ' b=tey8mL2VQVuy/phh7yEKi86Y0Yyzyy04qTy73G4yg3qdEDB7uymjNr32ruRPVFmC9PimIK75p\r\n' +
                    ' KVPF5T1oB8/oY6TFqyyuECRrI4D2CfG3VXWBShK32r1Wtv7eWN04b4s\r\n' +
                    'From: saatja aadress\n' +
                    'To: Saaja aadress\n' +
                    'Subject: pealkiri\n' +
                    '  mitmel\n' +
                    '  real\n' +
                    'Message-Id: test\n' +
                    '\n' +
                    'tere tere\n' +
                    'teine rida\n'
            );
            done();
        });

        let inputPos = 0;
        let messageBuf = Buffer.from(message);
        let writeNext = () => {
            if (inputPos >= messageBuf.length) {
                return s.end();
            }
            s.write(Buffer.from([messageBuf[inputPos++]]));
            setImmediate(writeNext);
        };
        writeNext();
    });

    it('should sign large message using cache dir', function (done) {
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        let output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            expect(err).to.not.exist;
            done();
        });

        let chunks = [];

        let reading = false;
        let readNext = () => {
            let chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            let message = Buffer.concat(chunks).toString();
            expect(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=')).is.gte(0);
            expect(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex')
            ).to.equal('16078d67ecb4c9954f2568b3bd20e8b5');
            expect(output.usingCache).to.be.true;
            done();
        });
    });

    it('should sign large message without cache dir', function (done) {
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        });

        let output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            expect(err).to.not.exist;
            done();
        });

        let chunks = [];

        let reading = false;
        let readNext = () => {
            let chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            let message = Buffer.concat(chunks).toString();
            expect(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=')).is.gte(0);
            expect(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex')
            ).to.equal('16078d67ecb4c9954f2568b3bd20e8b5');
            expect(output.usingCache).to.be.false;
            done();
        });
    });

    it('should emit cache error', function (done) {
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: '/rootertewywrtyreetwert' // expecting that this location does not exist or is unwritable
        });

        let output = dkim.sign(fs.createReadStream(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            expect(err).to.exist;
            done();
        });
    });

    it('should sign large message as Buffer', function (done) {
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        let output = dkim.sign(fs.readFileSync(__dirname + '/fixtures/large.eml'));
        output.on('error', err => {
            expect(err).to.not.exist;
            done();
        });

        let chunks = [];

        let reading = false;
        let readNext = () => {
            let chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            let message = Buffer.concat(chunks).toString();
            expect(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=')).is.gte(0);
            expect(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex')
            ).to.equal('16078d67ecb4c9954f2568b3bd20e8b5');
            expect(output.usingCache).to.be.true;
            done();
        });
    });

    it('should sign large message as String', function (done) {
        let dkim = new DKIM({
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey,
            cacheDir: path.join(__dirname, 'cache')
        });

        let output = dkim.sign(fs.readFileSync(__dirname + '/fixtures/large.eml', 'utf-8'));
        output.on('error', err => {
            expect(err).to.not.exist;
            done();
        });

        let chunks = [];

        let reading = false;
        let readNext = () => {
            let chunk = output.read();
            if (chunk === null) {
                reading = false;
                return;
            }
            reading = true;
            chunks.push(chunk);
            setImmediate(readNext);
        };

        output.on('readable', () => {
            if (!reading) {
                readNext();
            }
        });

        output.on('end', () => {
            let message = Buffer.concat(chunks).toString();
            expect(message.indexOf('bh=ST+2Z7mCDd8CPa6pWbCWnFBLKyl8/I5d0JCaEQub550=')).is.gte(0);
            expect(
                crypto
                    .createHash('md5')
                    .update(Buffer.from(message.substr(message.indexOf('X-Zone-Loop'))))
                    .digest('hex')
            ).to.equal('16078d67ecb4c9954f2568b3bd20e8b5');
            expect(output.usingCache).to.be.true;
            done();
        });
    });
});
