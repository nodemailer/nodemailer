'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const libmime = require('libmime');
const mimeFuncs = require('../../lib/mime-funcs');

describe('Mime-Funcs Tests', () => {
    describe('#isPlainText', () => {
        it('should detect plain text', () => {
            assert.strictEqual(mimeFuncs.isPlainText('abc'), true);
            assert.strictEqual(mimeFuncs.isPlainText('abc\x02'), false);
            assert.strictEqual(mimeFuncs.isPlainText('abcõ'), false);
        });
        it('should return true', () => {
            assert.strictEqual(mimeFuncs.isPlainText('az09\t\r\n~!?'), true);
        });

        it('should return false on low bits', () => {
            assert.strictEqual(mimeFuncs.isPlainText('az09\n\x08!?'), false);
        });

        it('should return false on high bits', () => {
            assert.strictEqual(mimeFuncs.isPlainText('az09\nõ!?'), false);
        });
    });

    describe('#hasLongerLines', () => {
        it('should detect longer lines', () => {
            assert.strictEqual(mimeFuncs.hasLongerLines('abc\ndef', 5), false);
            assert.strictEqual(mimeFuncs.hasLongerLines('juf\nabcdef\nghi', 5), true);
        });
    });

    describe('#encodeWord', () => {
        it('should encode quoted-printable', () => {
            assert.strictEqual('=?UTF-8?Q?See_on_=C3=B5hin_test?=', mimeFuncs.encodeWord('See on õhin test'));
        });

        it('should encode base64', () => {
            assert.strictEqual('=?UTF-8?B?U2VlIG9uIMO1aGluIHRlc3Q=?=', mimeFuncs.encodeWord('See on õhin test', 'B'));
        });
    });

    describe('#encodeWords', () => {
        it('should encode Ascii range', () => {
            let input1 = 'метель" вьюга',
                input2 = 'метель\x27вьюга',
                input3 = 'Verão você vai adorar!',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=27?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output3 = '=?UTF-8?Q?Ver=C3=A3o_voc=C3=AA?= vai adorar!',
                output4 = '=?UTF-8?Q?Ver=C3=A3o_voc=C3=AA_vai_adorar!?=';

            assert.strictEqual(mimeFuncs.encodeWords(input1, 'Q', 52), output1);
            assert.strictEqual(mimeFuncs.encodeWords(input2, 'Q', 52), output2);
            assert.strictEqual(mimeFuncs.encodeWords(input3, 'Q', 52), output3);
            assert.strictEqual(mimeFuncs.encodeWords(input3, 'Q', 52, true), output4);
        });

        it('should split QP on maxLength', () => {
            let inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr =
                    '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?mugeva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva?=',
                encoded = mimeFuncs.encodeWords(inputStr, 'Q', 16);

            assert.strictEqual(outputStr, encoded);
            assert.strictEqual(inputStr, libmime.decodeWords(encoded));
        });

        it('should split base64 on maxLength', () => {
            let inputStr = 'õõõõõ õõõõõ õõõõõ mugeva õõõõõ õõõõõ õõõõõ õõõõõ Jõgeva',
                outputStr =
                    '=?UTF-8?B?w7XDtcO1w7XDtSA=?= =?UTF-8?B?w7XDtcO1w7XDtSA=?= =?UTF-8?B?w7XDtcO1w7XDtSBt?= =?UTF-8?B?dWdldmEgw7XDtcO1?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSBKw7VnZXZh?=',
                encoded = mimeFuncs.encodeWords(inputStr, 'B', 30);

            assert.strictEqual(outputStr, encoded);
            assert.strictEqual(inputStr, libmime.decodeWords(encoded));
        });
    });

    describe('#buildHeaderParam', () => {
        it('should return unmodified', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title',
                        value: 'this is just a title'
                    }
                ],
                mimeFuncs.buildHeaderParam('title', 'this is just a title', 500)
            );
        });

        it('should encode and split ascii', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0',
                        value: 'this '
                    },
                    {
                        key: 'title*1',
                        value: 'is ju'
                    },
                    {
                        key: 'title*2',
                        value: 'st a '
                    },
                    {
                        key: 'title*3',
                        value: 'title'
                    }
                ],
                mimeFuncs.buildHeaderParam('title', 'this is just a title', 5)
            );
        });

        it('should encode double byte unicode characters', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0*',
                        value: 'utf-8\x27\x27Unicode%20title%20%F0%9F%98%8A'
                    }
                ],
                mimeFuncs.buildHeaderParam('title', 'Unicode title 😊', 50)
            );
        });

        it('should encode and split unicode', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0*',
                        value: 'utf-8\x27\x27this%20is%20'
                    },
                    {
                        key: 'title*1',
                        value: 'just a title '
                    },
                    {
                        key: 'title*2*',
                        value: '%C3%B5%C3%A4%C3%B6'
                    },
                    {
                        key: 'title*3*',
                        value: '%C3%BC'
                    }
                ],
                mimeFuncs.buildHeaderParam('title', 'this is just a title õäöü', 20)
            );
        });

        it('should encode and split filename with dashes', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'filename*0*',
                        value: 'utf-8\x27\x27%C6%94------%C6%94------%C6%94------%C6%94'
                    },
                    {
                        key: 'filename*1*',
                        value: '------%C6%94------%C6%94------%C6%94------.pdf'
                    }
                ],
                mimeFuncs.buildHeaderParam('filename', 'Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------.pdf', 50)
            );
        });

        it('should encode and decode', () => {
            let input =
                'Lorěm ipsum doloř siť amet, háš peřpetua compřéhenšam at, ei nám modó soleát éxpétěndá! Boňorum vocibůs dignisšim pro ad, ea sensibus efficiendi intellegam ius. Ad nam aperiam delicata voluptaria, vix nobis luptatum ea, ců úsú graeco viďiššě ňusqúam. ';
            let headerLine =
                'content-disposition: attachment; ' +
                mimeFuncs
                    .buildHeaderParam('filename', input, 50)
                    .map(item => item.key + '="' + item.value + '"')
                    .join('; ');
            let parsedHeader = mimeFuncs.parseHeaderValue(headerLine);
            assert.strictEqual(input, libmime.decodeWords(parsedHeader.params.filename));
        });
    });

    describe('#parseHeaderValue', () => {
        it('should handle default value only', () => {
            let str = 'text/plain',
                obj = {
                    value: 'text/plain',
                    params: {}
                };

            assert.deepStrictEqual(mimeFuncs.parseHeaderValue(str), obj);
        });

        it('should handle unquoted params', () => {
            let str = 'text/plain; CHARSET= UTF-8; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        charset: 'UTF-8',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(mimeFuncs.parseHeaderValue(str), obj);
        });

        it('should handle quoted params', () => {
            let str = 'text/plain; filename= ";;;\\""; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        filename: ';;;"',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(mimeFuncs.parseHeaderValue(str), obj);
        });

        it('should handle multi line values', () => {
            let str =
                    'text/plain; single_encoded*="UTF-8\'\'%C3%95%C3%84%C3%96%C3%9C";\n' +
                    ' multi_encoded*0*=UTF-8\x27\x27%C3%96%C3%9C;\n' +
                    ' multi_encoded*1*=%C3%95%C3%84;\n' +
                    ' no_charset*0=OA;\n' +
                    ' no_charset*1=OU;\n' +
                    ' invalid*=utf-8\x27\x27 _?\x27=%ab',
                obj = {
                    value: 'text/plain',
                    params: {
                        single_encoded: '=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=',
                        multi_encoded: '=?UTF-8?Q?=C3=96=C3=9C=C3=95=C3=84?=',
                        no_charset: 'OAOU',
                        invalid: '=?utf-8?Q?_=5f=3f\x27=3d=ab?='
                    }
                };

            assert.deepStrictEqual(mimeFuncs.parseHeaderValue(str), obj);
        });

        it('should handle params only', () => {
            let str = '; CHARSET= UTF-8; format=flowed;',
                obj = {
                    value: '',
                    params: {
                        charset: 'UTF-8',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(mimeFuncs.parseHeaderValue(str), obj);
        });
    });

    describe('#_buildHeaderValue', () => {
        it('should build header value', () => {
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test'
                }),
                'test'
            );
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b'
                    }
                }),
                'test; a=b'
            );
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: ';'
                    }
                }),
                'test; a=";"'
            );
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: ';"'
                    }
                }),
                "test; a*0*=utf-8''%3B%22"
            );
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        c: 'd'
                    }
                }),
                'test; a=b; c=d'
            );
        });

        it('should handle unicode filename', () => {
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        filename: '😁😂 *\'%()<>@,;:\\"[]?=😃😄zzz😊õäöü😓.pdf'
                    }
                }),
                'test; a=b; filename*0*=utf-8\x27\x27%F0%9F%98%81%F0%9F%98%82%20%2A%27%25%28%29; filename*1*=%3C%3E%40%2C%3B%3A%5C%22%5B%5D%3F%3D%F0%9F%98%83; filename*2*=%F0%9F%98%84zzz%F0%9F%98%8A%C3%B5%C3%A4%C3%B6; filename*3*=%C3%BC%F0%9F%98%93.pdf'
            );
        });

        it('should handle dashed filename', () => {
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------.pdf'
                    }
                }),
                'test; filename*0*=utf-8\x27\x27%C6%94------%C6%94------%C6%94------%C6%94; filename*1*=------%C6%94------%C6%94------%C6%94------.pdf'
            );
        });

        it('should split emoji filename', () => {
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        filename: 'Jõge-vaŽJõge-vaŽJõge-vaŽ.pdf'
                    }
                }),
                'test; a=b; filename*0*=utf-8\x27\x27J%C3%B5ge-va%C5%BDJ%C3%B5ge-va%C5%BDJ; filename*1*=%C3%B5ge-va%C5%BD.pdf'
            );
        });

        it('should quote filename with spaces', () => {
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'document a.pdf'
                    }
                }),
                'test; filename="document a.pdf"'
            );
        });

        // For exhaustive list of special characters
        // Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
        it('should quote filename with special characters', () => {
            // The case of browser downloads when we download multiple files with same name.
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'receipt(3).pdf'
                    }
                }),
                'test; filename="receipt(3).pdf"'
            );

            // For headers which are comma separated as in case of multiple from members elements.
            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'jack,jill.pdf'
                    }
                }),
                'test; filename="jack,jill.pdf"'
            );

            // Added support for some more special characters
            let correctString = [
                'space="x y"',
                'small_bracket_open="x(y"',
                'small_bracket_close="x)y"',
                'angle_bracket_open="x<y"',
                'angle_bracket_close="x>y"',
                'at_the_rate="x@y"',
                'semicolon="x;y"',
                'colon="x:y"',
                'back_slash="x\\\\y"',
                'single_quote="x\'y"',
                "double_quotes*0*=utf-8''x%22y",
                'forward_slash="x/y"',
                'big_bracket_open="x[y"',
                'big_bracket_close="x]y"',
                'question_mark="x?y"',
                'comma="x,y"',
                'equals="x=y"',
                'negative_in_mid=x-y',
                'negative_in_start="-x"'
            ].join('; ');

            assert.strictEqual(
                mimeFuncs.buildHeaderValue({
                    value: 'test',
                    params: {
                        space: 'x y',
                        small_bracket_open: 'x(y',
                        small_bracket_close: 'x)y',
                        angle_bracket_open: 'x<y',
                        angle_bracket_close: 'x>y',
                        at_the_rate: 'x@y',
                        semicolon: 'x;y',
                        colon: 'x:y',
                        back_slash: 'x\\y',
                        single_quote: 'x\x27y',
                        double_quotes: 'x"y',
                        forward_slash: 'x/y',
                        big_bracket_open: 'x[y',
                        big_bracket_close: 'x]y',
                        question_mark: 'x?y',
                        comma: 'x,y',
                        equals: 'x=y',
                        negative_in_mid: 'x-y',
                        negative_in_start: '-x'
                    }
                }),
                'test; ' + correctString
            );
        });
    });

    describe('#foldLines', () => {
        it('should Fold long header line', () => {
            let inputStr = 'Subject: Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr =
                    'Subject: Testin command line kirja\r\n' +
                    ' =?UTF-8?Q?=C3=B5kva_kakva_m=C3=B5ni_t=C3=B5nis_k?=\r\n' +
                    ' =?UTF-8?Q?=C3=B5llas_p=C3=B5llas_t=C3=B5llas_r?=\r\n' +
                    ' =?UTF-8?Q?=C3=B5llas_ju=C5=A1la_ku=C5=A1la_tu?= =?UTF-8?Q?=C5=A1la?= musla',
                encodedHeaderLine = mimeFuncs.encodeWords(inputStr, 'Q', 52);

            assert.strictEqual(outputStr, mimeFuncs.foldLines(encodedHeaderLine, 76));
        });

        it('should Fold flowed text', () => {
            let inputStr =
                    'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr =
                    'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas \r\n' +
                    'jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis \r\n' +
                    'kõllas põllas tõllas rõllas jušla kušla tušla musla';

            assert.strictEqual(outputStr, mimeFuncs.foldLines(inputStr, 76, true));
        });

        it('should fold one long line', () => {
            let inputStr =
                    'Subject: =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=',
                outputStr =
                    'Subject:\r\n =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=';

            assert.strictEqual(outputStr, mimeFuncs.foldLines(inputStr, 76));
        });
    });
});
