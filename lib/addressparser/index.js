'use strict';

/**
 * Converts tokens for a single address into an address object
 *
 * @param {Array} tokens Tokens object
 * @param {Number} depth Current recursion depth for nested group protection
 * @return {Object} Address object
 */
function _handleAddress(tokens, depth) {
    let isGroup = false;
    let state = 'text';
    const addresses = [];
    const data = {
        address: [],
        comment: [],
        group: [],
        text: [],
        textWasQuoted: []
    };
    let insideQuotes = false;

    // Filter out <addresses>, (comments) and regular text
    for (let i = 0, len = tokens.length; i < len; i++) {
        const token = tokens[i];
        const prevToken = i ? tokens[i - 1] : null;
        if (token.type === 'operator') {
            switch (token.value) {
                case '<':
                    state = 'address';
                    insideQuotes = false;
                    break;
                case '(':
                    state = 'comment';
                    insideQuotes = false;
                    break;
                case ':':
                    state = 'group';
                    isGroup = true;
                    insideQuotes = false;
                    break;
                case '"':
                    insideQuotes = !insideQuotes;
                    state = 'text';
                    break;
                default:
                    state = 'text';
                    insideQuotes = false;
                    break;
            }
        } else if (token.value) {
            if (state === 'address') {
                // Handle unquoted name that includes a "<".
                // Apple Mail truncates everything between an unexpected < and an address.
                token.value = token.value.replace(/^[^<]*<\s*/, '');
            }

            if (prevToken && prevToken.noBreak && data[state].length) {
                data[state][data[state].length - 1] += token.value;
                if (state === 'text' && insideQuotes) {
                    data.textWasQuoted[data.textWasQuoted.length - 1] = true;
                }
            } else {
                data[state].push(token.value);
                if (state === 'text') {
                    data.textWasQuoted.push(insideQuotes);
                }
            }
        }
    }

    // If there is no text but a comment, replace the two
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
    }

    if (isGroup) {
        // http://tools.ietf.org/html/rfc2822#appendix-A.1.3
        data.text = data.text.join(' ');

        // Parse group members, but flatten any nested groups (RFC 5322 doesn't allow nesting)
        let groupMembers = [];
        if (data.group.length) {
            const parsedGroup = addressparser(data.group.join(','), { _depth: depth + 1 });
            parsedGroup.forEach(member => {
                if (member.group) {
                    groupMembers = groupMembers.concat(member.group);
                } else {
                    groupMembers.push(member);
                }
            });
        }

        addresses.push({
            name: data.text || '',
            group: groupMembers
        });
    } else {
        // If no address was found, try to detect one from regular text
        if (!data.address.length && data.text.length) {
            for (let i = data.text.length - 1; i >= 0; i--) {
                // Security: Do not extract email addresses from quoted strings.
                // RFC 5321 allows @ inside quoted local-parts like "user@domain"@example.com.
                // Extracting emails from quoted text leads to misrouting vulnerabilities.
                if (!data.textWasQuoted[i] && /^[^@\s]+@[^@\s]+$/.test(data.text[i])) {
                    data.address = data.text.splice(i, 1);
                    data.textWasQuoted.splice(i, 1);
                    break;
                }
            }

            // Try a looser regex match if strict match found nothing
            if (!data.address.length) {
                let extracted = false;
                for (let i = data.text.length - 1; i >= 0; i--) {
                    // Security: Do not extract email addresses from quoted strings
                    if (!data.textWasQuoted[i]) {
                        data.text[i] = data.text[i]
                            .replace(/\s*\b[^@\s]+@[^\s]+\b\s*/, match => {
                                if (!extracted) {
                                    data.address = [match.trim()];
                                    extracted = true;
                                    return ' ';
                                }
                                return match;
                            })
                            .trim();
                        if (extracted) {
                            break;
                        }
                    }
                }
            }
        }

        // If there's still no text but a comment exists, replace the two
        if (!data.text.length && data.comment.length) {
            data.text = data.comment;
            data.comment = [];
        }

        // Keep only the first address occurrence, push others to regular text
        if (data.address.length > 1) {
            data.text = data.text.concat(data.address.splice(1));
        }

        // Join values with spaces
        data.text = data.text.join(' ');
        data.address = data.address.join(' ');

        const address = {
            address: data.address || data.text || '',
            name: data.text || data.address || ''
        };

        if (address.address === address.name) {
            if (/@/.test(address.address || '')) {
                address.name = '';
            } else {
                address.address = '';
            }
        }

        addresses.push(address);
    }

    return addresses;
}

/**
 * Creates a Tokenizer object for tokenizing address field strings
 *
 * @constructor
 * @param {String} str Address field string
 */
