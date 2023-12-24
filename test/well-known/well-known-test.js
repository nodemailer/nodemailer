'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const wellKnown = require('../../lib/well-known');

describe('Well-Known Services Tests', () => {
    describe('#wellKnown', () => {
        it('Should find by key', () => {
            assert.deepStrictEqual(wellKnown('Gmail'), {
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by alias', () => {
            assert.deepStrictEqual(wellKnown('Google Mail'), {
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by domain', () => {
            assert.deepStrictEqual(wellKnown('GoogleMail.com'), {
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find no match', () => {
            assert.strictEqual(wellKnown('zzzzzz'), false);
        });
    });
});
