'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const addressparser = require('../../lib/addressparser');

describe('#addressparser', () => {
    it('should handle single address correctly', () => {
        let input = 'andris@tr.ee';
        let expected = [
            {
                address: 'andris@tr.ee',
                name: ''
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle multiple addresses correctly', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle unquoted name correctly', () => {
        let input = 'andris <andris@tr.ee>';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle quoted name correctly', () => {
        let input = '"reinman, andris" <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman, andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle quoted semicolons correctly', () => {
        let input = '"reinman; andris" <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman; andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle unquoted name, unquoted address correctly', () => {
        let input = 'andris andris@tr.ee';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle emtpy group correctly', () => {
        let input = 'Undisclosed:;';
        let expected = [
            {
                name: 'Undisclosed',
                group: []
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle address group correctly', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle semicolon as a delimiter', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle mixed group correctly', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should flatten mixed group correctly', () => {
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
        assert.deepStrictEqual(addressparser(input, { flatten: true }), expected);
    });

    it('semicolon as delimiter should not break group parsing', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle name from comment correctly', () => {
        let input = 'andris@tr.ee (andris)';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle skip comment correctly', () => {
        let input = 'andris@tr.ee (reinman) andris';
        let expected = [
            {
                name: 'andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle missing address correctly', () => {
        let input = 'andris';
        let expected = [
            {
                name: 'andris',
                address: ''
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle apostrophe in name correctly', () => {
        let input = "O'Neill";
        let expected = [
            {
                name: "O'Neill",
                address: ''
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle particularily bad input, unescaped colon correctly', () => {
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
        assert.deepStrictEqual(addressparser(input), expected);
    });

    // should not change an invalid email to valid email
    it('should handle invalid email address correctly', () => {
        let input = 'name@address.com@address2.com';
        let expected = [
            {
                name: '',
                address: 'name@address.com@address2.com'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle unexpected <', () => {
        let input = 'reinman > andris < test <andris@tr.ee>';
        let expected = [
            {
                name: 'reinman > andris',
                address: 'andris@tr.ee'
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle escapes', () => {
        let input = '"Firstname \\" \\\\\\, Lastname \\(Test\\)" test@example.com';
        let expected = [{ address: 'test@example.com', name: 'Firstname " \\, Lastname (Test)' }];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    it('should handle quoted usernames', () => {
        let input = '"test@subdomain.com"@example.com';
        let expected = [
            {
                address: 'test@subdomain.com@example.com',
                name: ''
            }
        ];
        assert.deepStrictEqual(addressparser(input), expected);
    });

    // Security tests for RFC 5321/5322 quoted local-part handling
    it('should not extract email from quoted local-part (security)', () => {
        let input = '"xclow3n@gmail.com x"@internal.domain';
        let result = addressparser(input);
        // Should preserve full address, NOT extract xclow3n@gmail.com
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address.includes('@internal.domain'), true);
        assert.strictEqual(result[0].address, 'xclow3n@gmail.com x@internal.domain');
    });

    it('should handle quoted local-part with attacker domain (security)', () => {
        let input = '"user@attacker.com"@legitimate.com';
        let result = addressparser(input);
        // Should route to legitimate.com, not attacker.com
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address.includes('@legitimate.com'), true);
        assert.strictEqual(result[0].address, 'user@attacker.com@legitimate.com');
    });

    it('should handle multiple @ in quoted local-part (security)', () => {
        let input = '"a@b@c"@example.com';
        let result = addressparser(input);
        // Should not extract a@b or b@c
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'a@b@c@example.com');
    });

    it('should handle quoted local-part with angle brackets', () => {
        let input = 'Name <"user@domain.com"@example.com>';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'Name');
        // When address is in <>, quotes are preserved as part of the address
        assert.strictEqual(result[0].address, '"user@domain.com"@example.com');
    });
});
