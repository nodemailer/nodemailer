/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

let sign = require('../../lib/dkim/sign');

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

describe('DKIM Sign Tests', function () {
    it('should create relaxed headers', function () {
        let headerLines = [
            {
                key: 'a',
                line: 'A: X'
            },
            {
                key: 'b',
                line: 'B: Y\t\r\n\tZ  '
            }
        ];
        expect(sign.relaxedHeaders(headerLines, 'a:b:c:d')).to.deep.equal({
            headers: 'a:X\r\nb:Y Z\r\n',
            fieldNames: 'a:b'
        });
    });

    it('should skip specific headers', function () {
        let headerLines = [
            {
                key: 'a',
                line: 'A: X'
            },
            {
                key: 'b',
                line: 'B: Y\t\r\n\tZ  '
            },
            {
                key: 'c',
                line: 'C: X'
            },
            {
                key: 'd',
                line: 'D: X'
            }
        ];
        expect(sign.relaxedHeaders(headerLines, 'a:b:c:d', 'a:c')).to.deep.equal({
            headers: 'b:Y Z\r\nd:X\r\n',
            fieldNames: 'b:d'
        });
    });

    it('should sign headers', function () {
        let headerLines = [
            {
                key: 'from',
                line: 'From: andris@node.ee'
            },
            {
                key: 'to',
                line: 'To:andris@kreata.ee'
            },
            {
                key: 'message-id',
                line: 'Message-ID: <testkiri@kreata.ee>'
            }
        ];

        let dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            skipFields: 'message-id:references',
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        });
        expect(dkimField.replace(/\r?\n\s*/g, '').replace(/\s+/g, '')).to.equal(
            'DKIM-Signature:v=1;a=rsa-sha256;c=relaxed/relaxed;d=node.ee;q=dns/txt;s=dkim;bh=z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=;h=from:to;b=pVd+Dp+EjmYBcc1AWlBAP4ESpuAJ2WMS4gbxWLoeUZ1vZRodVN7K9UXvcCsLuqjJktCZMN2+8dyEUaYW2VIcxg4sVBCS1wqB/tqYZ/gxXLnG2/nZf4fyD2vxltJP4pDL'
        );
    });

    it('should sign headers for unicode domain', function () {
        let headerLines = [
            {
                key: 'from',
                line: 'From: andris@node.ee'
            },
            {
                key: 'to',
                line: 'To:andris@kreata.ee'
            }
        ];

        let dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            domainName: 'müriaad-polüteism.info',
            keySelector: 'dkim',
            privateKey
        });
        expect(dkimField.replace(/\r?\n\s*/g, '').replace(/\s+/g, '')).to.equal(
            'DKIM-Signature:v=1;a=rsa-sha256;c=relaxed/relaxed;d=xn--mriaad-polteism-zvbj.info;q=dns/txt;s=dkim;bh=z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=;h=from:to;b=oBJ1MkwEkftfXa2AK4Expjp2xgIcAR43SVrftSEHVQ6F1SlGjP3EKP+cn/hLkhUel3rY0icthk/myDu6uhTBmM6DMtzIBW/7uQd6q9hfgaiYnw5Iew2tZc4TzBEYSdKi'
        );
    });
});
