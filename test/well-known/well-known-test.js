/* eslint no-unused-expressions:0, no-invalid-this:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;
const wellKnown = require('../../lib/well-known');

chai.config.includeStack = true;

describe('Well-Known Services Tests', function () {
    describe('#wellKnown', function () {
        it('Should find by key', function () {
            expect(wellKnown('Gmail')).to.deep.equal({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by alias', function () {
            expect(wellKnown('Google Mail')).to.deep.equal({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find by domain', function () {
            expect(wellKnown('GoogleMail.com')).to.deep.equal({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            });
        });

        it('Should find no match', function () {
            expect(wellKnown('zzzzzz')).to.be.false;
        });
    });
});
