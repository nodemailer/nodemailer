import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import sign from '../../src/dkim/sign.js';

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

describe('DKIM Sign Tests', () => {
    it('should create relaxed headers', () => {
        const headerLines = [
            {
                key: 'a',
                line: 'A: X'
            },
            {
                key: 'b',
                line: 'B: Y\t\r\n\tZ  '
            }
        ];
        assert.deepStrictEqual(sign.relaxedHeaders(headerLines, 'a:b:c:d'), {
            headers: 'a:X\r\nb:Y Z\r\n',
            fieldNames: 'a:b'
        });
    });

    it('should skip specific headers', () => {
        const headerLines = [
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
        assert.deepStrictEqual(sign.relaxedHeaders(headerLines, 'a:b:c:d', 'a:c'), {
            headers: 'b:Y Z\r\nd:X\r\n',
            fieldNames: 'b:d'
        });
    });

    it('should sign headers', () => {
        const headerLines = [
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

        const dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            skipFields: 'message-id:references',
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey
        }) as string;
        assert.strictEqual(
            dkimField.replace(/\r?\n\s*/g, '').replace(/\s+/g, ''),
            'DKIM-Signature:v=1;a=rsa-sha256;c=relaxed/relaxed;d=node.ee;q=dns/txt;s=dkim;bh=z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=;h=from:to;b=pVd+Dp+EjmYBcc1AWlBAP4ESpuAJ2WMS4gbxWLoeUZ1vZRodVN7K9UXvcCsLuqjJktCZMN2+8dyEUaYW2VIcxg4sVBCS1wqB/tqYZ/gxXLnG2/nZf4fyD2vxltJP4pDL'
        );
    });

    it('should return false when the private key can not sign', () => {
        // an unusable key must not throw out of sign(): the caller treats false as
        // "no signature" and sends the message unsigned rather than failing the send
        const dkimField = sign([{ key: 'from', line: 'From: andris@node.ee' }], 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            domainName: 'node.ee',
            keySelector: 'dkim',
            privateKey: 'not a pem key'
        });

        assert.strictEqual(dkimField, false);
    });

    it('should strip control chars from the domain and the selector', () => {
        // both are interpolated straight into the header, where neither the tag list nor a
        // domain name has any way to carry them
        const headerLines = [
            {
                key: 'from',
                line: 'From: andris@node.ee'
            }
        ];

        const dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            domainName: 'no\x01de.ee',
            keySelector: 'dk\x7fim',
            privateKey
        }) as string;

        assert.strictEqual(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(dkimField), false);
        assert.ok(dkimField.indexOf('d=node.ee;') >= 0);
        assert.ok(dkimField.indexOf('s=dkim;') >= 0);
    });

    it('should strip tag delimiters from the domain and the selector', () => {
        // the tag list is built by joining on "; ", so a delimiter inside a value closes it
        // and opens a tag the caller never set
        const headerLines = [
            {
                key: 'from',
                line: 'From: andris@node.ee'
            }
        ];

        const dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            domainName: 'node.ee; s=evil',
            keySelector: 'dkim; d=evil.ee',
            privateKey
        }) as string;

        // unfold the rfc5322 way, keeping the folding whitespace, so a tag landing right
        // after a fold is still visible as its own tag
        const tags = dkimField
            .replace(/\r?\n(?=[ \t])/g, '')
            .replace(/^DKIM-Signature:\s*/, '')
            .split(';')
            .map(tag => tag.trim().split('=')[0])
            .filter(Boolean);

        // the delimiters are gone, so each value stays inside the tag it belongs to
        assert.deepStrictEqual(tags, ['v', 'a', 'c', 'd', 'q', 's', 'bh', 'h', 'b']);
        assert.ok(dkimField.replace(/\r?\n(?=[ \t])/g, '').indexOf('d=node.ee sevil; q=dns/txt; s=dkim devil.ee; bh=') >= 0);
    });

    it('should sign headers for unicode domain', () => {
        const headerLines = [
            {
                key: 'from',
                line: 'From: andris@node.ee'
            },
            {
                key: 'to',
                line: 'To:andris@kreata.ee'
            }
        ];

        const dkimField = sign(headerLines, 'sha256', 'z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=', {
            domainName: 'müriaad-polüteism.info',
            keySelector: 'dkim',
            privateKey
        }) as string;
        assert.strictEqual(
            dkimField.replace(/\r?\n\s*/g, '').replace(/\s+/g, ''),
            'DKIM-Signature:v=1;a=rsa-sha256;c=relaxed/relaxed;d=xn--mriaad-polteism-zvbj.info;q=dns/txt;s=dkim;bh=z6TUz85EdYrACGMHYgZhJGvVy5oQI0dooVMKa2ZT7c4=;h=from:to;b=oBJ1MkwEkftfXa2AK4Expjp2xgIcAR43SVrftSEHVQ6F1SlGjP3EKP+cn/hLkhUel3rY0icthk/myDu6uhTBmM6DMtzIBW/7uQd6q9hfgaiYnw5Iew2tZc4TzBEYSdKi'
        );
    });
});

