'use strict';

var chai = require('chai');
var nodemailer = require('../src/nodemailer');

var expect = chai.expect;
chai.Assertion.includeStack = true;

describe('Nodemailer', function() {
    it('should create Nodemailer transport object', function() {
        expect(nodemailer).to.exist;
    });
});