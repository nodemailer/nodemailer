'use strict';

/**
 * Restores the quoting of a local part that was read out of a quoted string.
 *
 * RFC 5321 allows '@' inside a quoted local part, so handing '"user@evil.com"@good.com'
 * on as the bare 'user@evil.com@good.com' leaves it to the consumer which '@' splits the
 * domain off. Getting that wrong is a misrouting vector, so the quotes go back on. The
 * same holds for the other specials: a ',' or a ';' that loses its quotes reads as a
 * recipient separator once the consumer puts the address back into a header.
 *
 * This module has no dependencies so that it can ship on its own, which is why the two
 * grammar tests below are spelled out here instead of shared with lib/mime-node. Keeping
 * only what is ambiguous quoted is deliberate, mime-node applies the stricter RFC 5321
 * dot-atom rule on top of this when it emits an address.
 *
 * @param {String} address Address with an unquoted local part
 * @return {String} Address with the local part as a quoted-string
 */
function _quoteLocalPart(address) {
    const lastAt = address.lastIndexOf('@');
    if (lastAt < 0) {
        // no domain to split off, nothing can be misrouted
        return address;
    }

    const user = address.substr(0, lastAt);
    if (/^[^\s"(),:;<>@[\\\]]+$/.test(user) || /^"(?:[^"\\]|\\[\s\S])*"$/.test(user)) {
        // a local part that carries no special reads the same with or without the quotes,
        // and one that is already a complete quoted-string needs nothing either
        return address;
    }

    return '"' + user.replace(/["\\]/g, '\\$&') + '"@' + address.substr(lastAt + 1);
}

/**
 * Reached for every parsed address, so it is built once rather than per call.
 */
const HAS_WHITESPACE = /\s/;

/**
 * An addr-spec that carries its whitespace legally, inside a quoted local part. The
 * optional tail is the malformed shape: a real mailbox with wreckage trailing it.
 */
const QUOTED_LOCAL_ADDR = /^("(?:[^"\\]|\\[\s\S])*"@\S+)(?:\s+([\s\S]+))?$/;

/**
 * One run holding a single '@' and no whitespace, the shape an addr-spec has to have.
 */
const ADDR_SPEC = /^[^@\s]+@[^@\s]+$/;

/**
 * The looser reading applied once the strict one finds nothing, which tolerates the
 * further '@' that a domain should not have but malformed headers carry anyway.
 */
const LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;

/**
 * Recovers the addr-spec from an angle-addr that came back holding unquoted whitespace.
 *
 * A malformed header can put more than a mailbox between the angle brackets, most often
 * because the generator wrote the recipient twice: '<user@example.com user@example.com>'
 * or '<example.com user@example.com>'. Whitespace is not addr-spec, so the whole run can
 * never be a mailbox anyone could deliver to, and passing it on as the address loses the
 * recipient that is sitting right there in the header.
 *
 * The run that still reads as an addr-spec is kept and whatever is left over becomes
 * display text rather than being dropped. Candidates are read strictly first and then
 * under the looser grammar, the same two tiers the unquoted-text branch below applies to
 * the same problem, so that '<a@b@c.com junk>' and a bare 'a@b@c.com junk' agree on the
 * recipient. When several runs qualify the first wins, which is what that branch's looser
 * tier does within a token.
 *
 * A quoted local part is left alone: RFC 5321 allows whitespace inside it, so
 * '<"user name"@example.com>' is well formed and means exactly what it says.
 *
 * @param {Object} data Collected address parts, mutated in place
 */
function _recoverAddrSpec(data) {
    if (!HAS_WHITESPACE.test(data.address)) {
        return;
    }

    let address;
    let rest;

    const quoted = data.address.match(QUOTED_LOCAL_ADDR);
    if (quoted) {
        if (!quoted[2]) {
            // the whitespace sits inside the quoted local part, this is a well formed mailbox
            return;
        }

        // a real mailbox with wreckage trailing it, so peel the addr-spec off whole rather
        // than splitting into the quotes
        address = quoted[1];
        rest = [quoted[2]];
    } else {
        if (data.address.indexOf('"') >= 0) {
            // Splitting on whitespace loses track of where the quoted string starts and ends,
            // and this module does not take addresses out of quoted strings: the run picked out
            // of '<junk "user@evil.com b"@good.com>' would be an address from the domain the
            // quotes were hiding. Every well formed shape was already handled above, so what is
            // left is wreckage either way and the original is the honest answer
            return;
        }

        const parts = data.address.split(/\s+/);

        let addrIndex = parts.findIndex(part => ADDR_SPEC.test(part));
        if (addrIndex < 0) {
            addrIndex = parts.findIndex(part => LOOSE_ADDR_SPEC.test(part));
        }

        if (addrIndex < 0) {
            // nothing in there reads as an address, there is no better answer than the original
            return;
        }

        address = parts.splice(addrIndex, 1)[0];
        rest = parts;
    }

    data.address = address;
    data.text = [data.text]
        .concat(rest)
        .filter(part => part)
        .join(' ');
}

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

            // A comment is folding whitespace. It may sit inside an addr-spec, on either
            // side of the '@', but it cannot join two atoms into one: gluing across it
            // would read 'user@example.com(x)evil.com' as the single domain
            // 'example.comevil.com' and deliver to a domain the sender never named.
            const tail = data[state].length ? data[state][data[state].length - 1] : '';
            const joinsAcrossComment = tail.slice(-1) === '@' || token.value.charAt(0) === '@';

            if (prevToken && prevToken.noBreak && data[state].length && (!prevToken.cfws || joinsAcrossComment)) {
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
                if (!data.textWasQuoted[i] && ADDR_SPEC.test(data.text[i])) {
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

        // An address is only taken from unquoted text, so anything left in the text at this
        // point that still has to serve as the address carries its quoting in this flag
        const addressFromQuotedText = !data.address.length && data.textWasQuoted.some(wasQuoted => wasQuoted);

        // Join values with spaces
        data.text = data.text.join(' ');
        data.address = data.address.join(' ');

        _recoverAddrSpec(data);

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

        if (addressFromQuotedText && address.address) {
            address.address = _quoteLocalPart(address.address);
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
        this.inDomainLiteral = false;

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
        // Track RFC 5322 domain-literals ("[" *dtext "]"). Operator characters such
        // as the ":" of an IPv6 address-literal (user@[IPv6:2001:db8::1]) are dtext
        // and must not be treated as the group delimiter while inside the brackets.
        // Quoted strings and comments are handled separately via operatorExpecting,
        // so only enter this state when no operator is open. The list separators ","
        // and ";" are the exception: they always end the literal (and split the
        // address list) so that an unclosed "[" cannot swallow later recipients.
        if (!this.escaped && !this.operatorExpecting) {
            if (!this.inDomainLiteral && chr === '[') {
                this.inDomainLiteral = true;
            } else if (this.inDomainLiteral && (chr === ']' || chr === ',' || chr === ';')) {
                this.inDomainLiteral = false;
            }
        }

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

            if (chr === ')') {
                // Closing a comment, which is folding whitespace rather than content
                this.node.cfws = true;
            }

            this.list.push(this.node);
            this.node = null;
            this.operatorExpecting = '';
            this.escaped = false;

            return;
        } else if (!this.operatorExpecting && !this.inDomainLiteral && chr in this.operators) {
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
        // Appended in place. Rebuilding the accumulator with concat() would copy every
        // entry collected so far on each address, making a flat list cost O(n^2).
        for (let i = 0; i < handled.length; i++) {
            parsedAddresses.push(handled[i]);
        }
    });

    // Merge fragments produced when unquoted display names contain commas.
    // "Joe Foo, PhD <joe@example.com>" is split on the comma into
    // [{name:"Joe Foo", address:""}, {name:"PhD", address:"joe@example.com"}].
    // Recombine: a name-only entry followed by an entry with both name and address.
    // Walked back to front so that a run of fragments folds into one entry in a single
    // pass. Splicing each fragment out of the list instead would cost O(n^2).
    const mergedAddresses = [];
    for (let i = parsedAddresses.length - 1; i >= 0; i--) {
        const current = parsedAddresses[i];
        const next = mergedAddresses.length ? mergedAddresses[mergedAddresses.length - 1] : null;
        if (next && current.address === '' && current.name && !current.group && next.address && next.name) {
            next.name = current.name + ', ' + next.name;
        } else {
            mergedAddresses.push(current);
        }
    }
    mergedAddresses.reverse();
    parsedAddresses = mergedAddresses;

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