describe('DKIM relaxed header canonicalization', () => {
    const relaxed = (line: string) =>
        sign.relaxedHeaders([{ key: line.substr(0, line.indexOf(':')).trim().toLowerCase(), line }], 'subject').headers;

    it('should unfold and collapse whitespace', () => {
        assert.strictEqual(relaxed('Subject: a \t b\r\n\t c  \r\n d'), 'subject:a b c d\r\n');
    });

    it('should drop whitespace around the colon and at the end', () => {
        assert.strictEqual(relaxed('Subject \t: \t value \t'), 'subject:value\r\n');
    });

    it('should keep an empty value', () => {
        assert.strictEqual(relaxed('Subject:'), 'subject:\r\n');
        assert.strictEqual(relaxed('Subject: \t '), 'subject:\r\n');
    });

    it('should treat only SP and HTAB as whitespace', () => {
        // the header lines are 'binary' strings, so a UTF-8 non-breaking space (C2 A0) or an
        // ideographic space (E3 80 80) is a run of bytes that a verifier keeps as they are
        const nbsp = Buffer.from('Subject: a b', 'utf-8').toString('binary');
        assert.strictEqual(relaxed(nbsp), Buffer.from('subject:a b\r\n', 'utf-8').toString('binary'));

        const ideographic = Buffer.from('Subject: 日本　語 ', 'utf-8').toString('binary');
        assert.strictEqual(relaxed(ideographic), Buffer.from('subject:日本　語\r\n', 'utf-8').toString('binary'));
    });

    it('should keep 8-bit header bytes', () => {
        assert.strictEqual(relaxed('Subject: j\xf5geva'), 'subject:j\xf5geva\r\n');
    });

    it('should sign the header bytes and not their UTF-8 re-encoding', () => {
        const headers = [{ key: 'subject', line: Buffer.from('Subject: jõgeva', 'utf-8').toString('binary') }];
        const bodyHash = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
        const signature = sign(headers, 'sha256', bodyHash, {
            domainName: 'example.com',
            keySelector: 'test',
            privateKey,
            headerFieldNames: 'subject'
        });
        assert.ok(signature);

        // recompute the signature over the canonicalized header bytes and compare
        const dkimHeader = (signature as string).replace(/\r\n\s+/g, ' ').replace(/b=.*$/, 'b=');
        const signedData = Buffer.concat([
            Buffer.from('subject:jõgeva\r\n', 'utf-8'),
            Buffer.from('dkim-signature:' + dkimHeader.replace(/^DKIM-Signature:\s*/i, ''), 'binary')
        ]);
        const publicKey = crypto.createPublicKey(privateKey);
        const b = ((signature as string).match(/b=([^;]+)$/) as RegExpMatchArray)[1].replace(/\s+/g, '');
        assert.ok(crypto.createVerify('RSA-SHA256').update(signedData).verify(publicKey, b, 'base64'));
    });
});
