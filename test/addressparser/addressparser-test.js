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
        // Nested groups are not allowed per RFC 5322, so they should be flattened
        let expected = [
            {
                name: 'FirstName Surname-WithADash',
                group: [
                    {
                        address: 'firstname@company.com',
                        name: 'Company'
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

    // Edge case tests
    it('should handle escaped quotes in quoted string', () => {
        let input = '"test\\"quote"@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'test"quote@example.com');
    });

    it('should handle escaped backslashes', () => {
        let input = '"test\\\\backslash"@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'test\\backslash@example.com');
    });

    it('should handle unclosed quote gracefully', () => {
        let input = '"unclosed@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'unclosed@example.com');
    });

    it('should handle unclosed angle bracket', () => {
        let input = 'Name <user@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    it('should handle unclosed comment', () => {
        let input = 'user@example.com (comment';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    it('should handle empty string', () => {
        let result = addressparser('');
        assert.strictEqual(result.length, 0);
    });

    it('should handle whitespace only', () => {
        let result = addressparser('   ');
        assert.strictEqual(result.length, 0);
    });

    it('should handle empty angle brackets', () => {
        let result = addressparser('<>');
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, '');
    });

    it('should handle special characters in local-part', () => {
        let inputs = ['user+tag@example.com', 'user.name@example.com', 'user_name@example.com', 'user-name@example.com'];
        inputs.forEach(input => {
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, input);
        });
    });

    it('should handle leading and trailing whitespace', () => {
        let input = '  user@example.com  ';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    it('should handle comment before address', () => {
        let input = '(comment)user@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    it('should handle comment after address without space', () => {
        let input = 'user@example.com(comment)';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    it('should handle multiple consecutive delimiters', () => {
        let input = 'a@example.com,,,b@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].address, 'a@example.com');
        assert.strictEqual(result[1].address, 'b@example.com');
    });

    it('should handle mixed quotes and unquoted text', () => {
        let input = '"quoted" unquoted@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'quoted');
        assert.strictEqual(result[0].address, 'unquoted@example.com');
    });

    it('should handle very long local-part', () => {
        let longLocal = 'a'.repeat(100);
        let input = longLocal + '@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, input);
    });

    it('should handle very long domain', () => {
        let longDomain = 'a'.repeat(100);
        let input = 'user@' + longDomain + '.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, input);
    });

    it('should not have ReDoS vulnerability with many @ symbols', () => {
        let input = '@'.repeat(100);
        let start = Date.now();
        let result = addressparser(input);
        let elapsed = Date.now() - start;
        assert.ok(elapsed < 1000, 'Parser should complete quickly even with pathological input');
        assert.ok(result.length >= 0);
    });

    it('should handle double @ (malformed)', () => {
        let input = 'user@@example.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        // Parser is lenient and accepts this
        assert.ok(result[0].address.includes('@@'));
    });

    it('should handle address with only name, no email', () => {
        let input = 'John Doe';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'John Doe');
        assert.strictEqual(result[0].address, '');
    });

    it('should handle nested comments (RFC 5322)', () => {
        let input = 'user@example.com (outer (nested) comment)';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address, 'user@example.com');
    });

    // Security: Ensure quotes at different positions don't break parsing
    it('should not extract from quoted text even with spaces', () => {
        let input = '"evil@attacker.com more stuff"@legitimate.com';
        let result = addressparser(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].address.includes('@legitimate.com'), true);
        assert.strictEqual(result[0].address.includes('evil@attacker.com'), true);
    });

    // Test flatten option with complex groups
    it('should flatten nested groups correctly', () => {
        let input = 'Group1:a@b.com, Group2:c@d.com;;';
        let result = addressparser(input, { flatten: true });
        // Should extract all individual addresses
        // Note: nested groups are now flattened at parse time, not just with flatten option
        let addresses = result.map(r => r.address).filter(a => a);
        assert.ok(addresses.includes('a@b.com'));
        assert.ok(addresses.includes('c@d.com'));
    });

    // Additional edge cases for nested group flattening
    describe('Nested group flattening (RFC 5322 compliance)', () => {
        it('should flatten deeply nested groups', () => {
            let input = 'Outer:Inner:deep@example.com;;';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Outer');
            assert.ok(result[0].group);
            // Should be flattened to single level
            assert.strictEqual(result[0].group.length, 1);
            assert.strictEqual(result[0].group[0].address, 'deep@example.com');
        });

        it('should flatten multiple nested groups at same level', () => {
            let input = 'Main:Sub1:a@b.com;, Sub2:c@d.com;;';
            let result = addressparser(input);
            // Comma creates separate top-level groups
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].name, 'Main');
            assert.strictEqual(result[1].name, 'Sub2');
            // First group should have flattened address from Sub1
            assert.strictEqual(result[0].group.length, 1);
            assert.strictEqual(result[0].group[0].address, 'a@b.com');
            // Second group has its own address
            assert.strictEqual(result[1].group.length, 1);
            assert.strictEqual(result[1].group[0].address, 'c@d.com');
        });

        it('should handle mixed nested and regular addresses in group', () => {
            let input = 'Group:x@y.com, Nested:a@b.com;, z@w.com;';
            let result = addressparser(input);
            // Comma after x@y.com creates a new top-level entry (Nested group)
            // Then comma after Nested; creates another top-level entry (z@w.com)
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].name, 'Group');
            // Group contains x@y.com and the flattened a@b.com from Nested
            assert.strictEqual(result[0].group.length, 2);
            assert.strictEqual(result[0].group[0].address, 'x@y.com');
            assert.strictEqual(result[0].group[1].address, 'a@b.com');
            // z@w.com is a separate top-level address
            assert.strictEqual(result[1].address, 'z@w.com');
        });
    });

    // Unicode and international domain tests
    describe('Unicode and international addresses', () => {
        it('should handle unicode in display name', () => {
            let input = 'Jüri Õunapuu <juri@example.com>';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Jüri Õunapuu');
            assert.strictEqual(result[0].address, 'juri@example.com');
        });

        it('should handle emoji in display name', () => {
            let input = '🤖 Robot <robot@example.com>';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, '🤖 Robot');
            assert.strictEqual(result[0].address, 'robot@example.com');
        });

        it('should handle unicode domain (IDN)', () => {
            let input = 'user@münchen.de';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@münchen.de');
        });

        it('should handle CJK characters in name', () => {
            let input = '田中太郎 <tanaka@example.jp>';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, '田中太郎');
            assert.strictEqual(result[0].address, 'tanaka@example.jp');
        });
    });

    // Real-world malformed input
    describe('Real-world malformed input handling', () => {
        it('should handle multiple angle brackets', () => {
            let input = 'Name <<user@example.com>>';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@example.com');
        });

        it('should handle address with no domain', () => {
            let input = 'user@';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@');
        });

        it('should handle address with no local part', () => {
            let input = '@example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            // Parser handles this gracefully
            assert.ok(result[0].address.includes('@example.com'));
        });

        it('should handle mixed case in domain', () => {
            let input = 'user@Example.COM';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@Example.COM');
        });

        it('should handle tab characters', () => {
            let input = 'user@example.com\t\tother@example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            // Tabs are treated as whitespace, should extract first email
            assert.strictEqual(result[0].address, 'user@example.com');
        });

        it('should handle newlines in input', () => {
            let input = 'user@example.com\nother@example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            // Newlines converted to spaces
            assert.strictEqual(result[0].address, 'user@example.com');
        });

        it('should handle CRLF line endings', () => {
            let input = 'user@example.com\r\nother@example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@example.com');
        });
    });

    // Group edge cases
    describe('Group edge cases', () => {
        it('should handle group with only spaces', () => {
            let input = 'EmptyGroup:   ;';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'EmptyGroup');
            assert.strictEqual(result[0].group.length, 0);
        });

        it('should handle group with invalid addresses', () => {
            let input = 'Group:not-an-email, another-invalid;';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Group');
            assert.strictEqual(result[0].group.length, 2);
        });

        it('should handle group name with special chars', () => {
            let input = 'Group-Name_123:user@example.com;';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'Group-Name_123');
            assert.strictEqual(result[0].group.length, 1);
        });

        it('should handle quoted group name', () => {
            let input = '"My Group":user@example.com;';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'My Group');
            assert.strictEqual(result[0].group.length, 1);
        });
    });

    // Comment edge cases
    describe('Comment edge cases', () => {
        it('should handle multiple comments', () => {
            let input = '(comment1)user@example.com(comment2)';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@example.com');
        });

        it('should handle empty comment', () => {
            let input = 'user@example.com()';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@example.com');
        });

        it('should handle comment with special characters', () => {
            let input = 'user@example.com (comment with @#$%)';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@example.com');
        });
    });

    // Subdomain tests
    describe('Subdomain handling', () => {
        it('should handle multiple subdomains', () => {
            let input = 'user@mail.server.company.example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@mail.server.company.example.com');
        });

        it('should handle numeric subdomains', () => {
            let input = 'user@123.456.example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@123.456.example.com');
        });

        it('should handle hyphenated subdomains', () => {
            let input = 'user@mail-server.example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@mail-server.example.com');
        });
    });

    // IP address domains
    describe('IP address domains', () => {
        it('should handle IPv4 address as domain', () => {
            let input = 'user@[192.168.1.1]';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].address, 'user@[192.168.1.1]');
        });

        it('should handle IPv6 address notation', () => {
            let input = 'user@[IPv6:2001:db8::1]';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            // Parser treats colons as potential group separators, so result may vary
            // Just verify we get a result and don't crash
            assert.ok(result.length > 0);
        });
    });

    // Performance tests
    describe('Performance and pathological inputs', () => {
        it('should handle very long address list efficiently', () => {
            let addresses = [];
            for (let i = 0; i < 1000; i++) {
                addresses.push(`user${i}@example.com`);
            }
            let input = addresses.join(', ');
            let start = Date.now();
            let result = addressparser(input);
            let elapsed = Date.now() - start;
            assert.ok(elapsed < 5000, 'Should parse 1000 addresses in under 5 seconds');
            assert.strictEqual(result.length, 1000);
        });

        it('should handle deeply nested quotes', () => {
            let input = '"test\\"nested\\"quotes"@example.com';
            let result = addressparser(input);
            assert.strictEqual(result.length, 1);
            assert.ok(result[0].address.includes('@example.com'));
        });

        it('should handle many consecutive delimiters', () => {
            let input = 'a@b.com' + ','.repeat(100) + 'c@d.com';
            let start = Date.now();
            let result = addressparser(input);
            let elapsed = Date.now() - start;
            assert.ok(elapsed < 1000, 'Should handle many delimiters quickly');
            assert.strictEqual(result.length, 2);
        });
    });
});
