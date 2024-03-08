'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const MimeNode = require('../../lib/mime-node');
const http = require('http');
const stream = require('stream');
const Transform = stream.Transform;
const PassThrough = stream.PassThrough;

describe('MimeNode Tests', { timeout: 50 * 1000 }, () => {
    it('should create MimeNode object', () => {
        assert.ok(new MimeNode());
    });

    describe('#createChild', () => {
        it('should create child', () => {
            let mb = new MimeNode('multipart/mixed');

            let child = mb.createChild('multipart/mixed');
            assert.strictEqual(child.parentNode, mb);
            assert.strictEqual(child.rootNode, mb);

            let subchild1 = child.createChild('text/html');
            assert.strictEqual(subchild1.parentNode, child);
            assert.strictEqual(subchild1.rootNode, mb);

            let subchild2 = child.createChild('text/html');
            assert.strictEqual(subchild2.parentNode, child);
            assert.strictEqual(subchild2.rootNode, mb);
        });
    });

    describe('#appendChild', () => {
        it('should append child node', () => {
            let mb = new MimeNode('multipart/mixed');

            let child = new MimeNode('text/plain');
            mb.appendChild(child);
            assert.strictEqual(child.parentNode, mb);
            assert.strictEqual(child.rootNode, mb);
            assert.strictEqual(mb.childNodes.length, 1);
            assert.strictEqual(mb.childNodes[0], child);
        });
    });

    describe('#replace', () => {
        it('should replace node', () => {
            let mb = new MimeNode(),
                child = mb.createChild('text/plain'),
                replacement = new MimeNode('image/png');

            child.replace(replacement);

            assert.strictEqual(mb.childNodes.length, 1);
            assert.strictEqual(mb.childNodes[0], replacement);
        });
    });

    describe('#remove', () => {
        it('should remove node', () => {
            let mb = new MimeNode(),
                child = mb.createChild('text/plain');

            child.remove();
            assert.strictEqual(mb.childNodes.length, 0);
            assert.ok(!child.parenNode);
        });
    });

    describe('#setHeader', () => {
        it('should set header', () => {
            let mb = new MimeNode();

            mb.setHeader('key', 'value');
            mb.setHeader('key', 'value1');
            assert.strictEqual(mb.getHeader('Key'), 'value1');

            mb.setHeader([
                {
                    key: 'key',
                    value: 'value2'
                },
                {
                    key: 'key2',
                    value: 'value3'
                }
            ]);

            assert.deepStrictEqual(mb._headers, [
                {
                    key: 'Key',
                    value: 'value2'
                },
                {
                    key: 'Key2',
                    value: 'value3'
                }
            ]);

            mb.setHeader({
                key: 'value4',
                key2: 'value5'
            });

            assert.deepStrictEqual(mb._headers, [
                {
                    key: 'Key',
                    value: 'value4'
                },
                {
                    key: 'Key2',
                    value: 'value5'
                }
            ]);
        });

        it('should set multiple headers with the same key', () => {
            let mb = new MimeNode();

            mb.setHeader('key', ['value1', 'value2', 'value3']);
            assert.deepStrictEqual(mb._headers, [
                {
                    key: 'Key',
                    value: ['value1', 'value2', 'value3']
                }
            ]);
        });
    });

    describe('#addHeader', () => {
        it('should add header', () => {
            let mb = new MimeNode();

            mb.addHeader('key', 'value1');
            mb.addHeader('key', 'value2');

            mb.addHeader([
                {
                    key: 'key',
                    value: 'value2'
                },
                {
                    key: 'key2',
                    value: 'value3'
                }
            ]);

            mb.addHeader({
                key: 'value4',
                key2: 'value5'
            });

            assert.deepStrictEqual(mb._headers, [
                {
                    key: 'Key',
                    value: 'value1'
                },
                {
                    key: 'Key',
                    value: 'value2'
                },
                {
                    key: 'Key',
                    value: 'value2'
                },
                {
                    key: 'Key2',
                    value: 'value3'
                },
                {
                    key: 'Key',
                    value: 'value4'
                },
                {
                    key: 'Key2',
                    value: 'value5'
                }
            ]);
        });

        it('should set multiple headers with the same key', () => {
            let mb = new MimeNode();
            mb.addHeader('key', ['value1', 'value2', 'value3']);
            assert.deepStrictEqual(mb._headers, [
                {
                    key: 'Key',
                    value: 'value1'
                },
                {
                    key: 'Key',
                    value: 'value2'
                },
                {
                    key: 'Key',
                    value: 'value3'
                }
            ]);
        });
    });

    describe('#getHeader', () => {
        it('should return first matching header value', () => {
            let mb = new MimeNode();
            mb._headers = [
                {
                    key: 'Key',
                    value: 'value4'
                },
                {
                    key: 'Key2',
                    value: 'value5'
                }
            ];

            assert.strictEqual(mb.getHeader('KEY'), 'value4');
        });
    });

    describe('#setContent', () => {
        it('should set the contents for a node', () => {
            let mb = new MimeNode();
            mb.setContent('abc');
            assert.strictEqual(mb.content, 'abc');
        });
    });

    describe('#build', () => {
        it('should build root node', (t, done) => {
            let mb = new MimeNode('text/plain')
                    .setHeader({
                        date: '12345',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected =
                    'Date: 12345\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'Content-Transfer-Encoding: 7bit\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: text/plain\r\n' +
                    '\r\n' +
                    'Hello world!\r\n';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should build child node', (t, done) => {
            let mb = new MimeNode('multipart/mixed'),
                childNode = mb.createChild('text/plain').setContent('Hello world!'),
                expected = 'Content-Type: text/plain\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello world!\r\n';

            childNode.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should build multipart node', (t, done) => {
            let mb = new MimeNode('multipart/mixed', {
                    baseBoundary: 'test'
                }).setHeader({
                    date: '12345',
                    'message-id': '67890'
                }),
                expected =
                    'Date: 12345\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                    '\r\n' +
                    '----_NmP-test-Part_1\r\n' +
                    'Content-Type: text/plain\r\n' +
                    'Content-Transfer-Encoding: 7bit\r\n' +
                    '\r\n' +
                    'Hello world!\r\n' +
                    '----_NmP-test-Part_1--\r\n';

            mb.createChild('text/plain').setContent('Hello world!');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should build root with generated headers', (t, done) => {
            let mb = new MimeNode('text/plain');
            mb.hostname = 'abc';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Date:\s/m.test(msg), true);
                assert.strictEqual(/^Message-ID:\s/m.test(msg), true);
                assert.strictEqual(/^MIME-Version: 1\.0$/m.test(msg), true);
                done();
            });
        });

        it('should not include bcc missing in output, but in envelope', (t, done) => {
            let mb = new MimeNode('text/plain').setHeader({
                from: 'sender@example.com',
                to: 'receiver@example.com',
                bcc: 'bcc@example.com'
            });
            let envelope = mb.getEnvelope();

            assert.deepStrictEqual(envelope, {
                from: 'sender@example.com',
                to: ['receiver@example.com', 'bcc@example.com']
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^From: sender@example.com$/m.test(msg), true);
                assert.strictEqual(/^To: receiver@example.com$/m.test(msg), true);
                assert.strictEqual(!/^Bcc:/m.test(msg), true);
                done();
            });
        });

        it('should include bcc missing in output and in envelope', (t, done) => {
            let mb = new MimeNode('text/plain', {
                keepBcc: true
            }).setHeader({
                from: 'sender@example.com',
                to: 'receiver@example.com',
                bcc: 'bcc@example.com'
            });
            let envelope = mb.getEnvelope();

            assert.deepStrictEqual(envelope, {
                from: 'sender@example.com',
                to: ['receiver@example.com', 'bcc@example.com']
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^From: sender@example.com$/m.test(msg), true);
                assert.strictEqual(/^To: receiver@example.com$/m.test(msg), true);
                assert.strictEqual(/^Bcc: bcc@example.com$/m.test(msg), true);
                done();
            });
        });

        it('should use set envelope', (t, done) => {
            let mb = new MimeNode('text/plain')
                .setHeader({
                    from: 'sender@example.com',
                    to: 'receiver@example.com',
                    bcc: 'bcc@example.com'
                })
                .setEnvelope({
                    from: 'U Name, A Name <a@a.a>',
                    to: 'B Name <b@b.b>, c@c.c',
                    bcc: 'P P P, <u@u.u>',
                    fooField: {
                        barValue: 'foobar'
                    }
                });
            let envelope = mb.getEnvelope();

            assert.deepStrictEqual(envelope, {
                from: 'a@a.a',
                to: ['b@b.b', 'c@c.c', 'u@u.u'],
                fooField: {
                    barValue: 'foobar'
                }
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^From: sender@example.com$/m.test(msg), true);
                assert.strictEqual(/^To: receiver@example.com$/m.test(msg), true);
                assert.strictEqual(!/^Bcc:/m.test(msg), true);
                done();
            });
        });

        it('should have unicode subject', (t, done) => {
            let mb = new MimeNode('text/plain').setHeader({
                subject: 'jõgeval istus kägu metsas'
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Subject: =\?UTF-8\?Q\?j=C3=B5geval_istus_k=C3=A4gu_metsas\?=$/m.test(msg), true);
                done();
            });
        });

        it('should have unicode subject with strange characters', (t, done) => {
            let mb = new MimeNode('text/plain').setHeader({
                subject: 'ˆ¸ÁÌÓıÏˇÁÛ^¸\\ÁıˆÌÁÛØ^\\˜Û˝™ˇıÓ¸^\\˜ﬁ^\\·\\˜Ø^£˜#ﬁ^\\£ﬁ^\\£ﬁ^\\'
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(
                    msg.match(/\bSubject: [^\r]*\r\n( [^\r]*\r\n)*/)[0],
                    'Subject: =?UTF-8?B?y4bCuMOBw4zDk8Sxw4/Lh8OBw5tewrhcw4HEscuG?=\r\n =?UTF-8?B?w4zDgcObw5heXMucw5vLneKEosuHxLHDk8K4Xlw=?=\r\n =?UTF-8?B?y5zvrIFeXMK3XMucw5hewqPLnCPvrIFeXMKj76yB?=\r\n =?UTF-8?B?XlzCo++sgV5c?=\r\n'
                );
                done();
            });
        });

        it('should keep 7bit text as is', (t, done) => {
            let mb = new MimeNode('text/plain').setContent('tere tere');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/\r\n\r\ntere tere\r\n$/.test(msg), true);
                assert.strictEqual(/^Content-Type: text\/plain$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: 7bit$/m.test(msg), true);
                done();
            });
        });

        it('should prefer base64', (t, done) => {
            let mb = new MimeNode('text/plain')
                .setHeader({
                    subject: 'õõõõ'
                })
                .setContent('õõõõõõõõ');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();

                assert.strictEqual(/^Content-Type: text\/plain; charset=utf-8$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: base64$/m.test(msg), true);
                assert.strictEqual(/^Subject: =\?UTF-8\?B\?w7XDtcO1w7U=\?=$/m.test(msg), true);
                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(msg, 'w7XDtcO1w7XDtcO1w7XDtQ==\r\n');
                done();
            });
        });

        it('should force quoted-printable', (t, done) => {
            let mb = new MimeNode('text/plain', {
                textEncoding: 'quoted-printable'
            })
                .setHeader({
                    subject: 'õõõõ'
                })
                .setContent('õõõõõõõõ');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();

                assert.strictEqual(/^Content-Type: text\/plain; charset=utf-8$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);
                assert.strictEqual(/^Subject: =\?UTF-8\?Q\?=C3=B5=C3=B5=C3=B5=C3=B5\?=$/m.test(msg), true);

                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(msg, '=C3=B5=C3=B5=C3=B5=C3=B5=C3=B5=C3=B5=C3=B5=C3=B5\r\n');
                done();
            });
        });

        it('should prefer quoted-printable', (t, done) => {
            let mb = new MimeNode('text/plain').setContent('ooooooooõ');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();

                assert.strictEqual(/^Content-Type: text\/plain; charset=utf-8$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);

                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(msg, 'oooooooo=C3=B5\r\n');
                done();
            });
        });

        it('should not flow text', (t, done) => {
            let mb = new MimeNode('text/plain').setContent(
                'a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0 a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0'
            );

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();

                assert.strictEqual(/^Content-Type: text\/plain$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);

                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(
                    msg,
                    'a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0 a b c d=\r\n e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 =\r\n0\r\n'
                );
                done();
            });
        });

        it('should not flow html', (t, done) => {
            let mb = new MimeNode('text/html').setContent(
                'a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0 a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0'
            );

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Content-Type: text\/html$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);

                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(
                    msg,
                    'a b c d e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 0 a b c d=\r\n e f g h i j k l m o p q r s t u w x y z 1 2 3 4 5 6 7 8 9 =\r\n0\r\n'
                );
                done();
            });
        });

        it('should use 7bit for html', (t, done) => {
            let mb = new MimeNode('text/html').setContent(
                'a b c d e f g h i j k l m o p\r\nq r s t u w x y z 1 2 3 4 5 6\r\n7 8 9 0 a b c d e f g h i j k\r\nl m o p q r s t u w x y z\r\n1 2 3 4 5 6 7 8 9 0'
            );

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Content-Type: text\/html$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: 7bit$/m.test(msg), true);

                msg = msg.split('\r\n\r\n');
                msg.shift();
                msg = msg.join('\r\n\r\n');

                assert.strictEqual(
                    msg,
                    'a b c d e f g h i j k l m o p\r\nq r s t u w x y z 1 2 3 4 5 6\r\n7 8 9 0 a b c d e f g h i j k\r\nl m o p q r s t u w x y z\r\n1 2 3 4 5 6 7 8 9 0\r\n'
                );
                done();
            });
        });

        it('should fetch ascii filename', (t, done) => {
            let mb = new MimeNode('text/plain', {
                filename: 'jogeva.txt'
            }).setContent('jogeva');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/\r\n\r\njogeva\r\n$/.test(msg), true);
                assert.strictEqual(/^Content-Type: text\/plain; name=jogeva.txt$/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: 7bit$/m.test(msg), true);
                assert.strictEqual(/^Content-Disposition: attachment; filename=jogeva.txt$/m.test(msg), true);
                done();
            });
        });

        it('should set unicode filename', (t, done) => {
            let mb = new MimeNode('text/plain', {
                filename: 'jõgeva.txt'
            }).setContent('jõgeva');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Content-Type: text\/plain; charset=utf-8;/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);
                assert.strictEqual(/^Content-Disposition: attachment; filename\*0\*=utf-8''j%C3%B5geva.txt$/m.test(msg), true);
                done();
            });
        });

        it('should set dashed filename', (t, done) => {
            let mb = new MimeNode('text/plain', {
                filename: 'Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------.pdf'
            }).setContent('jõgeva');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.ok(
                    msg.indexOf(
                        'Content-Disposition: attachment;\r\n' +
                            " filename*0*=utf-8''%C6%94------%C6%94------%C6%94------%C6%94;\r\n" + // eslint-disable-line
                            ' filename*1*=------%C6%94------%C6%94------%C6%94------.pdf'
                    ) >= 0
                );
                done();
            });
        });

        it('should encode filename with a space', (t, done) => {
            let mb = new MimeNode('text/plain', {
                filename: 'document a.test.pdf'
            }).setContent('jõgeva');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Content-Type: text\/plain; charset=utf-8;/m.test(msg), true);
                assert.strictEqual(/^Content-Transfer-Encoding: quoted-printable$/m.test(msg), true);
                assert.strictEqual(/^Content-Disposition: attachment; filename="document a.test.pdf"$/m.test(msg), true);
                done();
            });
        });

        it('should detect content type from filename', (t, done) => {
            let mb = new MimeNode(false, {
                filename: 'jogeva.zip'
            }).setContent('jogeva');

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Content-Type: application\/zip;/m.test(msg), true);
                done();
            });
        });

        it('should convert address objects', (t, done) => {
            let mb = new MimeNode(false).setHeader({
                from: [
                    {
                        name: 'the safewithme õ testuser',
                        address: 'safewithme.testuser@jõgeva.com'
                    }
                ],
                cc: [
                    {
                        name: 'the safewithme testuser',
                        address: 'safewithme.testuser@jõgeva.com'
                    }
                ]
            });

            assert.deepStrictEqual(mb.getEnvelope(), {
                from: 'safewithme.testuser@xn--jgeva-dua.com',
                to: ['safewithme.testuser@xn--jgeva-dua.com']
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^From: =\?UTF-8\?Q\?the_safewithme_=C3=B5_testuser\?=$/m.test(msg), true);
                assert.strictEqual(/^\s+<safewithme.testuser@xn--jgeva-dua.com>$/m.test(msg), true);
                assert.strictEqual(/^Cc: the safewithme testuser <safewithme.testuser@xn--jgeva-dua.com>$/m.test(msg), true);
                done();
            });
        });

        it('should skip empty header', (t, done) => {
            let mb = new MimeNode('text/plain')
                    .setHeader({
                        a: 'b',
                        cc: '',
                        dd: [],
                        o: false,
                        date: 'zzz',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected =
                    'A: b\r\n' +
                    'Date: zzz\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'Content-Transfer-Encoding: 7bit\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: text/plain\r\n' +
                    '\r\n' +
                    'Hello world!\r\n';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should not process prepared headers', (t, done) => {
            let mb = new MimeNode('text/plain')
                    .setHeader({
                        unprepared: {
                            value: new Array(100).join('a b')
                        },
                        prepared: {
                            value: new Array(100).join('a b'),
                            prepared: true
                        },
                        unicode: {
                            value: 'õäöü',
                            prepared: true
                        },
                        date: 'zzz',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected =
                    // long folded value
                    'Unprepared: a ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba\r\n' +
                    ' ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba\r\n' +
                    ' ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba\r\n' +
                    ' ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba\r\n' +
                    ' ba ba ba b\r\n' +
                    // long unfolded value
                    'Prepared: a ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba ba b\r\n' +
                    // non-ascii value
                    'Unicode: õäöü\r\n' +
                    'Date: zzz\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'Content-Transfer-Encoding: 7bit\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: text/plain\r\n' +
                    '\r\n' +
                    'Hello world!\r\n';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should set default transfer encoding for application content', (t, done) => {
            let mb = new MimeNode('application/x-my-stuff')
                    .setHeader({
                        date: '12345',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected =
                    'Date: 12345\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'Content-Transfer-Encoding: base64\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: application/x-my-stuff\r\n' +
                    '\r\n' +
                    'SGVsbG8gd29ybGQh\r\n';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should not set transfer encoding for multipart content', (t, done) => {
            let mb = new MimeNode('multipart/global')
                    .setHeader({
                        date: '12345',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected =
                    'Date: 12345\r\n' +
                    'Message-ID: <67890>\r\n' +
                    'MIME-Version: 1.0\r\n' +
                    'Content-Type: multipart/global; boundary=abc\r\n' +
                    '\r\n' +
                    'Hello world!\r\n' +
                    '--abc--' +
                    '\r\n';

            mb.boundary = 'abc';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should not set transfer encoding for message/ content', (t, done) => {
            let mb = new MimeNode('message/rfc822')
                    .setHeader({
                        date: '12345',
                        'message-id': '67890'
                    })
                    .setContent('Hello world!'),
                expected = 'Date: 12345\r\nMessage-ID: <67890>\r\nMIME-Version: 1.0\r\nContent-Type: message/rfc822\r\n\r\nHello world!\r\n';

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should use from domain for message-id', (t, done) => {
            let mb = new MimeNode('text/plain').setHeader({
                from: 'test@example.com'
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Message-ID: <[0-9a-f-]+@example\.com>$/m.test(msg), true);
                done();
            });
        });

        it('should fallback to hostname for message-id', (t, done) => {
            let mb = new MimeNode('text/plain');
            mb.hostname = 'abc';
            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^Message-ID: <[0-9a-f-]+@abc>$/m.test(msg), true);
                done();
            });
        });
    });

    describe('#getEnvelope', () => {
        it('should get envelope', () => {
            assert.deepStrictEqual(
                new MimeNode()
                    .addHeader({
                        from: 'From <from@example.com>',
                        sender: 'Sender <sender@example.com>',
                        to: 'receiver1@example.com'
                    })
                    .addHeader({
                        to: 'receiver2@example.com',
                        cc: 'receiver1@example.com, receiver3@example.com',
                        bcc: 'receiver4@example.com, Rec5 <receiver5@example.com>'
                    })
                    .getEnvelope(),
                {
                    from: 'from@example.com',
                    to: ['receiver1@example.com', 'receiver2@example.com', 'receiver3@example.com', 'receiver4@example.com', 'receiver5@example.com']
                }
            );

            assert.deepStrictEqual(
                new MimeNode()
                    .addHeader({
                        sender: 'Sender <sender@example.com>',
                        to: 'receiver1@example.com'
                    })
                    .addHeader({
                        to: 'receiver2@example.com',
                        cc: 'receiver1@example.com, receiver3@example.com',
                        bcc: 'receiver4@example.com, Rec5 <receiver5@example.com>'
                    })
                    .getEnvelope(),
                {
                    from: 'sender@example.com',
                    to: ['receiver1@example.com', 'receiver2@example.com', 'receiver3@example.com', 'receiver4@example.com', 'receiver5@example.com']
                }
            );
        });
    });

    describe('#messageId', () => {
        it('should create and return message-Id', () => {
            let mail = new MimeNode().addHeader({
                from: 'From <from@example.com>'
            });

            let messageId = mail.messageId();
            assert.strictEqual(/^<[\w-]+@example\.com>$/.test(messageId), true);
            assert.strictEqual(messageId, mail.messageId());
        });
    });

    describe('#getAddresses', () => {
        it('should get address object', () => {
            assert.deepStrictEqual(
                new MimeNode()
                    .addHeader({
                        from: 'From <from@example.com>',
                        sender: 'Sender <sender@example.com>',
                        to: 'receiver1@example.com'
                    })
                    .addHeader({
                        to: 'receiver2@example.com',
                        cc: 'receiver1@example.com, receiver3@example.com',
                        bcc: 'receiver4@example.com, Rec5 <receiver5@example.com>'
                    })
                    .getAddresses(),
                {
                    from: [
                        {
                            address: 'from@example.com',
                            name: 'From'
                        }
                    ],
                    sender: [
                        {
                            address: 'sender@example.com',
                            name: 'Sender'
                        }
                    ],
                    to: [
                        {
                            address: 'receiver1@example.com',
                            name: ''
                        },
                        {
                            address: 'receiver2@example.com',
                            name: ''
                        }
                    ],
                    cc: [
                        {
                            address: 'receiver1@example.com',
                            name: ''
                        },
                        {
                            address: 'receiver3@example.com',
                            name: ''
                        }
                    ],
                    bcc: [
                        {
                            address: 'receiver4@example.com',
                            name: ''
                        },
                        {
                            address: 'receiver5@example.com',
                            name: 'Rec5'
                        }
                    ]
                }
            );

            assert.deepStrictEqual(
                new MimeNode()
                    .addHeader({
                        sender: 'Sender <sender@example.com>',
                        to: 'receiver1@example.com'
                    })
                    .addHeader({
                        to: 'receiver2@example.com',
                        cc: 'receiver1@example.com, receiver1@example.com',
                        bcc: 'receiver4@example.com, Rec5 <receiver5@example.com>'
                    })
                    .getAddresses(),
                {
                    sender: [
                        {
                            address: 'sender@example.com',
                            name: 'Sender'
                        }
                    ],
                    to: [
                        {
                            address: 'receiver1@example.com',
                            name: ''
                        },
                        {
                            address: 'receiver2@example.com',
                            name: ''
                        }
                    ],
                    cc: [
                        {
                            address: 'receiver1@example.com',
                            name: ''
                        }
                    ],
                    bcc: [
                        {
                            address: 'receiver4@example.com',
                            name: ''
                        },
                        {
                            address: 'receiver5@example.com',
                            name: 'Rec5'
                        }
                    ]
                }
            );
        });
    });

    describe('#_parseAddresses', () => {
        it('should normalize header key', () => {
            let mb = new MimeNode();

            assert.deepStrictEqual(mb._parseAddresses('test address@example.com'), [
                {
                    address: 'address@example.com',
                    name: 'test'
                }
            ]);

            assert.deepStrictEqual(mb._parseAddresses(['test address@example.com']), [
                {
                    address: 'address@example.com',
                    name: 'test'
                }
            ]);

            assert.deepStrictEqual(mb._parseAddresses([['test address@example.com']]), [
                {
                    address: 'address@example.com',
                    name: 'test'
                }
            ]);

            assert.deepStrictEqual(
                mb._parseAddresses([
                    {
                        address: 'address@example.com',
                        name: 'test'
                    }
                ]),
                [
                    {
                        address: 'address@example.com',
                        name: 'test'
                    }
                ]
            );

            assert.deepStrictEqual(
                mb._parseAddresses([
                    {
                        address: 'root',
                        name: 'Charlie Root'
                    }
                ]),
                [
                    {
                        address: 'root',
                        name: 'Charlie Root'
                    }
                ]
            );
        });
    });

    describe('#_normalizeHeaderKey', () => {
        it('should normalize header key', () => {
            let mb = new MimeNode();

            assert.strictEqual(mb._normalizeHeaderKey('key'), 'Key');
            assert.strictEqual(mb._normalizeHeaderKey('mime-vERSION'), 'MIME-Version');
            assert.strictEqual(mb._normalizeHeaderKey('-a-long-name'), '-A-Long-Name');
            assert.strictEqual(mb._normalizeHeaderKey('some-spf'), 'Some-SPF');
            assert.strictEqual(mb._normalizeHeaderKey('dkim-some'), 'DKIM-Some');
            assert.strictEqual(mb._normalizeHeaderKey('x-smtpapi'), 'X-SMTPAPI');
            assert.strictEqual(mb._normalizeHeaderKey('message-id'), 'Message-ID');
            assert.strictEqual(mb._normalizeHeaderKey('CONTENT-FEATUres'), 'Content-features');
        });
    });

    describe('#_handleContentType', () => {
        it('should do nothing on non multipart', () => {
            let mb = new MimeNode();
            assert.ok(!mb.boundary);
            mb._handleContentType({
                value: 'text/plain'
            });
            assert.strictEqual(mb.boundary, false);
            assert.strictEqual(mb.multipart, false);
        });

        it('should use provided boundary', () => {
            let mb = new MimeNode();
            assert.ok(!mb.boundary);
            mb._handleContentType({
                value: 'multipart/mixed',
                params: {
                    boundary: 'abc'
                }
            });
            assert.strictEqual(mb.boundary, 'abc');
            assert.strictEqual(mb.multipart, 'mixed');
        });

        it('should generate boundary', t => {
            let mb = new MimeNode();
            t.mock.method(mb, '_generateBoundary', () => 'def');

            assert.ok(!mb.boundary);
            mb._handleContentType({
                value: 'multipart/mixed',
                params: {}
            });
            assert.strictEqual(mb.boundary, 'def');
            assert.strictEqual(mb.multipart, 'mixed');
            t.mock.restoreAll();
        });
    });

    describe('#_generateBoundary ', () => {
        it('should genereate boundary string', () => {
            let mb = new MimeNode();
            mb._nodeId = 'abc';
            mb.rootNode.baseBoundary = 'def';
            assert.strictEqual(mb._generateBoundary(), '--_NmP-def-Part_abc');
        });
    });

    describe('#_encodeHeaderValue', () => {
        it('should do noting if possible', () => {
            let mb = new MimeNode();
            assert.strictEqual(mb._encodeHeaderValue('x-my', 'test value'), 'test value');
        });

        it('should encode non ascii characters', () => {
            let mb = new MimeNode();
            assert.strictEqual(mb._encodeHeaderValue('x-my', 'test jõgeva value'), '=?UTF-8?Q?test_j=C3=B5geva_value?=');
        });

        it('should format references', () => {
            let mb = new MimeNode();
            assert.strictEqual(mb._encodeHeaderValue('references', 'abc def'), '<abc> <def>');
            assert.strictEqual(mb._encodeHeaderValue('references', ['abc', 'def']), '<abc> <def>');
        });

        it('should format message-id', () => {
            let mb = new MimeNode();
            assert.strictEqual(mb._encodeHeaderValue('message-id', 'abc'), '<abc>');
        });

        it('should format addresses', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._encodeHeaderValue('from', {
                    name: 'the safewithme testuser',
                    address: 'safewithme.testuser@jõgeva.com'
                }),
                'the safewithme testuser <safewithme.testuser@xn--jgeva-dua.com>'
            );
        });
    });

    describe('#_convertAddresses', () => {
        it('should convert address object to a string', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: 'Jõgeva Ants',
                        address: 'ants@jõgeva.ee'
                    },
                    {
                        name: 'Composers',
                        group: [
                            {
                                address: 'sebu@example.com',
                                name: 'Bach, Sebastian'
                            },
                            {
                                address: 'mozart@example.com',
                                name: 'Mozzie'
                            }
                        ]
                    }
                ]),
                '=?UTF-8?Q?J=C3=B5geva_Ants?= <ants@xn--jgeva-dua.ee>, Composers:"Bach, Sebastian" <sebu@example.com>, Mozzie <mozart@example.com>;'
            );
        });

        it('should keep ascii name as is', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: 'O Vigala Sass', // eslint-disable-line
                        address: 'a@b.c'
                    }
                ]),
                'O Vigala Sass <a@b.c>'
            ); // eslint-disable-line
        });

        it('should encode single quote', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: "O'Vigala Sass", // eslint-disable-line
                        address: 'a@b.c'
                    }
                ]),
                '"O\'Vigala Sass" <a@b.c>'
            ); // eslint-disable-line
        });

        it('should include name in quotes for special symbols', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: 'Sass, Vigala',
                        address: 'a@b.c'
                    }
                ]),
                '"Sass, Vigala" <a@b.c>'
            );
        });

        it('should escape quotes', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: '"Vigala Sass"',
                        address: 'a@b.c'
                    }
                ]),
                '"\\"Vigala Sass\\"" <a@b.c>'
            );
        });

        it('should mime encode unicode names', () => {
            let mb = new MimeNode();
            assert.strictEqual(
                mb._convertAddresses([
                    {
                        name: '"Jõgeva Sass"',
                        address: 'a@b.c'
                    }
                ]),
                '=?UTF-8?Q?=22J=C3=B5geva_Sass=22?= <a@b.c>'
            );
        });
    });

    describe('#_generateMessageId', () => {
        it('should generate uuid-looking message-id', () => {
            let mb = new MimeNode();
            let mid = mb._generateMessageId();
            assert.strictEqual(/^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@.*>/.test(mid), true);
        });
    });

    it('should use default header keys', (t, done) => {
        let mb = new MimeNode('text/plain');
        mb.addHeader('test', 'test');
        mb.addHeader('BEST', 'best');

        mb.build((err, msg) => {
            assert.ok(!err);
            msg = msg.toString();
            assert.ok(/^Test: test$/m.test(msg));
            assert.ok(/^Best: best$/m.test(msg));
            done();
        });
    });

    it('should use custom header keys', (t, done) => {
        let mb = new MimeNode('text/plain', {
            normalizeHeaderKey: key => key.toUpperCase()
        });
        mb.addHeader('test', 'test');
        mb.addHeader('BEST', 'best');

        mb.build((err, msg) => {
            assert.ok(!err);
            msg = msg.toString();
            assert.ok(/^TEST: test$/m.test(msg));
            assert.ok(/^BEST: best$/m.test(msg));
            done();
        });
    });

    describe('Attachment streaming', () => {
        let port = 10337;
        let server;

        beforeEach((t, done) => {
            server = http.createServer((req, res) => {
                res.writeHead(200, {
                    'Content-Type': 'text/plain'
                });
                let data = Buffer.from(new Array(1024 + 1).join('ä'), 'utf-8');
                let i = 0;
                let sendByte = () => {
                    if (i >= data.length) {
                        return res.end();
                    }
                    res.write(Buffer.from([data[i++]]));
                    setImmediate(sendByte);
                };

                sendByte();
            });

            server.listen(port, done);
        });

        afterEach((t, done) => {
            server.close(done);
        });

        it('should pipe URL as an attachment', (t, done) => {
            let mb = new MimeNode('text/plain').setContent({
                href: 'http://localhost:' + port
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^=C3=A4/m.test(msg), true);
                done();
            });
        });

        it('should reject URL attachment', (t, done) => {
            let mb = new MimeNode('text/plain', {
                disableUrlAccess: true
            }).setContent({
                href: 'http://localhost:' + port
            });

            mb.build((err, msg) => {
                assert.ok(err);
                assert.ok(!msg);
                done();
            });
        });

        it('should return an error on invalid url', (t, done) => {
            let mb = new MimeNode('text/plain').setContent({
                href: 'http://__should_not_exist:58888'
            });

            mb.build(err => {
                assert.ok(err);
                done();
            });
        });

        it('should pipe file as an attachment', (t, done) => {
            let mb = new MimeNode('application/octet-stream').setContent({
                path: __dirname + '/fixtures/attachment.bin'
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(/^w7VrdmEK$/m.test(msg), true);
                done();
            });
        });

        it('should reject file as an attachment', (t, done) => {
            let mb = new MimeNode('application/octet-stream', {
                disableFileAccess: true
            }).setContent({
                path: __dirname + '/fixtures/attachment.bin'
            });

            mb.build((err, msg) => {
                assert.ok(err);
                assert.ok(!msg);
                done();
            });
        });

        it('should return an error on invalid file path', (t, done) => {
            let mb = new MimeNode('text/plain').setContent({
                path: '/ASfsdfsdf/Sdgsgdfg/SDFgdfgdfg'
            });

            mb.build(err => {
                assert.ok(err);
                done();
            });
        });

        it('should return a error for an errored stream', (t, done) => {
            let s = new PassThrough();
            let mb = new MimeNode('text/plain').setContent(s);

            s.write('abc');
            s.emit('error', new Error('Stream error'));

            setTimeout(() => {
                mb.build(err => {
                    assert.ok(err);
                    done();
                });
            }, 100);
        });

        it('should return a stream error', (t, done) => {
            let s = new PassThrough();
            let mb = new MimeNode('text/plain').setContent(s);

            mb.build(err => {
                assert.ok(err);
                done();
            });

            s.write('abc');
            setTimeout(() => {
                s.emit('error', new Error('Stream error'));
            }, 100);
        });
    });

    describe('#transform', () => {
        it('should pipe through provided stream', (t, done) => {
            let mb = new MimeNode('text/plain')
                .setHeader({
                    date: '12345',
                    'message-id': '67890'
                })
                .setContent('Hello world!');

            let expected =
                'Date:\t12345\r\n' +
                'Message-ID:\t<67890>\r\n' +
                'Content-Transfer-Encoding:\t7bit\r\n' +
                'MIME-Version:\t1.0\r\n' +
                'Content-Type:\ttext/plain\r\n' +
                '\r\n' +
                'Hello\tworld!\r\n';

            // Transform stream that replaces all spaces with tabs
            let transform = new Transform();
            transform._transform = function (chunk, encoding, done) {
                if (encoding !== 'buffer') {
                    chunk = Buffer.from(chunk, encoding);
                }
                for (let i = 0, len = chunk.length; i < len; i++) {
                    if (chunk[i] === 0x20) {
                        chunk[i] = 0x09;
                    }
                }
                this.push(chunk);
                done();
            };

            mb.transform(transform);

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });
    });

    describe('#processFunc', () => {
        it('should pipe through provided process function', (t, done) => {
            let mb = new MimeNode('text/plain')
                .setHeader({
                    date: '12345',
                    'message-id': '67890'
                })
                .setContent('Hello world!');

            let expected =
                'Date:\t12345\r\n' +
                'Message-ID:\t<67890>\r\n' +
                'Content-Transfer-Encoding:\t7bit\r\n' +
                'MIME-Version:\t1.0\r\n' +
                'Content-Type:\ttext/plain\r\n' +
                '\r\n' +
                'Hello\tworld!\r\n';

            // Transform stream that replaces all spaces with tabs
            let transform = new Transform();
            transform._transform = function (chunk, encoding, done) {
                if (encoding !== 'buffer') {
                    chunk = Buffer.from(chunk, encoding);
                }
                for (let i = 0, len = chunk.length; i < len; i++) {
                    if (chunk[i] === 0x20) {
                        chunk[i] = 0x09;
                    }
                }
                this.push(chunk);
                done();
            };

            mb.processFunc(input => {
                setImmediate(() => input.pipe(transform));
                return transform;
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });
    });

    describe('Raw content', () => {
        it('should return pregenerated content', (t, done) => {
            let expected = new Array(100).join('Test\n');
            let mb = new MimeNode('text/plain').setRaw(expected);

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should return pregenerated content for a child node', (t, done) => {
            let expected = new Array(100).join('Test\n');
            let mb = new MimeNode('multipart/mixed', {
                baseBoundary: 'test'
            }).setHeader({
                date: '12345',
                'message-id': '67890'
            });
            let child = mb.createChild();
            child.setRaw(expected);

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(
                    msg,

                    'Date: 12345\r\n' +
                        'Message-ID: <67890>\r\n' +
                        'MIME-Version: 1.0\r\n' +
                        'Content-Type: multipart/mixed; boundary="--_NmP-test-Part_1"\r\n' +
                        '\r\n' +
                        '----_NmP-test-Part_1\r\n' +
                        expected +
                        '\r\n' +
                        '----_NmP-test-Part_1--\r\n'
                );
                done();
            });
        });

        it('should return pregenerated content from a stream', (t, done) => {
            let expected = new Array(100).join('Test\n');
            let raw = new PassThrough();
            let mb = new MimeNode('text/plain').setRaw(raw);

            setImmediate(() => {
                raw.end(expected);
            });

            mb.build((err, msg) => {
                assert.ok(!err);
                msg = msg.toString();
                assert.strictEqual(msg, expected);
                done();
            });
        });

        it('should catch error from a raw stream 1', (t, done) => {
            let raw = new PassThrough();
            let mb = new MimeNode('text/plain').setRaw(raw);

            raw.emit('error', new Error('Stream error'));

            mb.build(err => {
                assert.ok(err);
                done();
            });
        });

        it('should catch error from a raw stream 2', (t, done) => {
            let raw = new PassThrough();
            let mb = new MimeNode('text/plain').setRaw(raw);

            mb.build(err => {
                assert.ok(err);
                done();
            });

            setImmediate(() => {
                raw.emit('error', new Error('Stream error'));
            });
        });
    });
});
