'use strict';

var chai = require('chai');
var nodemailer = require('../src/nodemailer');
var sinon = require('sinon');
var expect = chai.expect;
var simplesmtp = require('simplesmtp');
var crypto = require('crypto');

chai.Assertion.includeStack = true;

var PORT_NUMBER = 8397;

describe('Nodemailer unit tests', function() {
    var nm, transport;

    beforeEach(function() {
        transport = {
            name: 'testsend',
            version: '1',
            send: function(data, callback) {
                callback();
            }
        };
        nm = nodemailer.createTransport(transport);
    });

    it('should create Nodemailer transport object', function() {
        expect(nm).to.exist;
    });

    describe('Hooking plugins', function() {
        it('should add a plugin to queue', function() {
            nm.use('compile', 'abc');
            nm.use('compile', 'def');

            expect(nm._plugins).to.deep.equal({
                compile: [
                    'abc',
                    'def'
                ],
                stream: []
            });
        });

        it('should process compile and stream plugins', function(done) {
            var compilePlugin = sinon.stub().yields(null);
            var streamPlugin = sinon.stub().yields(null);

            nm.use('compile', compilePlugin);
            nm.use('compile', streamPlugin);

            nm.sendMail({
                subject: 'test'
            }, function() {
                expect(compilePlugin.callCount).to.equal(1);
                expect(compilePlugin.args[0][0].data.subject).to.equal('test');
                expect(compilePlugin.args[0][0].message).to.exist;

                expect(streamPlugin.callCount).to.equal(1);
                expect(streamPlugin.args[0][0].data.subject).to.equal('test');
                expect(streamPlugin.args[0][0].message).to.exist;
                done();
            });
        });
    });

    describe('#sendMail', function() {
        it('should process sendMail', function(done) {
            sinon.stub(transport, 'send').yields(null, 'tere tere');

            nm.sendMail({
                subject: 'test'
            }, function(err, info) {
                expect(transport.send.callCount).to.equal(1);
                expect(info).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should return transport error', function(done) {
            sinon.stub(transport, 'send').yields('tere tere');

            nm.sendMail({
                subject: 'test'
            }, function(err) {
                expect(transport.send.callCount).to.equal(1);
                expect(err).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should override xMailer', function(done) {
            sinon.stub(transport, 'send', function(mail, callback) {
                expect(mail.message.getHeader('x-mailer')).to.equal('yyyy');
                callback();
            });
            nm.sendMail({
                subject: 'test',
                xMailer: 'yyyy'
            }, function() {
                expect(transport.send.callCount).to.equal(1);
                transport.send.restore();
                done();
            });
        });
    });
});

describe('Nodemailer integration tests', function() {
    var server;

    beforeEach(function(done) {
        server = new simplesmtp.createServer({
            ignoreTLS: true,
            disableDNSValidation: true,
            requireAuthentication: true,
            debug: false,
            authMethods: ['PLAIN', 'XOAUTH2']
        });

        server.on('startData', function(connection) {
            connection.hash = crypto.createHash('md5');
        });

        server.on('data', function(connection, chunk) {
            connection.hash.update(chunk.toString('utf-8'));
        });

        server.on('dataReady', function(connection, callback) {
            var hash = connection.hash.digest('hex');
            callback(null, hash); // ABC1 is the queue id to be advertised to the client
        });

        server.on('authorizeUser', function(connection, username, pass, callback) {
            callback(null, username === 'testuser' && (pass === 'testpass' || pass === 'testtoken'));
        });

        server.on('validateSender', function(connection, email, callback) {
            callback(!/@valid.sender/.test(email) && new Error('Invalid sender'));
        });

        server.on('validateRecipient', function(connection, email, callback) {
            callback(!/@valid.recipient/.test(email) && new Error('Invalid recipient'));
        });

        server.listen(PORT_NUMBER, done);
    });

    afterEach(function(done) {
        server.end(done);
    });

    it('should log in and send mail', function(done) {
        var nm = nodemailer.createTransport({
            host: 'localhost',
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            ignoreTLS: true
        });

        var mailData = {
            from: 'from@valid.sender',
            to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu'
        };

        nm.sendMail(mailData, function(err, info) {
            expect(err).to.not.exist;
            expect(info.accepted).to.deep.equal([
                'to1@valid.recipient',
                'to2@valid.recipient'
            ]);
            expect(info.rejected).to.deep.equal([
                'to@invalid.recipient'
            ]);
            expect(info.messageId).to.equal('abc@def');
            expect(/eaa13435e1401328be32bc7a4c629f9f/i.test(info.response)).to.be.true;
            done();
        });
    });

    it('should response auth error', function(done) {
        var nm = nodemailer.createTransport({
            host: 'localhost',
            port: PORT_NUMBER,
            auth: {
                user: 'invalid user',
                pass: 'testpass'
            },
            ignoreTLS: true
        });

        var mailData = {
            from: 'from@valid.sender',
            to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu'
        };

        nm.sendMail(mailData, function(err, info) {
            expect(err).to.exist;
            expect(info).to.not.exist;
            expect(err.code).to.equal('EAUTH');
            done();
        });
    });

    it('should response envelope error', function(done) {
        var nm = nodemailer.createTransport({
            host: 'localhost',
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            ignoreTLS: true
        });

        var mailData = {
            from: 'from@valid.sender',
            to: ['to@invalid.recipient'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu'
        };

        nm.sendMail(mailData, function(err, info) {
            expect(err).to.exist;
            expect(info).to.not.exist;
            expect(err.code).to.equal('EENVELOPE');
            done();
        });
    });

    it('should override envelope', function(done) {
        var nm = nodemailer.createTransport({
            host: 'localhost',
            port: PORT_NUMBER,
            auth: {
                user: 'testuser',
                pass: 'testpass'
            },
            ignoreTLS: true
        });

        var mailData = {
            from: 'from@valid.sender',
            to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu',
            envelope: {
                from: 'aaa@valid.sender',
                to: 'vvv@valid.recipient'
            }
        };

        nm.sendMail(mailData, function(err, info) {
            expect(err).to.not.exist;
            expect(info.accepted).to.deep.equal([
                'vvv@valid.recipient'
            ]);
            expect(info.rejected).to.deep.equal([]);
            expect(info.messageId).to.equal('abc@def');
            expect(/eaa13435e1401328be32bc7a4c629f9f/i.test(info.response)).to.be.true;
            done();
        });
    });
});