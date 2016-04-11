/* eslint no-unused-expressions:0 */
/* globals afterEach, beforeEach, describe, it */

'use strict';

var chai = require('chai');
var nodemailer = require('../lib/nodemailer');
var sinon = require('sinon');
var SMTPServer = require('smtp-server').SMTPServer;
var crypto = require('crypto');
var stream = require('stream');
var stubTransport = require('nodemailer-stub-transport');
var EmailTemplate = require('email-templates').EmailTemplate;
var path = require('path');
var templateDir = path.join(__dirname, 'fixtures', 'welcome-email');
var net = require('net');

var expect = chai.expect;
chai.config.includeStack = true;

var PORT_NUMBER = 8397;

describe('Nodemailer unit tests', function () {
    var nm, transport;

    beforeEach(function () {
        transport = {
            name: 'testsend',
            version: '1',
            send: function (data, callback) {
                callback();
            },
            logger: false
        };
        nm = nodemailer.createTransport(transport);
    });

    it('should create Nodemailer transport object', function () {
        expect(nm).to.exist;
    });

    describe('Hooking plugins', function () {
        it('should add a plugin to queue', function () {
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

        it('should process compile and stream plugins', function (done) {
            var compilePlugin = sinon.stub().yields(null);
            var streamPlugin = sinon.stub().yields(null);

            nm.use('compile', compilePlugin);
            nm.use('compile', streamPlugin);

            nm.sendMail({
                subject: 'test'
            }, function () {
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

    describe('#sendMail', function () {
        it('should process sendMail', function (done) {
            sinon.stub(transport, 'send').yields(null, 'tere tere');

            nm.sendMail({
                subject: 'test'
            }, function (err, info) {
                expect(err).to.not.exist;
                expect(transport.send.callCount).to.equal(1);
                expect(info).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should process sendMail as a Promise', function (done) {
            sinon.stub(transport, 'send').yields(null, 'tere tere');

            nm.sendMail({
                subject: 'test'
            }).then(function (info) {
                expect(transport.send.callCount).to.equal(1);
                expect(info).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should return transport error', function (done) {
            sinon.stub(transport, 'send').yields('tere tere');

            nm.sendMail({
                subject: 'test'
            }, function (err) {
                expect(transport.send.callCount).to.equal(1);
                expect(err).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should return transport error as Promise', function (done) {
            sinon.stub(transport, 'send').yields('tere tere');

            nm.sendMail({
                subject: 'test'
            }).catch(function (err) {
                expect(transport.send.callCount).to.equal(1);
                expect(err).to.equal('tere tere');
                transport.send.restore();
                done();
            });
        });

        it('should override xMailer', function (done) {
            sinon.stub(transport, 'send', function (mail, callback) {
                expect(mail.message.getHeader('x-mailer')).to.equal('yyyy');
                callback();
            });
            nm.sendMail({
                subject: 'test',
                xMailer: 'yyyy'
            }, function () {
                expect(transport.send.callCount).to.equal(1);
                transport.send.restore();
                done();
            });
        });

        it('should set priority headers', function (done) {
            sinon.stub(transport, 'send', function (mail, callback) {
                expect(mail.message.getHeader('X-Priority')).to.equal('5 (Lowest)');
                expect(mail.message.getHeader('X-Msmail-Priority')).to.equal('Low');
                expect(mail.message.getHeader('Importance')).to.equal('Low');
                callback();
            });
            nm.sendMail({
                priority: 'low'
            }, function () {
                expect(transport.send.callCount).to.equal(1);
                transport.send.restore();
                done();
            });
        });

        it('return invalid configuration error', function (done) {
            nm = nodemailer.createTransport('SMTP', {});
            nm.sendMail({
                subject: 'test',
                xMailer: 'yyyy'
            }, function (err) {
                expect(err).to.exist;
                done();
            });
        });
    });
});

describe('Nodemailer integration tests', function () {
    this.timeout(10000); // eslint-disable-line no-invalid-this
    var server;

    beforeEach(function (done) {
        server = new SMTPServer({
            authMethods: ['PLAIN', 'XOAUTH2'],
            disabledCommands: ['STARTTLS'],

            onData: function (stream, session, callback) {
                var hash = crypto.createHash('md5');
                stream.on('data', function (chunk) {
                    hash.update(chunk);
                });
                stream.on('end', function () {
                    callback(null, hash.digest('hex'));
                });
            },

            onAuth: function (auth, session, callback) {
                if (auth.method !== 'XOAUTH2') {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                } else if (auth.username !== 'testuser' || auth.accessToken !== 'testtoken') {
                    return callback(null, {
                        data: {
                            status: '401',
                            schemes: 'bearer mac',
                            scope: 'my_smtp_access_scope_name'
                        }
                    });
                }
                callback(null, {
                    user: 123
                });
            },
            onMailFrom: function (address, session, callback) {
                if (!/@valid.sender/.test(address.address)) {
                    return callback(new Error('Only user@valid.sender is allowed to send mail'));
                }
                return callback(); // Accept the address
            },
            onRcptTo: function (address, session, callback) {
                if (!/@valid.recipient/.test(address.address)) {
                    return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                }
                return callback(); // Accept the address
            },
            logger: false
        });

        server.listen(PORT_NUMBER, done);
    });

    afterEach(function (done) {
        server.close(done);
    });

    describe('smtp-transport tests', function () {

        it('Should verify connection with success', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
            });

            nm.verify().then(function (success) {
                expect(success).to.be.true;
                done();
            }).catch(function (err) {
                expect(err).to.not.exist;
                done();
            });
        });

        it('Should not verify connection', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                requireTLS: true,
                logger: false
            });

            nm.verify(function (err) {
                expect(err).to.exist;
                done();
            });
        });

        it('should log in and send mail', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
            });

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal([
                    'to1@valid.recipient',
                    'to2@valid.recipient'
                ]);
                expect(info.rejected).to.deep.equal([
                    'to@invalid.recipient'
                ]);
                expect(info.messageId).to.equal('abc@def');
                expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
                done();
            });
        });

        it('should log in and send mail using connection url', function (done) {
            var nm = nodemailer.createTransport('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?logger=false&debug=true');

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal([
                    'to1@valid.recipient',
                    'to2@valid.recipient'
                ]);
                expect(info.rejected).to.deep.equal([
                    'to@invalid.recipient'
                ]);
                expect(info.messageId).to.equal('abc@def');
                expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
                done();
            });
        });

        it('should return stream error, not send', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
            });

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: new stream.PassThrough()
            };

            nm.sendMail(mailData, function (err) {
                expect(err).to.exist;
                done();
            });

            mailData.text.write('teretere');
            setTimeout(function () {
                mailData.text.emit('error', new Error('Stream error'));
            }, 400);
        });

        it('should response auth error', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'invalid user',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
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

            nm.sendMail(mailData, function (err, info) {
                expect(err).to.exist;
                expect(info).to.not.exist;
                expect(err.code).to.equal('EAUTH');
                done();
            });
        });

        it('should response envelope error', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
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

            nm.sendMail(mailData, function (err, info) {
                expect(err).to.exist;
                expect(info).to.not.exist;
                expect(err.code).to.equal('EENVELOPE');
                done();
            });
        });

        it('should override envelope', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
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

            nm.sendMail(mailData, function (err, info) {
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

        it('should send to internationalized address', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false,
                debug: false
            });

            var mailData = {
                from: 'from@valid.sender',
                to: ['internätiõnäližed@valid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal(['internätiõnäližed@valid.recipient']);
                expect(info.rejected).to.deep.equal([]);
                expect(info.messageId).to.equal('abc@def');
                done();
            });
        });

    });

    describe('smtp-pool tests', function () {

        it('Should verify connection with success', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                pool: true,
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false
            });

            nm.verify(function (err, success) {
                expect(err).to.not.exist;
                expect(success).to.be.true;
                nm.close();
                done();
            });
        });

        it('Should not verify connection', function (done) {
            var nm = nodemailer.createTransport({
                host: 'localhost',
                pool: true,
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                requireTLS: true,
                logger: false
            });

            nm.verify(function (err) {
                expect(err).to.exist;
                nm.close();
                done();
            });
        });

        it('should log in and send mail', function (done) {
            var nm = nodemailer.createTransport({
                pool: true,
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false,
                debug: true
            });

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                nm.close();
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal([
                    'to1@valid.recipient',
                    'to2@valid.recipient'
                ]);
                expect(info.rejected).to.deep.equal([
                    'to@invalid.recipient'
                ]);
                expect(info.messageId).to.equal('abc@def');
                expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
                done();
            });
        });

        it('should log in and send mail using connection url', function (done) {
            var nm = nodemailer.createTransport('smtp://testuser:testpass@localhost:' + PORT_NUMBER + '/?pool=true&logger=false&debug=true');

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                nm.close();
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal([
                    'to1@valid.recipient',
                    'to2@valid.recipient'
                ]);
                expect(info.rejected).to.deep.equal([
                    'to@invalid.recipient'
                ]);
                expect(info.messageId).to.equal('abc@def');
                expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
                done();
            });
        });

        it('should return stream error, not send', function (done) {
            var nm = nodemailer.createTransport({
                pool: true,
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                maxConnections: 1,
                logger: false,
                debug: true
            });

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: new stream.PassThrough()
            };

            nm.sendMail(mailData, function (err) {
                nm.close();
                expect(err).to.exist;
                done();
            });

            mailData.text.write('teretere');
            setTimeout(function () {
                mailData.text.emit('error', new Error('Stream error'));
            }, 400);
        });

        it('should return proxy error, not send', function (done) {
            var nm = nodemailer.createTransport({
                pool: true,
                host: 'example.com',
                port: 25,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                maxConnections: 1,
                logger: false,
                debug: true
            });

            nm.getSocket = function (options, callback) {
                return callback(new Error('PROXY ERROR'));
            };

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err) {
                nm.close();
                expect(err).to.exist;
                done();
            });
        });

        it('should send using proxy call', function (done) {
            var nm = nodemailer.createTransport({
                pool: true,
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                maxConnections: 1,
                logger: false,
                debug: true
            });

            var socketCreated = false;

            nm.getSocket = function (options, callback) {
                var socket = net.connect(PORT_NUMBER, 'localhost', function () {
                    socketCreated = true;
                    return callback(null, {
                        connection: socket
                    });
                });
            };

            var mailData = {
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            };

            nm.sendMail(mailData, function (err, info) {
                nm.close();
                expect(socketCreated).to.be.true;
                expect(err).to.not.exist;
                expect(info.accepted).to.deep.equal(['to1@valid.recipient', 'to2@valid.recipient']);
                done();
            });
        });

        it('should send mail on idle', function (done) {
            var nm = nodemailer.createTransport({
                pool: true,
                host: 'localhost',
                port: PORT_NUMBER,
                auth: {
                    user: 'testuser',
                    pass: 'testpass'
                },
                ignoreTLS: true,
                logger: false,
                debug: true
            });

            var mailData = [{
                from: 'from@valid.sender',
                sender: 'sender@valid.sender',
                to: ['to1@valid.recipient', 'to2@valid.recipient', 'to@invalid.recipient'],
                subject: 'test',
                date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
                messageId: 'abc@def',
                xMailer: 'aaa',
                text: 'uuu'
            }];

            nm.on('idle', function () {
                if (nm.isIdle() && mailData.length) {
                    nm.sendMail(mailData.pop(), function (err, info) {
                        nm.close();
                        expect(err).to.not.exist;
                        expect(info.accepted).to.deep.equal([
                            'to1@valid.recipient',
                            'to2@valid.recipient'
                        ]);
                        expect(info.rejected).to.deep.equal([
                            'to@invalid.recipient'
                        ]);
                        expect(info.messageId).to.equal('abc@def');
                        expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
                        done();
                    });
                }
            });
        });
    });
});

