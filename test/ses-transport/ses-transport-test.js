/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const nodemailer = require('../../lib/nodemailer');
const chai = require('chai');
const expect = chai.expect;
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

describe('SES Transport Tests', function() {
    this.timeout(50 * 1000); // eslint-disable-line no-invalid-this

    it('should return MessageId', function(done) {
        let transport = nodemailer.createTransport({
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                // Prevent tests from actually sending mail by mocking sendRawEmail
                sendRawEmail: (message, cb) => {
                    setImmediate(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    });
                }
            }
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: {
                path: __dirname + '/../json-transport/fixtures/body.html'
            },
            text: 'hello world',
            attachments: [
                {
                    filename: 'image.png',
                    path: __dirname + '/../json-transport/fixtures/image.png'
                }
            ]
        };

        transport.sendMail(messageObject, (err, info) => {
            expect(err).to.not.exist;
            expect(info).to.exist;
            expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
            expect(info.envelope).to.deep.equal({
                from: 'andris.reinman@gmail.com',
                to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
            });
            expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
            expect(info.response).to.equal('testtest');
            done();
        });
    });

    it('should sign message with DKIM', function(done) {
        let transport = nodemailer.createTransport({
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    expect(message.RawMessage.Data.toString()).to.include('h=from:subject:to:cc:mime-version:content-type;');
                    setImmediate(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    });
                }
            },
            dkim: {
                domainName: 'node.ee',
                keySelector: 'dkim',
                privateKey
            }
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: {
                path: __dirname + '/../json-transport/fixtures/body.html'
            },
            text: 'hello world',
            attachments: [
                {
                    filename: 'image.png',
                    path: __dirname + '/../json-transport/fixtures/image.png'
                }
            ]
        };

        transport.sendMail(messageObject, (err, info) => {
            expect(err).to.not.exist;
            expect(info).to.exist;
            expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
            expect(info.envelope).to.deep.equal({
                from: 'andris.reinman@gmail.com',
                to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
            });
            expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
            expect(info.response).to.equal('testtest');
            done();
        });
    });

    it('should limit parallel connections', function(done) {
        let transport = nodemailer.createTransport({
            maxConnections: 2,
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    setTimeout(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    }, 100);
                }
            }
        });

        let total = 100;
        let finished = 0;
        let start = Date.now();

        for (let i = 0; i < total; i++) {
            let messageObject = {
                from: 'Andris Reinman <andris.reinman@gmail.com>',
                to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
                cc: 'info@nodemailer.com',
                subject: 'Awesome!',
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
                html: {
                    path: __dirname + '/../json-transport/fixtures/body.html'
                },
                text: 'hello world',
                attachments: [
                    {
                        filename: 'image.png',
                        path: __dirname + '/../json-transport/fixtures/image.png'
                    }
                ]
            };

            transport.sendMail(messageObject, (err, info) => {
                finished++;
                expect(err).to.not.exist;
                expect(info).to.exist;
                expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
                expect(info.envelope).to.deep.equal({
                    from: 'andris.reinman@gmail.com',
                    to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
                });
                expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
                expect(info.response).to.equal('testtest');

                if (total === finished) {
                    expect(Date.now() - start).to.be.gte(5000);
                    expect(Date.now() - start).to.be.lte(10000);
                    return done();
                }
            });
        }
    });

    it('should rate limit messages', function(done) {
        let transport = nodemailer.createTransport({
            sendingRate: 10,
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    setTimeout(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    }, 100);
                }
            }
        });

        let total = 100;
        let finished = 0;
        let start = Date.now();

        for (let i = 0; i < total; i++) {
            let messageObject = {
                from: 'Andris Reinman <andris.reinman@gmail.com>',
                to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
                cc: 'info@nodemailer.com',
                subject: 'Awesome!',
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
                html: {
                    path: __dirname + '/../json-transport/fixtures/body.html'
                },
                text: 'hello world',
                attachments: [
                    {
                        filename: 'image.png',
                        path: __dirname + '/../json-transport/fixtures/image.png'
                    }
                ]
            };

            transport.sendMail(messageObject, (err, info) => {
                finished++;
                expect(err).to.not.exist;
                expect(info).to.exist;
                expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
                expect(info.envelope).to.deep.equal({
                    from: 'andris.reinman@gmail.com',
                    to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
                });
                expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
                expect(info.response).to.equal('testtest');

                if (total === finished) {
                    expect(Date.now() - start).to.be.gte(10000);
                    expect(Date.now() - start).to.be.lte(15000);
                    return done();
                }
            });
        }
    });

    it('should rate limit long messages', function(done) {
        let transport = nodemailer.createTransport({
            sendingRate: 30,
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    setTimeout(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    }, 3000);
                }
            }
        });

        let total = 100;
        let finished = 0;
        let start = Date.now();

        for (let i = 0; i < total; i++) {
            let messageObject = {
                from: 'Andris Reinman <andris.reinman@gmail.com>',
                to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
                cc: 'info@nodemailer.com',
                subject: 'Awesome!',
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
                html: {
                    path: __dirname + '/../json-transport/fixtures/body.html'
                },
                text: 'hello world',
                attachments: [
                    {
                        filename: 'image.png',
                        path: __dirname + '/../json-transport/fixtures/image.png'
                    }
                ]
            };

            transport.sendMail(messageObject, (err, info) => {
                finished++;
                expect(err).to.not.exist;
                expect(info).to.exist;
                expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
                expect(info.envelope).to.deep.equal({
                    from: 'andris.reinman@gmail.com',
                    to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
                });
                expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
                expect(info.response).to.equal('testtest');

                if (total === finished) {
                    expect(Date.now() - start).to.be.gte(12000);
                    expect(Date.now() - start).to.be.lte(15000);
                    return done();
                }
            });
        }
    });

    it('should rate limit messages and connections', function(done) {
        let transport = nodemailer.createTransport({
            sendingRate: 100,
            maxConnections: 1,
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    setTimeout(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    }, 100);
                }
            }
        });

        let total = 100;
        let finished = 0;
        let start = Date.now();

        for (let i = 0; i < total; i++) {
            let messageObject = {
                from: 'Andris Reinman <andris.reinman@gmail.com>',
                to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
                cc: 'info@nodemailer.com',
                subject: 'Awesome!',
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
                html: {
                    path: __dirname + '/../json-transport/fixtures/body.html'
                },
                text: 'hello world',
                attachments: [
                    {
                        filename: 'image.png',
                        path: __dirname + '/../json-transport/fixtures/image.png'
                    }
                ]
            };

            transport.sendMail(messageObject, (err, info) => {
                finished++;
                expect(err).to.not.exist;
                expect(info).to.exist;

                expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
                expect(info.envelope).to.deep.equal({
                    from: 'andris.reinman@gmail.com',
                    to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
                });
                expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
                expect(info.response).to.equal('testtest');

                if (total === finished) {
                    expect(Date.now() - start).to.be.gte(10000);
                    expect(Date.now() - start).to.be.lte(15000);
                    return done();
                }
            });
        }
    });

    it('detect sending slots on idle events', function(done) {
        let transport = nodemailer.createTransport({
            sendingRate: 100,
            maxConnections: 1,
            SES: {
                config: {
                    region: 'eu-west-1'
                },
                sendRawEmail: (message, cb) => {
                    setTimeout(() => {
                        cb(null, {
                            MessageId: 'testtest'
                        });
                    }, 100);
                }
            }
        });

        let total = 100;
        let finished = 0;
        let start = Date.now();
        let sent = 0;

        let sendNext = () => {
            let messageObject = {
                from: 'Andris Reinman <andris.reinman@gmail.com>',
                to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
                cc: 'info@nodemailer.com',
                subject: 'Awesome!',
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
                html: {
                    path: __dirname + '/../json-transport/fixtures/body.html'
                },
                text: 'hello world',
                attachments: [
                    {
                        filename: 'image.png',
                        path: __dirname + '/../json-transport/fixtures/image.png'
                    }
                ]
            };

            transport.sendMail(messageObject, (err, info) => {
                finished++;
                expect(err).to.not.exist;
                expect(info).to.exist;
                expect(info).to.have.keys('envelope', 'messageId', 'response', 'raw');
                expect(info.envelope).to.deep.equal({
                    from: 'andris.reinman@gmail.com',
                    to: ['andris@kreata.ee', 'andris@nodemailer.com', 'info@nodemailer.com']
                });
                expect(info.messageId).to.equal('<testtest@eu-west-1.amazonses.com>');
                expect(info.response).to.equal('testtest');

                if (total === finished) {
                    expect(Date.now() - start).to.be.gte(10000);
                    expect(Date.now() - start).to.be.lte(15000);
                    return done();
                }
            });
        };

        transport.on('idle', () => {
            while (transport.isIdle() && sent < total) {
                sent++;
                sendNext();
            }
        });
    });
});
