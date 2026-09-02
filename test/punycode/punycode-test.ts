import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as punycode from '../../src/punycode/index.js';

describe('Punycode Tests', () => {
    // sample strings from RFC 3492 section 7.1 and the punycode.js test suite
    const fixtures = [
        {
            description: 'a single non-ASCII character',
            decoded: 'mañana',
            encoded: 'maana-pta'
        },
        {
            description: 'basic code points made of a single hyphen',
            decoded: '☃-⌘',
            encoded: '--dqo34k'
        },
        {
            description: 'a non-BMP character among basic code points',
            decoded: '퐀☃-⌘',
            encoded: '--dqo34kn65z'
        },
        {
            description: 'an astral character given as a surrogate pair',
            decoded: '💩',
            encoded: 'ls8h'
        },
        {
            description: 'Arabic (Egyptian)',
            decoded: 'ليهمابتكلموشعربي؟',
            encoded: 'egbpdaj6bu4bxfgehfvwxn'
        },
        {
            description: 'Chinese (simplified)',
            decoded: '他们为什么不说中文',
            encoded: 'ihqwcrb4cv8a8dqg056pqjye'
        },
        {
            description: 'Japanese with mixed case basic code points',
            decoded: '3年B組金八先生',
            encoded: '3B-ww4c5e180e575a65lsy2b'
        },
        {
            description: 'Japanese, "Maji de Koi suru 5 byou mae"',
            decoded: 'MajiでKoiする5秒前',
            encoded: 'MajiKoi5-783gue6qz075azm5e'
        },
        {
            description: 'the highest code point',
            decoded: '\u{10FFFF}',
            encoded: 'dn32g'
        }
    ];

    describe('#encode', () => {
        fixtures.forEach(fixture => {
            it('should encode ' + fixture.description, () => {
                assert.strictEqual(punycode.encode(fixture.decoded), fixture.encoded);
            });
        });

        it('should encode a plain ASCII string as itself with a trailing delimiter', () => {
            assert.strictEqual(punycode.encode('abc'), 'abc-');
        });

        it('should encode an empty string', () => {
            assert.strictEqual(punycode.encode(''), '');
        });
    });

    describe('#decode', () => {
        fixtures.forEach(fixture => {
            it('should decode ' + fixture.description, () => {
                assert.strictEqual(punycode.decode(fixture.encoded), fixture.decoded);
            });
        });

        it('should round trip every fixture', () => {
            fixtures.forEach(fixture => {
                assert.strictEqual(punycode.decode(punycode.encode(fixture.decoded)), fixture.decoded, fixture.description);
            });
        });

        it('should accept uppercase digits', () => {
            // RFC 3492 section 5: a decoder must recognize both cases of the digit letters
            assert.strictEqual(punycode.decode('Maana-PTA'), 'Mañana');
        });

        it('should return the basic code points when there is nothing to insert', () => {
            assert.strictEqual(punycode.decode('abc-'), 'abc');
            assert.strictEqual(punycode.decode(''), '');
        });

        it('should reject a non-basic code point ahead of the delimiter', () => {
            assert.throws(() => punycode.decode('ü-abc'), {
                name: 'RangeError',
                message: 'Illegal input >= 0x80 (not a basic code point)'
            });
        });

        it('should reject a character that is not a digit', () => {
            assert.throws(() => punycode.decode('xyz-$'), {
                name: 'RangeError',
                message: 'Invalid input'
            });
        });

        it('should reject input that ends inside a variable length integer', () => {
            assert.throws(() => punycode.decode('a-b'), {
                name: 'RangeError',
                message: 'Invalid input'
            });
        });

        it('should reject a delta that does not fit into a 32 bit integer', () => {
            assert.throws(() => punycode.decode('a-0000000000'), {
                name: 'RangeError',
                message: 'Overflow: input needs wider integers to process'
            });
        });
    });

    describe('#ucs2', () => {
        it('should decode a surrogate pair into one code point', () => {
            assert.deepStrictEqual(punycode.ucs2.decode('💩'), [0x1f4a9]);
        });

        it('should keep an unmatched surrogate as a code unit', () => {
            // the next unit might be the high surrogate of a pair, so it is not consumed
            assert.deepStrictEqual(punycode.ucs2.decode('\uD83Da'), [0xd83d, 0x61]);
            assert.deepStrictEqual(punycode.ucs2.decode('a\uD83D'), [0x61, 0xd83d]);
            assert.deepStrictEqual(punycode.ucs2.decode('\uDCA9'), [0xdca9]);
        });

        it('should encode code points into a string', () => {
            assert.strictEqual(punycode.ucs2.encode([0x1f4a9, 0x61]), '💩a');
        });
    });

    describe('#toUnicode', () => {
        it('should decode the punycoded labels of a domain', () => {
            assert.strictEqual(punycode.toUnicode('xn--maana-pta.com'), 'mañana.com');
            assert.strictEqual(punycode.toUnicode('xn--bcher-kva.example.com'), 'bücher.example.com');
        });

        it('should leave the local part of an email address alone', () => {
            assert.strictEqual(punycode.toUnicode('user@xn--maana-pta.com'), 'user@mañana.com');
        });

        it('should decode an uppercase label body', () => {
            assert.strictEqual(punycode.toUnicode('xn--MAANA-PTA.com'), 'mañana.com');
        });

        it('should only recognize a lowercase xn-- prefix', () => {
            assert.strictEqual(punycode.toUnicode('XN--maana-pta.com'), 'XN--maana-pta.com');
        });

        it('should leave an already decoded domain as it is', () => {
            assert.strictEqual(punycode.toUnicode('mañana.com'), 'mañana.com');
        });
    });

    describe('#toASCII', () => {
        it('should encode the non-ASCII labels of a domain', () => {
            assert.strictEqual(punycode.toASCII('mañana.com'), 'xn--maana-pta.com');
            assert.strictEqual(punycode.toASCII('bücher.example.com'), 'xn--bcher-kva.example.com');
        });

        it('should leave the local part of an email address alone', () => {
            assert.strictEqual(punycode.toASCII('user@mañana.com'), 'user@xn--maana-pta.com');
        });

        it('should treat the RFC 3490 separators as dots', () => {
            assert.strictEqual(punycode.toASCII('mañana。com'), 'xn--maana-pta.com');
            assert.strictEqual(punycode.toASCII('mañana．com'), 'xn--maana-pta.com');
            assert.strictEqual(punycode.toASCII('mañana｡com'), 'xn--maana-pta.com');
        });

        it('should leave an ASCII domain as it is', () => {
            assert.strictEqual(punycode.toASCII('example.com'), 'example.com');
            assert.strictEqual(punycode.toASCII('xn--maana-pta.com'), 'xn--maana-pta.com');
        });
    });

    it('should expose the version of the bundled codec', () => {
        assert.strictEqual(punycode.version, '2.3.1');
    });
});
