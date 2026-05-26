'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('../../lib/nodemailer');

// Regression tests for GHSA-268h-hp4c-crq3: CRLF in a `list.*.comment` field
// must not be emitted as a real header boundary in the generated message.
describe('List-* header comment CRLF injection', () => {
    const send = data => {
        const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
        return new Promise((resolve, reject) => {
            transport.sendMail(data, (err, info) => (err ? reject(err) : resolve(info.message.toString('utf8'))));
        });
    };

    const listKeys = ['help', 'unsubscribe', 'subscribe', 'post', 'owner', 'archive', 'id'];

    listKeys.forEach(key => {
        it('should not allow header injection via list.' + key + '.comment', async () => {
            const raw = await send({
                from: 'sender@example.test',
                to: 'recipient@example.test',
                subject: 'list ' + key,
                list: {
                    [key]: {
                        url: key === 'id' ? 'example.test' : 'https://example.test/' + key,
                        comment: 'comment\r\nX-Injected-' + key + ': yes'
                    }
                },
                text: 'body'
            });

            // the injected marker must not appear at the start of its own header line
            assert.ok(!new RegExp('\\r\\nX-Injected-' + key + ': yes').test(raw), 'CRLF injected a standalone header for list.' + key);
            // and the (sanitized) comment text is still carried inside the List-* header
            assert.ok(new RegExp('^List-' + key + ':', 'im').test(raw));
        });
    });

    it('should keep a benign comment intact in the List-* header', async () => {
        const raw = await send({
            from: 'sender@example.test',
            to: 'recipient@example.test',
            subject: 'benign',
            list: { unsubscribe: { url: 'https://example.test/u', comment: 'Unsubscribe here' } },
            text: 'body'
        });

        const line = raw.split('\r\n').find(l => /^List-Unsubscribe:/.test(l));
        assert.ok(line);
        assert.ok(line.includes('(Unsubscribe here)'));
    });
});