class Tokenizer {
    constructor(str) {
        this.str = (str || '').toString();
        this.operatorCurrent = '';
        this.operatorExpecting = '';
        this.node = null;
        this.escaped = false;

        this.list = [];
        /**
         * Operator tokens and which tokens are expected to end the sequence
         */
        this.operators = {
            '"': '"',
            '(': ')',
            '<': '>',
            ',': '',
            ':': ';',
            // Semicolons are not a legal delimiter per the RFC2822 grammar other
            // than for terminating a group, but they are also not valid for any
            // other use in this context.  Given that some mail clients have
            // historically allowed the semicolon as a delimiter equivalent to the
            // comma in their UI, it makes sense to treat them the same as a comma
            // when used outside of a group.
            ';': ''
        };
    }

    /**
     * Tokenizes the original input string
     *
     * @return {Array} An array of operator|text tokens
     */
    tokenize() {
        const list = [];

        for (let i = 0, len = this.str.length; i < len; i++) {
            const chr = this.str.charAt(i);
            const nextChr = i < len - 1 ? this.str.charAt(i + 1) : null;
            this.checkChar(chr, nextChr);
        }

        this.list.forEach(node => {
            node.value = (node.value || '').toString().trim();
            if (node.value) {
                list.push(node);
            }
        });

        return list;
    }

    /**
     * Checks if a character is an operator or text and acts accordingly
     *
     * @param {String} chr Character from the address field
     */
    checkChar(chr, nextChr) {
        if (this.escaped) {
            // ignore next condition blocks
        } else if (chr === this.operatorExpecting) {
            this.node = {
                type: 'operator',
                value: chr
            };

            if (nextChr && ![' ', '\t', '\r', '\n', ',', ';'].includes(nextChr)) {
                this.node.noBreak = true;
            }

            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = '';
            this.escaped = false;

            return;
        } else if (!this.operatorExpecting && chr in this.operators) {
            this.node = {
                type: 'operator',
                value: chr
            };
            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = this.operators[chr];
            this.escaped = false;
            return;
        } else if (['"', "'"].includes(this.operatorExpecting) && chr === '\\') {
            this.escaped = true;
            return;
        }

        if (!this.node) {
            this.node = {
                type: 'text',
                value: ''
            };
            this.list.push(this.node);
        }

        if (chr === '\n') {
            // Convert newlines to spaces. Carriage return is ignored as \r and \n usually
            // go together anyway and there already is a WS for \n. Lone \r means something is fishy.
            chr = ' ';
        }

        if (chr.charCodeAt(0) >= 0x21 || [' ', '\t'].includes(chr)) {
            // skip command bytes
            this.node.value += chr;
        }

        this.escaped = false;
    }
}

/**
 * Maximum recursion depth for parsing nested groups.
 * RFC 5322 doesn't allow nested groups, so this is a safeguard against
 * malicious input that could cause stack overflow.
 */
const MAX_NESTED_GROUP_DEPTH = 50;

/**
 * Parses structured e-mail addresses from an address field
 *
 * Example:
 *
 *    'Name <address@domain>'
 *
 * will be converted to
 *
 *     [{name: 'Name', address: 'address@domain'}]
 *
 * @param {String} str Address field
 * @param {Object} options Optional options object
 * @param {Number} options._depth Internal recursion depth counter (do not set manually)
 * @return {Array} An array of address objects
 */
function addressparser(str, options) {
    options = options || {};
    const depth = options._depth || 0;

    // Prevent stack overflow from deeply nested groups (DoS protection)
    if (depth > MAX_NESTED_GROUP_DEPTH) {
        return [];
    }

    const tokenizer = new Tokenizer(str);
    const tokens = tokenizer.tokenize();

    const addresses = [];
    let address = [];
    let parsedAddresses = [];

    tokens.forEach(token => {
        if (token.type === 'operator' && (token.value === ',' || token.value === ';')) {
            if (address.length) {
                addresses.push(address);
            }
            address = [];
        } else {
            address.push(token);
        }
    });

    if (address.length) {
        addresses.push(address);
    }

    addresses.forEach(addr => {
        const handled = _handleAddress(addr, depth);
        if (handled.length) {
            parsedAddresses = parsedAddresses.concat(handled);
        }
    });

    // Merge fragments produced when unquoted display names contain commas.
    // "Joe Foo, PhD <joe@example.com>" is split on the comma into
    // [{name:"Joe Foo", address:""}, {name:"PhD", address:"joe@example.com"}].
    // Recombine: a name-only entry followed by an entry with both name and address.
    for (let i = parsedAddresses.length - 2; i >= 0; i--) {
        const current = parsedAddresses[i];
        const next = parsedAddresses[i + 1];
        if (current.address === '' && current.name && !current.group && next.address && next.name) {
            next.name = current.name + ', ' + next.name;
            parsedAddresses.splice(i, 1);
        }
    }

    if (options.flatten) {
        const flatAddresses = [];
        const walkAddressList = list => {
            list.forEach(entry => {
                if (entry.group) {
                    return walkAddressList(entry.group);
                }
                flatAddresses.push(entry);
            });
        };
        walkAddressList(parsedAddresses);
        return flatAddresses;
    }

    return parsedAddresses;
}

module.exports = addressparser;
