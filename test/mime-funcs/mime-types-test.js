/* eslint no-unused-expressions:0, prefer-arrow-callback: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const expect = chai.expect;

//let http = require('http');
const mimeTypes = require('../../lib/mime-funcs/mime-types.js');

chai.config.includeStack = true;

describe('Mime-Type Tests', function () {
    describe('#detectExtension', function () {
        it('should detect default extension', function () {
            expect(mimeTypes.detectExtension(false)).to.equal('bin');
            expect(mimeTypes.detectExtension('unknown')).to.equal('bin');
            expect(mimeTypes.detectExtension('application/unknown')).to.equal('bin');
            expect(mimeTypes.detectExtension('text/unknown')).to.equal('txt');
        });

        it('should detect single extension', function () {
            expect(mimeTypes.detectExtension('text/plain')).to.equal('txt');
        });

        it('should detect first matching extension', function () {
            expect(mimeTypes.detectExtension('application/vnd.ms-excel')).to.equal('xls');
        });
    });

    describe('#detectMimeType', function () {
        it('should detect default mime type', function () {
            expect(mimeTypes.detectMimeType(false)).to.equal('application/octet-stream');
            expect(mimeTypes.detectMimeType('unknown')).to.equal('application/octet-stream');
        });

        it('should detect single mime type', function () {
            expect(mimeTypes.detectMimeType('txt')).to.equal('text/plain');
            expect(mimeTypes.detectMimeType('test.txt')).to.equal('text/plain');
            expect(mimeTypes.detectMimeType('path/to/test.txt?id=123')).to.equal('text/plain');
        });

        it('should detect first matching mime type', function () {
            expect(mimeTypes.detectMimeType('sgml')).to.equal('text/sgml');
            expect(mimeTypes.detectMimeType('test.sgml')).to.equal('text/sgml');
            expect(mimeTypes.detectMimeType('path/to/test.sgml?id=123')).to.equal('text/sgml');
        });
    });
});
