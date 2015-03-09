'use strict';

var chai = require('chai');
var nodemailer = require('../src/nodemailer');
var sinon = require('sinon');
var http = require('http');
var fs = require('fs');
var expect = chai.expect;
var SMTPServer = require('smtp-server').SMTPServer;
var crypto = require('crypto');

chai.config.includeStack = true;

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

        it('return invalid configuration error', function(done) {
            nm = nodemailer.createTransport('SMTP', {});
            nm.sendMail({
                subject: 'test',
                xMailer: 'yyyy'
            }, function(err) {
                expect(err).to.exist;
                done();
            });
        });
    });

    describe('Resolver tests', function() {
        var port = 10337;
        var server;

        beforeEach(function(done) {
            server = http.createServer(function(req, res) {
                res.writeHead(200, {
                    'Content-Type': 'text/plain'
                });
                res.end('<p>Tere, tere</p><p>vana kere!</p>');
            });

            server.listen(port, done);
        });

        afterEach(function(done) {
            server.close(done);
        });

        it('should set text from html string', function(done) {
            var mail = {
                data: {
                    html: '<p>Tere, tere</p><p>vana kere!</p>'
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(value).to.equal('<p>Tere, tere</p><p>vana kere!</p>');
                done();
            });
        });

        it('should set text from html buffer', function(done) {
            var mail = {
                data: {
                    html: new Buffer('<p>Tere, tere</p><p>vana kere!</p>')
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(mail.data.html);
                done();
            });
        });

        it('should set text from a html file', function(done) {
            var mail = {
                data: {
                    html: {
                        path: __dirname + '/fixtures/message.html'
                    }
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(new Buffer('<p>Tere, tere</p><p>vana kere!</p>'));
                done();
            });
        });

        it('should set text from an html url', function(done) {
            var mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + port + '/message.html'
                    }
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(new Buffer('<p>Tere, tere</p><p>vana kere!</p>'));
                done();
            });
        });

        it('should set text from a html stream', function(done) {
            var mail = {
                data: {
                    html: fs.createReadStream(__dirname + '/fixtures/message.html')
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(mail).to.deep.equal({
                    data: {
                        html: new Buffer('<p>Tere, tere</p><p>vana kere!</p>')
                    }
                });
                expect(value).to.deep.equal(new Buffer('<p>Tere, tere</p><p>vana kere!</p>'));
                done();
            });
        });

        it('should return an error', function(done) {
            var mail = {
                data: {
                    html: {
                        path: 'http://localhost:' + (port + 1000) + '/message.html'
                    }
                }
            };
            nm.resolveContent(mail.data, 'html', function(err) {
                expect(err).to.exist;
                done();
            });
        });

        it('should return encoded string as buffer', function(done) {
            var str = '<p>Tere, tere</p><p>vana kere!</p>';
            var mail = {
                data: {
                    html: {
                        encoding: 'base64',
                        content: new Buffer(str).toString('base64')
                    }
                }
            };
            nm.resolveContent(mail.data, 'html', function(err, value) {
                expect(err).to.not.exist;
                expect(value).to.deep.equal(new Buffer(str));
                done();
            });
        });

        describe('data uri tests', function() {

            it('should resolve with mime type and base64', function(done) {
                var mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                nm.resolveContent(mail.data, 'attachment', function(err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(new Buffer('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64'));
                    done();
                });
            });

            it('should resolve with mime type and plaintext', function(done) {
                var mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png,tere%20tere'
                        }
                    }
                };
                nm.resolveContent(mail.data, 'attachment', function(err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(new Buffer('tere tere'));
                    done();
                });
            });

            it('should resolve with plaintext', function(done) {
                var mail = {
                    data: {
                        attachment: {
                            path: 'data:,tere%20tere'
                        }
                    }
                };
                nm.resolveContent(mail.data, 'attachment', function(err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(new Buffer('tere tere'));
                    done();
                });
            });

            it('should resolve with mime type, charset and base64', function(done) {
                var mail = {
                    data: {
                        attachment: {
                            path: 'data:image/png;charset=iso-8859-1;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='
                        }
                    }
                };
                nm.resolveContent(mail.data, 'attachment', function(err, value) {
                    expect(err).to.not.exist;
                    expect(value).to.deep.equal(new Buffer('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64'));
                    done();
                });
            });
        });
    });
});

describe('Nodemailer integration tests', function() {
    var server;

    beforeEach(function(done) {
        server = new SMTPServer({
            authMethods: ['PLAIN', 'XOAUTH2'],
            disabledCommands: ['STARTTLS'],

            onData: function(stream, session, callback) {
                var hash = crypto.createHash('md5');
                stream.on('data', function(chunk) {
                    hash.update(chunk);
                });
                stream.on('end', function() {
                    callback(null, hash.digest('hex'));
                });
            },

            onAuth: function(auth, session, callback) {
                if (auth.method !== 'XOAUTH2') {
                    if (auth.username !== 'testuser' || auth.password !== 'testpass') {
                        return callback(new Error('Invalid username or password'));
                    }
                } else {
                    if (auth.username !== 'testuser' || auth.accessToken !== 'testtoken') {
                        return callback(null, {
                            data: {
                                status: '401',
                                schemes: 'bearer mac',
                                scope: 'my_smtp_access_scope_name'
                            }
                        });
                    }
                }
                callback(null, {
                    user: 123
                });
            },
            onMailFrom: function(address, session, callback) {
                if (!/@valid.sender/.test(address.address)) {
                    return callback(new Error('Only user@valid.sender is allowed to send mail'));
                }
                return callback(); // Accept the address
            },
            onRcptTo: function(address, session, callback) {
                if (!/@valid.recipient/.test(address.address)) {
                    return callback(new Error('Only user@valid.recipient is allowed to receive mail'));
                }
                return callback(); // Accept the address
            },
            logger: false
        });

        server.listen(PORT_NUMBER, done);
    });

    afterEach(function(done) {
        server.close(done);
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
            sender: 'sender@valid.sender',
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
            expect(/538ec1431ce376bc46f11b0f51849beb/i.test(info.response)).to.be.true;
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