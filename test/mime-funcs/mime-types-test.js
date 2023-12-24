'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

//let http = require('http');
const mimeTypes = require('../../lib/mime-funcs/mime-types.js');

describe('Mime-Type Tests', () => {
    describe('#detectExtension', () => {
        it('should detect default extension', () => {
            assert.strictEqual(mimeTypes.detectExtension(false), 'bin');
            assert.strictEqual(mimeTypes.detectExtension('unknown'), 'bin');
            assert.strictEqual(mimeTypes.detectExtension('application/unknown'), 'bin');
            assert.strictEqual(mimeTypes.detectExtension('text/unknown'), 'txt');
        });

        it('should detect single extension', () => {
            assert.strictEqual(mimeTypes.detectExtension('text/plain'), 'txt');
        });

        it('should detect first matching extension', () => {
            assert.strictEqual(mimeTypes.detectExtension('application/vnd.ms-excel'), 'xls');
        });
    });

    describe('#detectMimeType', () => {
        it('should detect default mime type', () => {
            assert.strictEqual(mimeTypes.detectMimeType(false), 'application/octet-stream');
            assert.strictEqual(mimeTypes.detectMimeType('unknown'), 'application/octet-stream');
        });

        it('should detect single mime type', () => {
            assert.strictEqual(mimeTypes.detectMimeType('txt'), 'text/plain');
            assert.strictEqual(mimeTypes.detectMimeType('test.txt'), 'text/plain');
            assert.strictEqual(mimeTypes.detectMimeType('path/to/test.txt?id=123'), 'text/plain');
        });

        it('should detect first matching mime type', () => {
            assert.strictEqual(mimeTypes.detectMimeType('sgml'), 'text/sgml');
            assert.strictEqual(mimeTypes.detectMimeType('test.sgml'), 'text/sgml');
            assert.strictEqual(mimeTypes.detectMimeType('path/to/test.sgml?id=123'), 'text/sgml');
        });
    });
});
