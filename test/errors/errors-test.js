'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const errors = require('../../lib/errors');

const EXPECTED_CODES = [
    'ECONNECTION',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS',
    'ETLS',
    'EREQUIRETLS',
    'EPROTOCOL',
    'EENVELOPE',
    'EMESSAGE',
    'ESTREAM',
    'EAUTH',
    'ENOAUTH',
    'EOAUTH2',
    'EMAXLIMIT',
    'ESENDMAIL',
    'ESES',
    'ECONFIG',
    'EPROXY',
    'EFILEACCESS',
    'EURLACCESS',
    'EFETCH'
];

describe('Nodemailer Error Codes', () => {
    describe('ERROR_CODES object', () => {
        it('should export ERROR_CODES object with descriptions', () => {
            assert.ok(errors.ERROR_CODES);
            assert.equal(typeof errors.ERROR_CODES, 'object');

            for (const code of EXPECTED_CODES) {
                const description = errors.ERROR_CODES[code];
                assert.ok(description, `ERROR_CODES should have ${code}`);
                assert.equal(typeof description, 'string', `${code} description should be a string`);
                assert.ok(description.length > 10, `${code} description should be meaningful`);
            }
        });
    });

    describe('Individual code exports', () => {
        it('should export all error codes as string constants', () => {
            for (const code of EXPECTED_CODES) {
                assert.equal(errors[code], code, `errors.${code} should equal '${code}'`);
            }
        });
    });

    describe('Error creation usage', () => {
        it('should allow assigning error codes to Error objects', () => {
            const err = new Error('Connection failed');
            err.code = errors.ECONNECTION;

            assert.equal(err.code, 'ECONNECTION');
            assert.equal(err.message, 'Connection failed');
        });

        it('should work with various error types', () => {
            const testCases = [
                { code: 'ETLS', message: 'TLS handshake failed' },
                { code: 'EAUTH', message: 'Invalid credentials' },
                { code: 'EOAUTH2', message: 'Token refresh failed' },
                { code: 'ESENDMAIL', message: 'Sendmail not found' },
                { code: 'EFETCH', message: 'HTTP request failed' }
            ];

            for (const { code, message } of testCases) {
                const err = new Error(message);
                err.code = errors[code];
                assert.equal(err.code, code);
            }
        });
    });
});
