/* eslint no-unused-expressions:0, prefer-arrow-callback: 0, no-undefined: 0 */
/* globals describe, it */

'use strict';

const chai = require('chai');
const addressparser = require('../../lib/addressparser');
const expect = chai.expect;

chai.config.includeStack = true;

describe('#addressparser', function () {
    it('should handle single address correctly', function () {
        let input = 'andris@tr.ee';
        let expected = [
            {
                address: 'andris@tr.ee',
                name: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle multiple addresses correctly', function () {
        let input = 'andris@tr.ee, andris@example.com';
        let expected = [
            {
                address: 'andris@tr.ee',
                name: ''
            },
            {
                address: 'andris@example.com',
                name: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle unquoted name correctly', function () {
        let input = 'andris <andris@tr.ee>';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle quoted name correctly', function () {
        let input = '"reinman, andris" <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman, andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle quoted semicolons correctly', function () {
        let input = '"reinman; andris" <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman; andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle unquoted name, unquoted address correctly', function () {
        let input = 'andris andris@tr.ee';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle emtpy group correctly', function () {
        let input = 'Undisclosed:;';
        let expected = [
            {
                name: 'Undisclosed',
                group: []
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle address group correctly', function () {
        let input = 'Disclosed:andris@tr.ee, andris@example.com;';
        let expected = [
            {
                name: 'Disclosed',
                group: [
                    {
                        address: 'andris@tr.ee',
                        name: ''
                    },
                    {
                        address: 'andris@example.com',
                        name: ''
                    }
                ]
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle semicolon as a delimiter', function () {
        let input = 'andris@tr.ee; andris@example.com;';
        let expected = [
            {
                address: 'andris@tr.ee',
                name: ''
            },
            {
                address: 'andris@example.com',
                name: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle mixed group correctly', function () {
        let input = 'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;';
        let expected = [
            {
                address: 'test.user@mail.ee',
                name: 'Test User'
            },
            {
                name: 'Disclosed',
                group: [
                    {
                        address: 'andris@tr.ee',
                        name: ''
                    },
                    {
                        address: 'andris@example.com',
                        name: ''
                    }
                ]
            },
            {
                name: 'Undisclosed',
                group: []
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should flatten mixed group correctly', function () {
        let input = 'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com BOB;';
        let expected = [
            {
                address: 'test.user@mail.ee',
                name: 'Test User'
            },

            {
                address: 'andris@tr.ee',
                name: ''
            },
            {
                address: 'andris@example.com',
                name: ''
            },
            {
                address: 'bob@example.com',
                name: 'BOB'
            }
        ];
        expect(addressparser(input, { flatten: true })).to.deep.equal(expected);
    });

    it('semicolon as delimiter should not break group parsing', function () {
        let input = 'Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;';
        let expected = [
            {
                address: 'test.user@mail.ee',
                name: 'Test User'
            },
            {
                name: 'Disclosed',
                group: [
                    {
                        address: 'andris@tr.ee',
                        name: ''
                    },
                    {
                        address: 'andris@example.com',
                        name: ''
                    }
                ]
            },
            {
                name: 'Undisclosed',
                group: []
            },
            {
                address: 'bob@example.com',
                name: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle name from comment correctly', function () {
        let input = 'andris@tr.ee (andris)';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle skip comment correctly', function () {
        let input = 'andris@tr.ee (reinman) andris';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle missing address correctly', function () {
        let input = 'andris';
        let expected = [
            {
                name: 'andris',
                address: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle apostrophe in name correctly', function () {
        let input = 'O\x27Neill';
        let expected = [
            {
                name: 'O\x27Neill',
                address: ''
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle particularily bad input, unescaped colon correctly', function () {
        let input = 'FirstName Surname-WithADash :: Company <firstname@company.com>';
        let expected = [
            {
                name: 'FirstName Surname-WithADash',
                group: [
                    {
                        name: undefined,
                        group: [
                            {
                                address: 'firstname@company.com',
                                name: 'Company'
                            }
                        ]
                    }
                ]
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    // should not change an invalid email to valid email
    it('should handle invalid email address correctly', function () {
        let input = 'name@address.com@address2.com';
        let expected = [
            {
                name: '',
                address: 'name@address.com@address2.com'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle unexpected <', function () {
        let input = 'reinman > andris < test <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman > andris',
                address: 'andris@tr.ee'
            }
        ];
        expect(addressparser(input)).to.deep.equal(expected);
    });

    it('should handle escapes', function () {
        let input = '"Firstname \\" \\\\\\, Lastname \\(Test\\)" test@example.com';
        let expected = [{ address: 'test@example.com', name: 'Firstname " \\, Lastname (Test)' }];
        expect(addressparser(input)).to.deep.equal(expected);
    });
});
