/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const MailComposer = require('../../lib/mail-composer');
const sinon = require('sinon');
const expect = chai.expect;

chai.config.includeStack = true;

describe('MailComposer unit tests', function () {
    it('should create new MailComposer', function () {
        expect(new MailComposer({})).to.exist;
    });

    describe('#compile', function () {
        it('should use Mixed structure with text and attachment', function () {
            let data = {
                text: 'abc',
                attachments: [
                    {
                        content: 'abc'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createMixed');
            compiler.compile();
            expect(compiler._createMixed.callCount).to.equal(1);
            compiler._createMixed.restore();
        });

        it('should use Mixed structure with multiple attachments', function () {
            let data = {
                attachments: [
                    {
                        content: 'abc'
                    },
                    {
                        content: 'def'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createMixed');
            compiler.compile();
            expect(compiler._createMixed.callCount).to.equal(1);
            compiler._createMixed.restore();
        });

        it('should create Alternative structure with text and html', function () {
            let data = {
                text: 'abc',
                html: 'def'
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);

            expect(compiler._alternatives.length).to.equal(2);
            expect(compiler._alternatives[0].contentType).to.equal('text/plain; charset=utf-8');
            expect(compiler._alternatives[1].contentType).to.equal('text/html; charset=utf-8');

            compiler._createAlternative.restore();
        });

        it('should create Alternative structure with text, watchHtml and html', function () {
            let data = {
                text: 'abc',
                html: 'def',
                watchHtml: 'ghi'
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            expect(compiler._alternatives.length).to.equal(3);
            expect(compiler._alternatives[0].contentType).to.equal('text/plain; charset=utf-8');
            expect(compiler._alternatives[1].contentType).to.equal('text/watch-html; charset=utf-8');
            expect(compiler._alternatives[2].contentType).to.equal('text/html; charset=utf-8');
            compiler._createAlternative.restore();
        });

        it('should create Alternative structure with text, amp and html', function () {
            let data = {
                text: 'abc',
                html: 'def',
                amp: 'ghi'
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            expect(compiler._alternatives.length).to.equal(3);
            expect(compiler._alternatives[0].contentType).to.equal('text/plain; charset=utf-8');
            expect(compiler._alternatives[1].contentType).to.equal('text/x-amp-html; charset=utf-8');
            expect(compiler._alternatives[2].contentType).to.equal('text/html; charset=utf-8');
            compiler._createAlternative.restore();
        });

        it('should create Alternative structure with text, icalEvent and html', function () {
            let data = {
                text: 'abc',
                html: 'def',
                icalEvent: 'ghi'
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            expect(compiler._alternatives.length).to.equal(3);
            expect(compiler._alternatives[0].contentType).to.equal('text/plain; charset=utf-8');
            expect(compiler._alternatives[1].contentType).to.equal('text/html; charset=utf-8');
            expect(compiler._alternatives[2].contentType).to.equal('text/calendar; charset=utf-8; method=PUBLISH');
            compiler._createAlternative.restore();
        });

        it('should create Alternative structure using encoded icalEvent', function (done) {
            let data = {
                text: 'abc',
                html: 'def',
                icalEvent: {
                    method: 'publish',
                    content:
                        'dGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZQ==',
                    encoding: 'base64'
                }
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile().build(function (err, message) {
                expect(err).to.not.exist;
                let msg = message.toString();
                expect(
                    msg.indexOf('\r\ntere tere tere tere tere tere tere tere tere tere tere tere tere tere tere =\r\ntere tere tere tere tere tere tere\r\n')
                ).to.be.gte(0);
                expect(
                    msg.indexOf(
                        '\r\ndGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRl\r\ncmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZSB0ZXJlIHRlcmUgdGVyZQ==\r\n'
                    )
                ).to.be.gte(0);
                done();
            });
        });

        it('should create Alternative structure with text, html and cid attachment', function () {
            let data = {
                text: 'abc',
                html: 'def',
                attachments: [
                    {
                        content: 'abc',
                        cid: 'aaa'
                    },
                    {
                        content: 'def',
                        cid: 'bbb'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            compiler._createAlternative.restore();
        });

        it('should create Related structure with html and cid attachment', function () {
            let data = {
                html: 'def',
                attachments: [
                    {
                        content: 'abc',
                        cid: 'aaa'
                    },
                    {
                        content: 'def',
                        cid: 'bbb'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createRelated');
            compiler.compile();
            expect(compiler._createRelated.callCount).to.equal(1);
            compiler._createRelated.restore();
        });

        it('should create content node with only text', function () {
            let data = {
                text: 'def'
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createContentNode');
            compiler.compile();
            expect(compiler._createContentNode.callCount).to.equal(1);
            compiler._createContentNode.restore();
        });

        it('should create content node with only an attachment', function () {
            let data = {
                attachments: [
                    {
                        content: 'abc',
                        cid: 'aaa'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            sinon.spy(compiler, '_createContentNode');
            compiler.compile();
            expect(compiler._createContentNode.callCount).to.equal(1);
            compiler._createContentNode.restore();
        });

        it('should create content node with encoded buffer', function () {
            let str = 'tere tere';
            let data = {
                text: {
                    content: Buffer.from(str).toString('base64'),
                    encoding: 'base64'
                }
            };

            let compiler = new MailComposer(data);
            compiler.compile();
            expect(compiler.message.content).to.deep.equal(Buffer.from(str));
        });

        it('should create content node from data url', function () {
            let str = 'tere tere';
            let data = {
                attachments: [
                    {
                        href: 'data:image/png,tere%20tere'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            let mail = compiler.compile();
            expect(mail.messageId()).to.exist;
            expect(compiler.mail.attachments[0].content).to.deep.equal(Buffer.from(str));
            expect(compiler.mail.attachments[0].contentType).to.equal('image/png');
        });

        it('should not treat invalid content-type as multipart', function () {
            let data = {
                from: {
                    name: 'sender name',
                    address: 'sender@example.com'
                },
                to: [
                    {
                        address: 'andris@ethereal.email'
                    }
                ],
                subject: 'Hello world!',
                text: 'Test message',
                attachments: [
                    {
                        contentType: 'other',
                        content: Buffer.from('tere').toString('base64'),
                        encoding: 'base64'
                    }
                ]
            };

            let compiler = new MailComposer(data);
            let mail = compiler.compile();
            let attachmentHeaders = mail.childNodes[1].buildHeaders();

            // attachment header must not contain mutipart header
            expect(attachmentHeaders.indexOf('boundary=')).to.lt(0);
        });

        it('should create the same output', function (done) {
            let data = {
                text: 'abc',
                html: 'def',
                baseBoundary: 'test',
                messageId: '<zzzzzz>',
                headers: {
                    'x-processed': 'a really long header or value with non-ascii characters 👮',
                    'x-unprocessed': {
                        prepared: true,
                        value: 'a really long header or value with non-ascii characters 👮'
                    }
                },
                date: 'Sat, 21 Jun 2014 10:52:44 +0000'
            };

            let expected =
                '' +
                'Content-Type: multipart/alternative; boundary="--_NmP-test-Part_1"\r\n' +
                'X-Processed: =?UTF-8?Q?a_really_long_header_or_value_with_non-a?=\r\n' +
                ' =?UTF-8?Q?scii_characters_=F0=9F=91=AE?=\r\n' +
                'X-Unprocessed: a really long header or value with non-ascii characters 👮\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'abc\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/html; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'def\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            expect(mail.messageId()).to.equal('<zzzzzz>');
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should use raw input for the message', function (done) {
            let data = {
                raw: 'test test test\r\n',
                envelope: {
                    from: 'Daemon <deamon@kreata.ee>',
                    to: 'mailer@kreata.ee, Mailer <mailer2@kreata.ee>'
                }
            };

            let expected = 'test test test\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(mail.getEnvelope()).to.deep.equal({
                    from: 'deamon@kreata.ee',
                    to: ['mailer@kreata.ee', 'mailer2@kreata.ee']
                });
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should use raw input for different parts', function (done) {
            let data = {
                from: 'test1@example.com',
                to: 'test2@example.com',
                bcc: 'test3@example.com',
                text: {
                    raw: 'rawtext'
                },
                html: {
                    raw: 'rawhtml'
                },
                watchHtml: {
                    raw: 'rawwatch'
                },
                amp: {
                    raw: 'rawamp'
                },
                messageId: 'rawtest',
                icalEvent: {
                    raw: 'rawcalendar'
                },
                attachments: [
                    {
                        raw: 'rawattachment'
                    }
                ],
                alternatives: [
                    {
                        raw: 'rawalternative'
                    }
                ],
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                baseBoundary: 'test'
            };

            let expected =
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'From: test1@example.com\r\n' +
                'To: test2@example.com\r\n' +
                'Message-ID: <rawtest>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: multipart/alternative; boundary="--_NmP-test-Part_2"\r\n' +
                '\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawtext\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawwatch\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawamp\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawhtml\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawcalendar\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'rawalternative\r\n' +
                '----_NmP-test-Part_2--\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'rawattachment\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'rawcalendar\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should discard BCC', function (done) {
            let data = {
                from: 'test1@example.com',
                to: 'test2@example.com',
                bcc: 'test3@example.com',
                text: 'def',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000'
            };

            let expected =
                '' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'From: test1@example.com\r\n' +
                'To: test2@example.com\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                'def\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should autodetect text encoding', function (done) {
            let data = {
                from: 'ÄÄÄÄ test1@example.com',
                to: 'AAAÄ test2@example.com',
                subject: 'def ÄÄÄÄ foo AAAÄ',
                text: 'def ÄÄÄÄ foo AAAÄ',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000'
            };

            let expected =
                '' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'From: =?UTF-8?B?w4TDhMOEw4Q=?= <test1@example.com>\r\n' +
                'To: =?UTF-8?Q?AAA=C3=84?= <test2@example.com>\r\n' +
                'Subject: =?UTF-8?Q?def_=C3=84=C3=84=C3=84=C3=84_foo_AAA?=\r\n' +
                ' =?UTF-8?Q?=C3=84?=\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                'def =C3=84=C3=84=C3=84=C3=84 foo AAA=C3=84\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should use quoted-printable text encoding', function (done) {
            let data = {
                from: 'ÄÄÄÄ test1@example.com',
                to: 'AAAÄ test2@example.com',
                subject: 'def ÄÄÄÄ foo AAAÄ',
                text: 'def ÄÄÄÄ foo AAAÄ',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                textEncoding: 'quoted-printable'
            };

            let expected =
                '' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'From: =?UTF-8?Q?=C3=84=C3=84=C3=84=C3=84?= <test1@example.com>\r\n' +
                'To: =?UTF-8?Q?AAA=C3=84?= <test2@example.com>\r\n' +
                'Subject: =?UTF-8?Q?def_=C3=84=C3=84=C3=84=C3=84_foo_AAA?=\r\n' +
                ' =?UTF-8?Q?=C3=84?=\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                'def =C3=84=C3=84=C3=84=C3=84 foo AAA=C3=84\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should use base64 text encoding', function (done) {
            let data = {
                from: 'ÄÄÄÄ test1@example.com',
                to: 'AAAÄ test2@example.com',
                subject: 'def ÄÄÄÄ foo AAAÄ',
                text: 'def ÄÄÄÄ foo AAAÄ',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                textEncoding: 'base64'
            };

            let expected =
                '' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'From: =?UTF-8?B?w4TDhMOEw4Q=?= <test1@example.com>\r\n' +
                'To: =?UTF-8?B?QUFBw4Q=?= <test2@example.com>\r\n' +
                'Subject: =?UTF-8?B?ZGVmIMOEw4TDhMOEIGZvbyBBQUHDhA==?=\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                'ZGVmIMOEw4TDhMOEIGZvbyBBQUHDhA==\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should keep BCC', function (done) {
            let data = {
                from: 'test1@example.com',
                to: 'test2@example.com',
                bcc: 'test3@example.com',
                text: 'def',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000'
            };

            let expected =
                '' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'From: test1@example.com\r\n' +
                'To: test2@example.com\r\n' +
                'Bcc: test3@example.com\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                'def\r\n';

            let mail = new MailComposer(data).compile();
            mail.keepBcc = true;
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should set headers for attachment', function (done) {
            let data = {
                text: 'abc',
                baseBoundary: 'test',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                attachments: [
                    {
                        headers: {
                            'X-Test-1': 12345,
                            'X-Test-2': 'ÕÄÖÜ',
                            'X-Test-3': ['foo', 'bar']
                        },
                        content: 'test',
                        filename: 'test.txt'
                    }
                ]
            };

            let expected =
                '' +
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'abc\r\n-' +
                '---_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; name=test.txt\r\n' +
                'X-Test-1: 12345\r\n' +
                'X-Test-2: =?UTF-8?B?w5XDhMOWw5w=?=\r\n' +
                'X-Test-3: foo\r\n' +
                'X-Test-3: bar\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment; filename=test.txt\r\n' +
                '\r\n' +
                'dGVzdA==\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should encode filename', function (done) {
            let data = {
                text: 'abc',
                baseBoundary: 'test',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                attachments: [
                    {
                        content: 'test',
                        filename: '"test" it is.txt'
                    }
                ]
            };

            let expected =
                '' +
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'abc\r\n-' +
                '---_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; name="=?UTF-8?Q?=22test=22_it_is=2Etxt?="\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment;\r\n' +
                " filename*0*=utf-8''%22test%22%20it%20is.txt\r\n" +
                '\r\n' +
                'dGVzdA==\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should keep plaintext for attachment', function (done) {
            let data = {
                text: 'abc',
                baseBoundary: 'test',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                attachments: [
                    {
                        headers: {
                            'X-Test-1': 12345,
                            'X-Test-2': 'ÕÄÖÜ',
                            'X-Test-3': ['foo', 'bar']
                        },
                        content: 'test',
                        filename: 'test.txt',
                        contentTransferEncoding: false
                    }
                ]
            };

            let expected =
                '' +
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'abc\r\n-' +
                '---_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; name=test.txt\r\n' +
                'X-Test-1: 12345\r\n' +
                'X-Test-2: =?UTF-8?B?w5XDhMOWw5w=?=\r\n' +
                'X-Test-3: foo\r\n' +
                'X-Test-3: bar\r\n' +
                'Content-Disposition: attachment; filename=test.txt\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'test\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should ignore attachment filename', function (done) {
            let data = {
                text: 'abc',
                baseBoundary: 'test',
                messageId: 'zzzzzz',
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                attachments: [
                    {
                        content: 'test',
                        filename: 'test.txt'
                    },
                    {
                        content: 'test2',
                        filename: false
                    }
                ]
            };

            let expected =
                '' +
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'Message-ID: <zzzzzz>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'abc\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: text/plain; name=test.txt\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment; filename=test.txt\r\n' +
                '\r\n' +
                'dGVzdA==\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'dGVzdDI=\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should add ical alternative', function (done) {
            let data = {
                from: 'test1@example.com',
                to: 'test2@example.com',
                bcc: 'test3@example.com',
                text: 'def',
                messageId: 'icaltest',
                icalEvent: {
                    method: 'request',
                    content: Buffer.from('test').toString('hex'),
                    encoding: 'hex'
                },
                date: 'Sat, 21 Jun 2014 10:52:44 +0000',
                baseBoundary: 'test'
            };

            let expected =
                '' +
                'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                'From: test1@example.com\r\n' +
                'To: test2@example.com\r\n' +
                'Message-ID: <icaltest>\r\n' +
                'Date: Sat, 21 Jun 2014 10:52:44 +0000\r\n' +
                'MIME-Version: 1.0\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: multipart/alternative; boundary="--_NmP-test-Part_2"\r\n' +
                '\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'Content-Type: text/plain; charset=utf-8\r\n' +
                'Content-Transfer-Encoding: 7bit\r\n' +
                '\r\n' +
                'def\r\n' +
                '----_NmP-test-Part_2\r\n' +
                'Content-Type: text/calendar; charset=utf-8; method=REQUEST\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                '\r\n' +
                'test\r\n' +
                '----_NmP-test-Part_2--\r\n' +
                '\r\n' +
                '----_NmP-test-Part_1\r\n' +
                'Content-Type: application/ics; name=invite.ics\r\n' +
                'Content-Disposition: attachment; filename=invite.ics\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                '\r\n' +
                'dGVzdA==\r\n' +
                '----_NmP-test-Part_1--\r\n';

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.equal(expected);
                done();
            });
        });

        it('should use load attachment from file', function (done) {
            let data = {
                text: 'abc',
                attachments: [
                    {
                        path: __dirname + '/fixtures/attachment.bin'
                    }
                ]
            };

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.not.exist;
                expect(message.toString()).to.include('w7VrdmEK');
                done();
            });
        });

        it('should not load attachment from file', function (done) {
            let data = {
                text: 'abc',
                attachments: [
                    {
                        path: __dirname + '/fixtures/attachment.bin'
                    }
                ],
                disableFileAccess: true
            };

            let mail = new MailComposer(data).compile();
            mail.build(function (err, message) {
                expect(err).to.exist;
                expect(message).to.not.exist;
                done();
            });
        });
    });
});
