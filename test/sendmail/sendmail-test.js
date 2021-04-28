/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const chai = require('chai');
const expect = chai.expect;
const PassThrough = require('stream').PassThrough;
const EventEmitter = require('events').EventEmitter;
const sinon = require('sinon');
const SendmailTransport = require('../../lib/sendmail-transport');
const MailComposer = require('../../lib/mail-composer');
chai.config.includeStack = true;

class MockBuilder {
    constructor(envelope, message, messageId) {
        this.envelope = envelope;
        this.rawMessage = message;
        this.mid = messageId || '<test>';
    }

    getEnvelope() {
        return this.envelope;
    }

    messageId() {
        return this.mid;
    }

    createReadStream() {
        let stream = new PassThrough();
        setImmediate(() => stream.end(this.rawMessage));
        return stream;
    }

    getHeader() {
        return 'teretere';
    }
}

describe('Sendmail Transport Tests', function () {
    it('Should expose version number', function () {
        let client = new SendmailTransport();
        expect(client.name).to.exist;
        expect(client.version).to.exist;
    });

    it('Should send message', function (done) {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', function (chunk) {
            output += chunk.toString();
        });

        stubbedSpawn.stdin.on('end', function () {
            stubbedSpawn.emit('close', 0);
            stubbedSpawn.emit('exit', 0);
        });

        sinon.stub(client, '_spawn').returns(stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MailComposer({
                    from: 'test@valid.sender',
                    to: 'test@valid.recipient',
                    newline: '\n',
                    raw: Buffer.from('message\r\nline 2')
                }).compile()
            },
            function (err) {
                expect(err).to.not.exist;
                expect(output).to.equal('message\nline 2\n');
                client._spawn.restore();
                done();
            }
        );
    });

    it('Should reject message', function (done) {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        let output = '';
        stubbedSpawn.stdin.on('data', function (chunk) {
            output += chunk.toString();
        });

        stubbedSpawn.stdin.on('end', function () {
            stubbedSpawn.emit('close', 0);
            stubbedSpawn.emit('exit', 0);
        });

        sinon.stub(client, '_spawn').returns(stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MockBuilder(
                    {
                        from: 'test@valid.sender',
                        to: '-d0.1a@example.com'
                    },
                    'message\r\nline 2'
                )
            },
            function (err, data) {
                expect(err).to.exist;
                expect(data).to.not.exist;
                expect(output).to.equal('');
                client._spawn.restore();
                done();
            }
        );
    });

    it('Should return an error', function (done) {
        let client = new SendmailTransport();

        let stubbedSpawn = new EventEmitter();
        stubbedSpawn.stdin = new PassThrough();
        stubbedSpawn.stdout = new PassThrough();

        stubbedSpawn.stdin.on('data', () => false);

        stubbedSpawn.stdin.on('end', function () {
            stubbedSpawn.emit('close', 127);
            stubbedSpawn.emit('exit', 127);
        });

        sinon.stub(client, '_spawn').returns(stubbedSpawn);

        client.send(
            {
                data: {},
                message: new MockBuilder(
                    {
                        from: 'test@valid.sender',
                        to: 'test@valid.recipient'
                    },
                    'message\r\nline 2'
                )
            },
            function (err, data) {
                expect(err).to.exist;
                expect(data).to.not.exist;
                client._spawn.restore();
                done();
            }
        );
    });
});
