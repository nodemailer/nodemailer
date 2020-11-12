/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const nodemailer = require('../../lib/nodemailer');
const chai = require('chai');
const expect = chai.expect;
chai.config.includeStack = true;

describe('JSON Transport Tests', function () {
    it('should return an JSON string', function (done) {
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
            expect(err).to.not.exist;
            expect(info).to.exist;
            expect(JSON.parse(info.message)).to.deep.equal({
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

    it('should return an JSON string for calendar event', function (done) {
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
            expect(err).to.not.exist;
            expect(info).to.exist;
            expect(JSON.parse(info.message)).to.deep.equal({
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
