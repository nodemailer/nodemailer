'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('../../lib/nodemailer');

// Regression tests for the trailing "[...]" parser in getTestMessageUrl; the
// previous regex implementation was flagged for polynomial backtracking
describe('getTestMessageUrl', () => {
    it('should return the message url for an Ethereal response', () => {
        const url = nodemailer.getTestMessageUrl({
            response: '250 Accepted [STATUS=new MSGID=abc.123-def]'
        });
        assert.ok(url, 'expected an url');
        assert.ok(url.endsWith('/message/abc.123-def'), 'unexpected url: ' + url);
    });

    it('should use the last bracket group of the response', () => {
        const url = nodemailer.getTestMessageUrl({
            response: '250 OK [foo] [STATUS=new MSGID=abc]'
        });
        assert.ok(url, 'expected an url');
        assert.ok(url.endsWith('/message/abc'), 'unexpected url: ' + url);
    });

    it('should return false when there is no trailing props block', () => {
        assert.strictEqual(nodemailer.getTestMessageUrl(false), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({}), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '250 Accepted' }), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '250 Accepted [STATUS=new MSGID=x] trailing' }), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '250 Accepted [STATUS=new MSGID=x]y]' }), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '[]' }), false);
    });

    it('should return false when STATUS or MSGID is missing', () => {
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '250 Accepted [MSGID=abc]' }), false);
        assert.strictEqual(nodemailer.getTestMessageUrl({ response: '250 Accepted [STATUS=new]' }), false);
    });

    it('should handle adversarial responses in linear time', () => {
        const response = '['.repeat(50000);
        const start = Date.now();
        assert.strictEqual(nodemailer.getTestMessageUrl({ response }), false);
        const duration = Date.now() - start;
        assert.ok(duration < 100, 'parsing took too long: ' + duration + 'ms');
    });
});
