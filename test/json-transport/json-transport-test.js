'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const nodemailer = require('../../lib/nodemailer');

describe('JSON Transport Tests', () => {
    it('should return an JSON string', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: {
                path: __dirname + '/fixtures/body.html'
            },
            text: 'hello world',
            attachments: [
                {
                    filename: 'img.png',
                    path: __dirname + '/fixtures/image.png'
                },
                {
                    path: __dirname + '/fixtures/image.png'
                }
            ]
        };

        transport.sendMail(messageObject, (err, info) => {
            assert.ok(!err);
            assert.ok(info);
            assert.deepStrictEqual(JSON.parse(info.message), {
                from: {
                    address: 'andris.reinman@gmail.com',
                    name: 'Andris Reinman'
                },
                to: [
                    //
                    {
                        address: 'andris@kreata.ee',
                        name: 'Andris Kreata'
                    },
                    {
                        address: 'andris@nodemailer.com',
                        name: ''
                    }
                ],
                cc: [
                    {
                        address: 'info@nodemailer.com',
                        name: ''
                    }
                ],
                subject: 'Awesome!',
                html: '<h1>Message</h1>\n\n<p>\n    Body\n</p>\n',
                text: 'hello world',
                attachments: [
                    {
                        content:
                            'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
                        filename: 'img.png',
                        contentType: 'image/png',
                        encoding: 'base64'
                    },
                    {
                        content:
                            'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
                        filename: 'image.png',
                        contentType: 'image/png',
                        encoding: 'base64'
                    }
                ],
                headers: {},
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>'
            });
            done();
        });
    });

    it('should return an JSON string for calendar event', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true
        });

        let messageObject = {
            from: 'Andris Reinman <andris.reinman@gmail.com>',
            to: 'Andris Kreata <andris@kreata.ee>, andris@nodemailer.com',
            cc: 'info@nodemailer.com',
            subject: 'Awesome!',
            messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>',
            html: '<p>hello world!</p>',
            text: 'hello world',
            icalEvent: {
                method: 'request',
                path: __dirname + '/fixtures/event.ics'
            }
        };

        transport.sendMail(messageObject, (err, info) => {
            assert.ok(!err);
            assert.ok(info);
            assert.deepStrictEqual(JSON.parse(info.message), {
                from: {
                    address: 'andris.reinman@gmail.com',
                    name: 'Andris Reinman'
                },
                to: [
                    //
                    {
                        address: 'andris@kreata.ee',
                        name: 'Andris Kreata'
                    },
                    {
                        address: 'andris@nodemailer.com',
                        name: ''
                    }
                ],
                cc: [
                    {
                        address: 'info@nodemailer.com',
                        name: ''
                    }
                ],
                subject: 'Awesome!',
                text: 'hello world',

                html: '<p>hello world!</p>',
                icalEvent: {
                    content:
                        'QkVHSU46VkNBTEVOREFSClZFUlNJT046Mi4wClBST0RJRDotLy9oYWNrc3cvaGFuZGNhbC8vTk9OU0dNTCB2MS4wLy9FTgpCRUdJTjpWRVZFTlQKVUlEOnVpZDFAZXhhbXBsZS5jb20KRFRTVEFNUDoxOTk3MDcxNFQxNzAwMDBaCk9SR0FOSVpFUjtDTj1Kb2huIERvZTpNQUlMVE86am9obi5kb2VAZXhhbXBsZS5jb20KRFRTVEFSVDoxOTk3MDcxNFQxNzAwMDBaCkRURU5EOjE5OTcwNzE1VDAzNTk1OVoKU1VNTUFSWTpCYXN0aWxsZSBEYXkgUGFydHkKRU5EOlZFVkVOVApFTkQ6VkNBTEVOREFSCg==',
                    encoding: 'base64',
                    method: 'request'
                },

                headers: {},
                messageId: '<fede478a-aab9-af02-789c-ad93a76a3548@gmail.com>'
            });
            done();
        });
    });
});

describe('JSON Transport access control (disableFileAccess / disableUrlAccess)', () => {
    let port = 10399;
    let server;

    before((t, done) => {
        server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('SECRET_URL_BODY');
        });
        server.listen(port, done);
    });

    after((t, done) => {
        server.close(done);
    });

    it('should reject attachment file access when disableFileAccess is set', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true,
            disableFileAccess: true
        });

        transport.sendMail(
            {
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'file',
                text: 'body',
                attachments: [{ filename: 'secret.txt', path: __dirname + '/fixtures/body.html' }]
            },
            err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            }
        );
    });

    it('should reject URL content access when disableUrlAccess is set', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true,
            disableUrlAccess: true
        });

        transport.sendMail(
            {
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'url',
                text: { href: 'http://127.0.0.1:' + port + '/private' }
            },
            err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EURLACCESS');
                done();
            }
        );
    });

    it('should reject attachDataUrls html file access when disableFileAccess is set', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true,
            attachDataUrls: true,
            disableFileAccess: true
        });

        transport.sendMail(
            {
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'datauri',
                html: { path: __dirname + '/fixtures/body.html' }
            },
            err => {
                assert.ok(err);
                assert.strictEqual(err.code, 'EFILEACCESS');
                done();
            }
        );
    });

    it('should still resolve file attachments when the flags are not set', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true
        });

        transport.sendMail(
            {
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'file',
                text: 'body',
                attachments: [{ filename: 'body.html', path: __dirname + '/fixtures/body.html' }]
            },
            (err, info) => {
                assert.ok(!err);
                let message = JSON.parse(info.message);
                assert.ok(message.attachments[0].content);
                done();
            }
        );
    });

    it('should still resolve URL content when the flags are not set', (t, done) => {
        let transport = nodemailer.createTransport({
            jsonTransport: true
        });

        transport.sendMail(
            {
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'url',
                text: { href: 'http://127.0.0.1:' + port + '/private' }
            },
            (err, info) => {
                assert.ok(!err);
                assert.strictEqual(JSON.parse(info.message).text, 'SECRET_URL_BODY');
                done();
            }
        );
    });
});
