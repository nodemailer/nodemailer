'use strict';

var chai = require('chai');
var Compiler = require('../src/compiler');
var sinon = require('sinon');
var expect = chai.expect;

chai.config.includeStack = true;

describe('Compiler unit tests', function() {
    it('should create new Compiler', function() {
        expect(new Compiler({})).to.exist;
    });

    describe('#compile', function() {
        it('should use Mixed structure with text and attachment', function() {
            var data = {
                text: 'abc',
                attachments: [{
                    content: 'abc'
                }]
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createMixed');
            compiler.compile();
            expect(compiler._createMixed.callCount).to.equal(1);
            compiler._createMixed.restore();
        });

        it('should use Mixed structure with multiple attachments', function() {
            var data = {
                attachments: [{
                    content: 'abc'
                }, {
                    content: 'def'
                }]
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createMixed');
            compiler.compile();
            expect(compiler._createMixed.callCount).to.equal(1);
            compiler._createMixed.restore();
        });

        it('should create Alternative structure with text and html', function() {
            var data = {
                text: 'abc',
                html: 'def'
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            compiler._createAlternative.restore();
        });

        it('should create Alternative structure with text, html and cid attachment', function() {
            var data = {
                text: 'abc',
                html: 'def',
                attachments: [{
                    content: 'abc',
                    cid: 'aaa'
                }, {
                    content: 'def',
                    cid: 'bbb'
                }]
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createAlternative');
            compiler.compile();
            expect(compiler._createAlternative.callCount).to.equal(1);
            compiler._createAlternative.restore();
        });

        it('should create Related structure with html and cid attachment', function() {
            var data = {
                html: 'def',
                attachments: [{
                    content: 'abc',
                    cid: 'aaa'
                }, {
                    content: 'def',
                    cid: 'bbb'
                }]
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createRelated');
            compiler.compile();
            expect(compiler._createRelated.callCount).to.equal(1);
            compiler._createRelated.restore();
        });

        it('should create content node with only text', function() {
            var data = {
                text: 'def'
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createContentNode');
            compiler.compile();
            expect(compiler._createContentNode.callCount).to.equal(1);
            compiler._createContentNode.restore();
        });

        it('should create content node with only an attachment', function() {
            var data = {
                attachments: [{
                    content: 'abc',
                    cid: 'aaa'
                }]
            };

            var compiler = new Compiler(data);
            sinon.stub(compiler, '_createContentNode');
            compiler.compile();
            expect(compiler._createContentNode.callCount).to.equal(1);
            compiler._createContentNode.restore();
        });

        it('should create content node with encoded buffer', function() {
            var str = 'tere tere';
            var data = {
                text: {
                    content: new Buffer(str).toString('base64'),
                    encoding: 'base64'
                }
            };

            var compiler = new Compiler(data);
            compiler.compile();
            expect(compiler.message.content).to.deep.equal(new Buffer(str));
        });

        it('should create content node from data url', function() {
            var str = 'tere tere';
            var data = {
                attachments: [{
                    href: 'data:image/png,tere%20tere'
                }]
            };

            var compiler = new Compiler(data);
            compiler.compile();
            expect(compiler.mail.attachments[0].content).to.deep.equal(new Buffer(str));
            expect(compiler.mail.attachments[0].contentType).to.equal('image/png');
        });
    });
});