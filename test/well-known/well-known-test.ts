import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import wellKnown from '../../src/well-known/index.js';

describe('Well-Known Services Tests', () => {
    describe('#wellKnown', () => {
        it('Should find by key', () => {
            assert.deepStrictEqual(wellKnown('Gmail'), {
                description: 'Gmail',
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by alias', () => {
            assert.deepStrictEqual(wellKnown('Google Mail'), {
                description: 'Gmail',
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by domain', () => {
            assert.deepStrictEqual(wellKnown('GoogleMail.com'), {
                description: 'Gmail',
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find iCloud by its primary domain', () => {
            assert.deepStrictEqual(wellKnown('test@icloud.com'), {
                description: 'iCloud Mail',
                host: 'smtp.mail.me.com',
                port: 587
            });
        });

        it('Should find FastMail by its primary domain', () => {
            assert.deepStrictEqual(wellKnown('test@fastmail.com'), {
                description: 'FastMail',
                host: 'smtp.fastmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find no match', () => {
            assert.strictEqual(wellKnown('zzzzzz'), false);
        });
    });
});