describe('direct-transport tests', function () {

    this.timeout(10000); // eslint-disable-line no-invalid-this
    var server;
    var retryCount = 0;

    beforeEach(function (done) {
        server = new SMTPServer({
            disabledCommands: ['STARTTLS', 'AUTH'],

            onData: function (stream, session, callback) {
                stream.on('data', function () {});
                stream.on('end', function () {
                    var err;
                    if (/retry@/.test(session.envelope.mailFrom.address) && retryCount++ < 3) {
                        err = new Error('Please try again later');
                        err.responseCode = 451;
                        return callback(err);
                    } else {
                        return callback(null, 'OK');
                    }
                });
            },

            onMailFrom: function (address, session, callback) {
                if (/invalid@/.test(address.address)) {
                    return callback(new Error('Invalid sender'));
                }
                return callback(); // Accept the address
            },
            onRcptTo: function (address, session, callback) {
                if (/invalid@/.test(address.address)) {
                    return callback(new Error('Invalid recipient'));
                }
                return callback(); // Accept the address
            },
            logger: false
        });

        server.listen(PORT_NUMBER, done);
    });

    afterEach(function (done) {
        server.close(done);
    });

    it('should send mail', function (done) {
        var nm = nodemailer.createTransport({
            direct: true,
            port: PORT_NUMBER,
            logger: false,
            debug: true
        });

        var mailData = {
            from: 'from@valid.sender',
            to: ['test@[127.0.0.1]'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu'
        };

        nm.sendMail(mailData, function (err, info) {
            nm.close();
            expect(err).to.not.exist;
            expect(info.accepted).to.deep.equal([
                'test@[127.0.0.1]'
            ]);
            expect(info.rejected).to.deep.equal([]);
            expect(info.messageId).to.equal('abc@def');
            done();
        });
    });

    it('should send mail using connection url', function (done) {
        var nm = nodemailer.createTransport('direct:?port=' + PORT_NUMBER + '&logger=false&debug=true');

        var mailData = {
            from: 'from@valid.sender',
            to: ['test@[127.0.0.1]'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: 'uuu'
        };

        nm.sendMail(mailData, function (err, info) {
            nm.close();
            expect(err).to.not.exist;
            expect(info.accepted).to.deep.equal([
                'test@[127.0.0.1]'
            ]);
            expect(info.rejected).to.deep.equal([]);
            expect(info.messageId).to.equal('abc@def');
            done();
        });
    });

    it('should return stream error, not send', function (done) {
        var nm = nodemailer.createTransport({
            direct: true,
            port: PORT_NUMBER,
            logger: false,
            debug: true
        });

        var mailData = {
            from: 'from@valid.sender',
            sender: 'sender@valid.sender',
            to: ['test@[127.0.0.1]'],
            subject: 'test',
            date: new Date('Mon, 31 Jan 2011 23:01:00 +0000'),
            messageId: 'abc@def',
            xMailer: 'aaa',
            text: new stream.PassThrough()
        };

        nm.sendMail(mailData, function (err) {
            nm.close();
            expect(err).to.exist;
            done();
        });

        mailData.text.write('teretere');
        setTimeout(function () {
            mailData.text.emit('error', new Error('Stream error'));
        }, 400);
    });
});

describe('Generated messages tests', function () {
    it('should set Message-Id automatically', function (done) {
        var nm = nodemailer.createTransport({
            transport: 'stub'
        });
        var mailData = {
            from: 'Sender Name 👻 <sender@example.com>',
            to: ['Recipient Name 1 👻 <recipient1@example.com>', 'Recipient Name 2 👻 <recipient2@example.com>'],
            subject: 'test 💀',
            text: 'test message 👽'
        };
        nm.sendMail(mailData, function (err, info) {
            expect(err).to.not.exist;
            expect(info.envelope).to.deep.equal({
                from: 'sender@example.com',
                to: ['recipient1@example.com', 'recipient2@example.com']
            });
            expect(info.messageId).to.exist;
            expect(info.response.toString()).to.exist;
            done();
        });
    });

    it('should set List-* headers', function (done) {
        var nm = nodemailer.createTransport(stubTransport());
        var mailData = {
            list: {
                help: [
                    // keep indent
                    {
                        url: 'list@host.com?subject=help',
                        comment: 'List Instructions'
                    }, 'list-manager@host.com?body=info', {
                        url: 'list-info@host.com>',
                        comment: 'Info about the list'
                    },
                    [
                        'http://www.host.com/list/', 'list-info@host.com'
                    ],
                    [
                        // keep indent
                        {
                            url: 'ftp://ftp.host.com/list.txt',
                            comment: 'FTP'
                        },
                        'list@host.com?subject=help'
                    ]
                ],
                unsubscribe: [
                    'list@host.com?subject=unsubscribe', {
                        url: 'list-manager@host.com?body=unsubscribe%20list',
                        commend: 'Use this command to get off the list'
                    },
                    'list-off@host.com', [
                        'http://www.host.com/list.cgi?cmd=unsub&lst=list',
                        'list-request@host.com?subject=unsubscribe'
                    ]
                ],
                post: [
                    [
                        'admin@exmaple.com?subject=post',
                        'admin@exmaple2.com?subject=post'
                    ]
                ]
            }
        };
        nm.sendMail(mailData, function (err, info) {
            expect(err).to.not.exist;
            expect(info.response.toString().match(/^List\-/gim).length).to.equal(10);
            done();
        });
    });

    it('should send mail using a template', function (done) {
        var nm = nodemailer.createTransport(stubTransport());

        var sendPwdReminder = nm.templateSender({
            subject: 'Password reminder for {{username}}!',
            text: 'Hello, {{username}}, Your password is: {{ password }}',
            html: '<b>Hello, <strong>{{username}}</strong>, Your password is:\n<b>{{ password }}</b></p>'
        }, {
            from: 'sender@example.com',
            headers: {
                'X-Key1': 'value1'
            }
        });

        sendPwdReminder(
            // keep indent
            {
                to: 'receiver@example.com',
                headers: {
                    'X-Key2': 'value2'
                }
            }, {
                username: 'Node Mailer',
                password: '!"\'<>&some-thing'
            }
        ).then(function (info) {
            var msg = info.response.toString();

            expect(msg.indexOf('\r\nFrom: sender@example.com\r\n')).to.be.gte(0);
            expect(msg.indexOf('\r\nTo: receiver@example.com\r\n')).to.be.gte(0);

            expect(msg.indexOf('\r\nX-Key1: value1\r\n')).to.be.gte(0);
            expect(msg.indexOf('\r\nX-Key2: value2\r\n')).to.be.gte(0);

            expect(msg.indexOf('\r\nSubject: Password reminder for Node Mailer!\r\n')).to.be.gte(0);
            expect(msg.indexOf('\r\nHello, Node Mailer, Your password is: !"\'<>&some-thing\r\n')).to.be.gte(0);
            expect(msg.indexOf('\n<b>!&quot;&#039;&lt;&gt;&amp;some-thing</b></p>\r\n')).to.be.gte(0);

            done();
        }).catch(function (err) {
            expect(err).to.not.exist;
        });
    });

    it('should send mail using external renderer', function (done) {
        var nm = nodemailer.createTransport(stubTransport());

        var sendWelcome = nm.templateSender(new EmailTemplate(templateDir), {
            from: 'sender@example.com'
        });

        sendWelcome(
            // keep indent
            {
                to: 'receiver@example.com'
            }, {
                name: {
                    first: 'Node',
                    last: 'Mailer'
                }
            }
        ).then(function (info) {
            var msg = info.response.toString();

            expect(msg.indexOf('\nHello Mailer, Node!\n')).to.be.gte(0);
            expect(msg.indexOf('<h1 style="text-align: center;">Hello Mailer, Node!</h1>')).to.be.gte(0);

            done();
        }).catch(function (err) {
            expect(err).to.not.exist;
        });
    });

    it('should use pregenerated message', function (done) {
        var nm = nodemailer.createTransport(stubTransport());
        var raw = 'Content-Type: text/plain\r\n' +
            'Subject: test message\r\n' +
            '\r\n' +
            'Hello world!';
        var mailData = {
            raw: raw
        };
        nm.sendMail(mailData, function (err, info) {
            expect(err).to.not.exist;
            expect(info.response.toString()).to.equal(raw);
            done();
        });
    });
});
