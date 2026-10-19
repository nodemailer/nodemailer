/**
 * Options for addressparser
 */
export interface AddressParserOptions {
    /** Flatten groups into a single list of mailboxes */
    flatten?: boolean | undefined;
}

/**
 * A single mailbox. Either value may be an empty string when the input did not carry it
 */
export interface MailboxAddress {
    name: string;
    address: string;
    group?: undefined;
}

/**
 * An address group. RFC 5322 does not allow nested groups, so any nesting is flattened
 * into `group`
 */
export interface GroupAddress {
    name: string;
    group: Address[];
    address?: undefined;
}

/**
 * A parsed address entry, either a mailbox or a group
 */
export type Address = MailboxAddress | GroupAddress;

/* eslint-disable no-bitwise -- the kind of a token is a set of bit flags packed into one slot of a typed array */

/** The token is an operator, a text run otherwise */
const TOKEN_OPERATOR = 1;
/** The next character continues the same run without whitespace in between */
const TOKEN_NO_BREAK = 2;
/** The text run holds characters its value leaves out or changes, so it is no plain slice */
const TOKEN_DIRTY = 4;
/** A backslash escapes the next character in the text run, inside a quoted string or a comment */
const TOKEN_ESCAPES = 8;
/** The text run opens on a character an escaping backslash in front of it has escaped */
const TOKEN_STARTS_ESCAPED = 16;

/**
 * The tokens of an address field, kept as offsets into it.
 *
 * Every token used to be an object of its own, an operator for every ',' and a value string
 * for every run of text, and a list of one letter names, 'a,a,a,...', took some 65 times its
 * size in tokens before any address was read. A token is now three numbers in one typed
 * array, its kind and the range of the field it covers, and its value is sliced off the field
 * when it is read. The few text runs whose value differs from their slice, as they hold an
 * escaping backslash, a line break or a control character, are rebuilt once and kept aside.
 */
class TokenList {
    str: string;
    /** Kind, start and end of every token, three slots each */
    slots: Int32Array;
    length: number;
    /** Values of the text runs that are no plain slice of the field, by token index */
    cleaned: Map<number, string>;

    constructor(str: string) {
        this.str = str;
        this.slots = new Int32Array(48);
        this.length = 0;
        this.cleaned = new Map();
    }

    /**
     * Appends a token
     *
     * @param kind Kind and flags of the token
     * @param start Offset of its first character
     * @param end Offset just past its last character
     * @return Index of the token
     */
    push(kind: number, start: number, end: number): number {
        if ((this.length + 1) * 3 > this.slots.length) {
            const grown = new Int32Array(this.slots.length * 2);
            grown.set(this.slots);
            this.slots = grown;
        }
        const at = this.length * 3;
        this.slots[at] = kind;
        this.slots[at + 1] = start;
        this.slots[at + 2] = end;
        return this.length++;
    }

    /**
     * The character of an operator token, an empty string for a text run
     */
    operatorAt(index: number): string {
        const at = index * 3;
        return this.slots[at] & TOKEN_OPERATOR ? this.str.charAt(this.slots[at + 1]) : '';
    }

    /**
     * Whether a token is an operator
     */
    isOperator(index: number): boolean {
        return (this.slots[index * 3] & TOKEN_OPERATOR) !== 0;
    }

    /**
     * Whether the next character continues the run of a token without whitespace in between
     */
    noBreak(index: number): boolean {
        return (this.slots[index * 3] & TOKEN_NO_BREAK) !== 0;
    }

    /**
     * Value of a token
     */
    value(index: number): string {
        const cleaned = this.cleaned.get(index);
        if (cleaned !== undefined) {
            return cleaned;
        }
        return this.str.slice(this.slots[index * 3 + 1], this.slots[index * 3 + 2]);
    }
}

/* eslint-enable no-bitwise */

/**
 * Parts collected for a single address. `address` and `text` are lists of strings while
 * the tokens are walked and are joined into single strings before the address object is
 * built, which is why the two are left untyped
 */
interface AddressParts {
    address: any;
    comment: string[];
    text: any;
    textWasQuoted: boolean[];
    /**
     * For a text run that is a quoted local part followed by the unquoted '@' and domain of
     * an addr-spec, '"user"@example.com', the length of the local part, -1 otherwise
     */
    quotedLocalAt: number[];
}

/**
 * The run of an address the token walk is collecting into at a given point
 */
type AddressPartsState = 'text' | 'address' | 'comment';

/**
 * A domain literal that ends an address. dtext includes '@' (RFC 5322 3.4.1), so the '@'
 * in front of the literal is the one that splits the domain off, not the last one: reading
 * 'a@[x@evil.com]' at its last '@' made it an address at evil.com.
 */
const DOMAIN_LITERAL_TAIL = /@(\[[^[\]\\]*\])$/;

/**
 * Offset of the '@' that splits the domain off an address, or -1 when there is none
 *
 * @param address Address to split
 * @return Offset of the '@'
 */
function _domainAt(address: string): number {
    const literal = address.charAt(address.length - 1) === ']' ? DOMAIN_LITERAL_TAIL.exec(address) : null;
    return literal ? address.length - literal[1].length - 1 : address.lastIndexOf('@');
}

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
 * grammar tests below are spelled out here instead of shared with src/mime-node. Keeping
 * only what is ambiguous quoted is deliberate, mime-node applies the stricter RFC 5321
 * dot-atom rule on top of this when it emits an address.
 *
 * @param address Address with an unquoted local part
 * @return Address with the local part as a quoted-string
 */
function _quoteLocalPart(address: string): string {
    const lastAt = _domainAt(address);
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
 * The same with a domain literal for the domain, which may hold an '@' of its own.
 */
const LITERAL_ADDR_SPEC = /^[^@\s]+@\[[^[\]\\\s]*\]$/;

/**
 * The '@' and domain that follow a quoted local part in the same run.
 */
const QUOTED_LOCAL_DOMAIN = /^@(?:[^@\s"]+|\[[^[\]\\\s]*\])$/;

/**
 * Whether a whitespace free run reads as an addr-spec under the strict grammar
 *
 * @param value Run to check
 * @return true when it does
 */
function _isAddrSpec(value: string): boolean {
    return ADDR_SPEC.test(value) || LITERAL_ADDR_SPEC.test(value);
}

/**
 * The looser reading applied once the strict one finds nothing, which tolerates the
 * further '@' that a domain should not have but malformed headers carry anyway.
 */
const LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;

/**
 * An addr-spec sitting inside free text, together with the whitespace around it. Sticky
 * on purpose: it is run at the one offset _looseAddressStart picks rather than being let
 * loose to search, see there.
 */
const LOOSE_TEXT_ADDR = /\s*\b[^@\s]+@[^\s]+\b\s*/y;

/**
 * The characters JS `\s` matches, which the scan below has to agree with to land on the
 * same match the pattern would.
 */
function _isSpaceCode(code: number): boolean {
    return (
        code === 0x20 ||
        (code >= 0x09 && code <= 0x0d) ||
        code === 0xa0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000 ||
        code === 0xfeff
    );
}

/**
 * The characters JS `\w` matches without the unicode flag, the set the `\b` in
 * LOOSE_TEXT_ADDR is read against. charCodeAt off either end of the string gives NaN,
 * which compares false throughout, so out of range reads as the non-word the pattern
 * treats them as.
 */
function _isWordCode(code: number): boolean {
    return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

/**
 * Whether `\b` holds at an offset
 */
function _isBoundary(text: string, at: number): boolean {
    return _isWordCode(text.charCodeAt(at - 1)) !== _isWordCode(text.charCodeAt(at));
}

/**
 * Offset of the first '@' in `text` between `from` and `to`, or -1 when the range holds none.
 *
 * indexOf would scan on to the end of the value, and the value here is a whole header. The
 * walk below steps one whitespace delimited run at a time and only ever uses a '@' that sits
 * inside the run it is on, so an unbounded probe rescans everything behind that run once per
 * run and grows with the square of the header: 400KB of free text carrying no '@' took a
 * quarter of a second. GHSA-v53p-9fqp-m79j took the pattern search out of this walk and left
 * the probe unbounded behind it.
 *
 * @param text Text to look in
 * @param from Offset to start at
 * @param to Offset to stop before
 * @return Offset of the '@', or -1
 */
function _indexOfAt(text: string, from: number, to: number): number {
    for (let i = from; i < to; i++) {
        if (text.charCodeAt(i) === 0x40) {
            return i;
        }
    }

    return -1;
}

/**
 * A quoted-string a value opens with.
 */
const LEADING_QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"/;

/**
 * Drops the whitespace on either side of the '@' at an offset.
 *
 * obs-local-part and obs-domain allow CFWS around the '@' (RFC 5322 4.4), so 'user @ good.com'
 * names user@good.com. Kept, the whitespace went into the envelope as '"user "@ good.com'.
 * The scan is by index, a pattern such as /\s+@/ backtracks over a long whitespace run that
 * no '@' follows.
 *
 * @param value Value holding the '@'
 * @param at Offset of the '@', or -1
 * @return The value with the whitespace beside that '@' removed
 */
function _joinAtSpacing(value: string, at: number): string {
    if (at < 0) {
        return value;
    }

    let start = at;
    while (start > 0 && _isSpaceCode(value.charCodeAt(start - 1))) {
        start--;
    }
    let end = at + 1;
    while (end < value.length && _isSpaceCode(value.charCodeAt(end))) {
        end++;
    }

    return start === at && end === at + 1 ? value : value.slice(0, start) + '@' + value.slice(end);
}

/**
 * Drops the whitespace beside the '@' that splits the domain off a value. That is the '@'
 * right after a quoted local part the value opens with, or else the only '@' it holds outside
 * any quoted string. With several it is not clear which one the whitespace belongs to, and
 * '<x@evil.com @good.com>' is left to the addr-spec recovery to read as it always has.
 *
 * @param value Value to clean up
 * @return The value with the whitespace beside that '@' removed
 */
function _collapseAtSpacing(value: string): string {
    const quoted = LEADING_QUOTED_STRING.exec(value);
    if (quoted) {
        let at = quoted[0].length;
        while (at < value.length && _isSpaceCode(value.charCodeAt(at))) {
            at++;
        }
        if (value.charAt(at) === '@' && value.indexOf('@', at + 1) < 0) {
            return _joinAtSpacing(value, at);
        }
    }

    const at = value.indexOf('@');
    if (at < 0 || value.indexOf('@', at + 1) >= 0 || value.lastIndexOf('"') > at) {
        return value;
    }

    return _joinAtSpacing(value, at);
}

/**
 * Finds the offset LOOSE_TEXT_ADDR matches at, or -1 when it does not match at all.
 *
 * Letting the pattern search for itself is quadratic: '[^@\s]+' is retried from every
 * offset and rescans the run to the next '@' each time, so 140KB of header holding no
 * usable '@' blocks the event loop for about ten seconds (GHSA-v53p-9fqp-m79j). The search is also unnecessary.
 * '[^@\s]+' crosses neither whitespace nor a '@', so a match can only begin at the head of
 * a whitespace delimited run or just past a '@' inside one, and '[^\s]+\b' gives characters
 * back until it lands on a boundary, so the only end it can take in that run is the last
 * boundary in it. Both are found in one pass, and the pattern is then run at that single
 * offset.
 *
 * @param text Free text to look in
 * @return Offset to match at, or -1
 */
function _looseAddressStart(text: string): number {
    const len = text.length;
    let pos = 0;

    while (pos < len) {
        while (pos < len && _isSpaceCode(text.charCodeAt(pos))) {
            pos++;
        }
        if (pos >= len) {
            break;
        }

        const runStart = pos;
        let runEnd = pos;
        while (runEnd < len && !_isSpaceCode(text.charCodeAt(runEnd))) {
            runEnd++;
        }

        let at = _indexOfAt(text, runStart, runEnd);
        if (at >= 0) {
            let lastBoundary = -1;
            for (let k = runEnd; k > runStart; k--) {
                if (_isBoundary(text, k)) {
                    lastBoundary = k;
                    break;
                }
            }

            let atomStart = runStart;
            while (lastBoundary >= 0 && at >= 0) {
                // '[^@\s]+' has to cover a character before the '@' and '[^\s]+' one after it,
                // and the boundary that ends the match has to sit past both
                if (at > atomStart && runEnd > at + 1 && lastBoundary > at + 1) {
                    for (let start = atomStart; start < at; start++) {
                        if (_isBoundary(text, start)) {
                            if (start > runStart) {
                                return start;
                            }
                            // the leading '\s*' is greedy, so a match that begins at the run
                            // takes the whitespace in front of it along
                            let padded = runStart;
                            while (padded > 0 && _isSpaceCode(text.charCodeAt(padded - 1))) {
                                padded--;
                            }
                            return padded;
                        }
                    }
                }
                atomStart = at + 1;
                at = _indexOfAt(text, atomStart, runEnd);
            }
        }

        pos = runEnd;
    }

    return -1;
}

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
 * @param data Collected address parts, mutated in place
 */
function _recoverAddrSpec(data: { address: string; text: string }): void {
    data.address = _collapseAtSpacing(data.address);
    if (!HAS_WHITESPACE.test(data.address)) {
        return;
    }

    let address: string;
    let rest: string[];

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

        let addrIndex = parts.findIndex(_isAddrSpec);
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
 * Takes the RFC 5322 comments out of the contents of an angle-addr.
 *
 * The tokenizer tracks a single open operator, so once '<' is open a '(' is plain text and
 * a comment inside the brackets reached the address verbatim: 'Name <user@example.com(x)evil.com>'
 * put 'user@example.com(x)evil.com' into the envelope, a value that is no mailbox and that a
 * receiver stripping the comment reads as 'user@example.comevil.com' (GHSA-g73g-hqqh-jr95).
 * A comment is folding whitespace, so it is read as a space that splits two atoms and as
 * nothing next to an '@', the same rule the token walk applies outside the brackets. Quoted
 * strings and domain literals are copied through untouched, a '(' in there is not a comment.
 * An unexpected '<' outside them drops everything in front of it, comments included.
 *
 * RFC 822 also let an angle-addr name the relays to go through in front of the mailbox,
 * '<@relay1,@relay2:user@example.com>', which RFC 5322 still parses as obs-route. The route
 * is not part of the mailbox, and folded into the local part it made
 * '"@relay1,@relay2:user"@example.com' a recipient that does not exist. A local part can not
 * start with '@', so contents that do, up to the first ':' outside a domain literal and in
 * front of any quoted string, are a route and are dropped, as long as a mailbox with an '@'
 * of its own follows.
 *
 * @param address Contents of the angle brackets
 * @return The address with the comments removed, and the text of the comments
 */
function _stripAddressComments(address: string): { address: string; comments: string[] } {
    const comments: string[] = [];
    let result = '';
    let comment = '';
    let depth = 0;
    let closer = '';
    // carried along rather than read back off the growing result, which would flatten it on
    // every comment (see lastChars in _handleAddress)
    let lastChar = '';
    // A comment that just closed stands for a space, written once the next character shows
    // whether one is wanted: not beside an '@', and not on top of whitespace that follows.
    // Deciding on the spot saw only the character right after the ')', so a second comment
    // in a row hid the '@' behind it and 'a(x)(y)@b' read as 'a @b'
    let pendingSpace = false;
    // first character of the result and whether a quoted string has opened since, which
    // together tell a route from a local part
    let firstChar = '';
    let quoteSeen = false;
    let routeEnd = -1;

    for (let i = 0, len = address.length; i < len; i++) {
        const chr = address.charAt(i);

        if (depth) {
            if (chr === '\\' && i < len - 1) {
                comment += address.charAt(++i);
            } else if (chr === '(') {
                depth++;
                comment += chr;
            } else if (chr === ')' && !--depth) {
                comments.push(comment.trim());
                comment = '';
                pendingSpace = lastChar !== '@';
            } else {
                comment += chr;
            }
            continue;
        }

        if (pendingSpace && chr !== '(') {
            pendingSpace = false;
            if (chr !== '@' && chr !== '<' && !_isSpaceCode(address.charCodeAt(i))) {
                result += ' ';
                lastChar = ' ';
            }
        }

        if (closer) {
            if (chr === '\\' && closer === '"' && i < len - 1) {
                result += chr + address.charAt(++i);
                lastChar = address.charAt(i);
                continue;
            }
            if (chr === closer) {
                closer = '';
            }
        } else if (chr === '"') {
            closer = '"';
            quoteSeen = true;
        } else if (chr === ':' && routeEnd < 0 && firstChar === '@' && !quoteSeen) {
            routeEnd = result.length + 1;
        } else if (chr === '[') {
            closer = ']';
        } else if (chr === '(') {
            depth = 1;
            continue;
        } else if (chr === '<') {
            // Apple Mail drops everything between an unexpected '<' and the address after it.
            // Read here rather than off the raw brackets so that a '<' inside a quoted string,
            // a comment or a domain literal stays where it is: '<"a<b"@victim.com>' cut at
            // the first '<' left the address 'b"@victim.com'
            result = '';
            lastChar = '';
            comments.length = 0;
            firstChar = '';
            quoteSeen = false;
            routeEnd = -1;
            continue;
        }

        result += chr;
        lastChar = chr;
        if (!firstChar && !_isSpaceCode(address.charCodeAt(i))) {
            firstChar = chr;
        }
    }

    if (routeEnd >= 0 && result.indexOf('@', routeEnd) >= 0) {
        result = result.slice(routeEnd);
    }

    if (depth) {
        // an unterminated comment runs to the end of the address
        comments.push(comment.trim());
    }

    return { address: result.trim(), comments: comments.filter(text => text) };
}

/**
 * Walks the tokens of one entry of an address list and sorts them into the runs of display
 * text, angle-addr and comment they belong to
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token of the entry
 * @param to Index just past the last token of the entry
 * @return The collected runs, and whether the display text came out of a comment
 */
function _collectAddressParts(tokens: TokenList, from: number, to: number): { data: AddressParts; textFromComment: boolean } {
    let state: AddressPartsState = 'text';
    const data: AddressParts = {
        address: [],
        comment: [],
        text: [],
        textWasQuoted: [],
        quotedLocalAt: []
    };
    let insideQuotes = false;
    // whether the last text run holds nothing but quoted text so far, which is what a quoted
    // local part is until the '@' after it joins the run
    let lastTextPureQuoted = false;
    // Last character of the run each state is currently accumulating. Reading it back off
    // the accumulator with slice(-1) makes the engine flatten the whole growing string on
    // every token, which is quadratic over an address built from many comment-joined atoms
    // (GHSA-prgh-xp8r-p3m5). A run only ever grows by the token appended below, so the
    // character is carried along instead of re-read.
    const lastChars: Record<AddressPartsState, string> = { address: '', comment: '', text: '' };

    // Filter out <addresses>, (comments) and regular text
    for (let i = from; i < to; i++) {
        const value = tokens.value(i);
        // the operator in front of this token, if there is one, and whether it runs on into it
        const prevOperator = i > from ? tokens.operatorAt(i - 1) : '';
        const prevNoBreak = i > from && tokens.noBreak(i - 1);
        if (tokens.isOperator(i)) {
            switch (value) {
                case '<':
                    state = 'address';
                    insideQuotes = false;
                    break;
                case '(':
                    state = 'comment';
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
        } else {
            // An empty quoted string is dropped by the tokenizer, leaving no text token of its
            // own for textWasQuoted to be recorded on, so the pair of quote operators right in
            // front of this token is all that is left of it and the run it opens carries the
            // quoting instead. Without this '""@example.com' reads as the bare '@example.com',
            // the quotes never go back on, and the value is no longer an addr-spec a trailing
            // comment can be peeled off of. It only ever opens a run: a run that already holds
            // material collected outside the quotes is not a quoted string, whatever follows it
            const opensAfterEmptyQuotedString = prevOperator === '"' && prevNoBreak && i > from + 1 && tokens.operatorAt(i - 2) === '"';

            // A comment is folding whitespace. It may sit inside an addr-spec, on either side
            // of the '@', but it cannot join two atoms into one: gluing across it would read
            // 'user@example.com(x)evil.com' as the single domain 'example.comevil.com' and
            // deliver to a domain the sender never named.
            const parts = data[state];
            const joins = prevNoBreak && parts.length && (prevOperator !== ')' || lastChars[state] === '@' || value.charAt(0) === '@');

            if (joins) {
                const last = data[state].length - 1;
                if (state === 'text' && !insideQuotes) {
                    if (lastTextPureQuoted && value.charAt(0) === '@') {
                        data.quotedLocalAt[last] = data.text[last].length;
                    }
                    lastTextPureQuoted = false;
                }
                data[state][last] += value;
                lastChars[state] = value.charAt(value.length - 1);
                if (state === 'text' && insideQuotes) {
                    data.textWasQuoted[last] = true;
                }
            } else {
                data[state].push(value);
                lastChars[state] = value.charAt(value.length - 1);
                if (state === 'text') {
                    data.textWasQuoted.push(insideQuotes || opensAfterEmptyQuotedString);
                    // an empty quoted string leaves no text of its own, so the '@' opens the run
                    data.quotedLocalAt.push(opensAfterEmptyQuotedString && value.charAt(0) === '@' ? 0 : -1);
                    lastTextPureQuoted = insideQuotes;
                }
            }
        }
    }

    // If there is no text but a comment, replace the two. A comment is never part of a
    // mailbox, so text that came out of one only ever names it: reading an address out of it
    // made '(a@evil.com)' a recipient where no conformant reading has a mailbox at all
    let textFromComment = false;
    if (!data.text.length && data.comment.length) {
        data.text = data.comment;
        data.comment = [];
        textFromComment = true;
    }

    return { data, textFromComment };
}

/**
 * Name of a group, from the tokens in front of its ':'. A comment names it when no text does,
 * as it names a mailbox.
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token in front of the ':'
 * @param to Index of the ':'
 * @return Name of the group
 */
function _groupName(tokens: TokenList, from: number, to: number): string {
    // http://tools.ietf.org/html/rfc2822#appendix-A.1.3
    return _collectAddressParts(tokens, from, to).data.text.join(' ');
}

/**
 * Converts tokens for a single address into an address object
 *
 * @param tokens Tokens of the whole address list
 * @param from Index of the first token of this address
 * @param to Index just past the last token of this address
 * @return Address object
 */
function _handleAddress(tokens: TokenList, from: number, to: number): MailboxAddress {
    const collected = _collectAddressParts(tokens, from, to);
    const data = collected.data;
    let textFromComment = collected.textFromComment;

    // Comments come out of the angle-addr before anything asks whether one was found, so
    // that brackets holding nothing but a comment read the same as empty ones
    const addressComments: string[] = [];
    const addressParts: string[] = [];
    for (const part of data.address as string[]) {
        const stripped = _stripAddressComments(part);
        for (const comment of stripped.comments) {
            addressComments.push(comment);
        }
        if (stripped.address) {
            addressParts.push(stripped.address);
        }
    }
    data.address = addressParts;

    // If no address was found, try to detect one from regular text
    if (!data.address.length && data.text.length && !textFromComment) {
        // Whitespace beside the '@' is CFWS, so 'user @ good.com' is read as one run. Both
        // tiers read the collapsed runs, and only a run an address comes out of is replaced
        // by its collapsed form, the display text keeps its spacing
        const candidates: string[] = data.text.map((part: string) => _collapseAtSpacing(part));

        // The first addr-spec in the text is the mailbox, as it is for a conformant parser
        // reading as far as it can. Taking the last one let a comment part two of them and
        // pick the second, 'user@good.com (x) evil@evil.com' went to evil.com, while the
        // same two without the comment, one run, went to good.com
        for (let i = 0; i < data.text.length; i++) {
            // Security: Do not extract email addresses from quoted strings.
            // RFC 5321 allows @ inside quoted local-parts like "user@domain"@example.com.
            // Extracting emails from quoted text leads to misrouting vulnerabilities.
            // A run that is a quoted local part with its '@' and domain is an addr-spec of
            // its own, with the quoting put back on, and takes its turn like any other
            const local = data.quotedLocalAt[i];
            const quotedLocal = data.textWasQuoted[i] && local >= 0 && QUOTED_LOCAL_DOMAIN.test(data.text[i].slice(local)) ? _quoteLocalPart(data.text[i]) : '';
            if (quotedLocal || (!data.textWasQuoted[i] && _isAddrSpec(candidates[i]))) {
                data.address = [quotedLocal || candidates[i]];
                data.text.splice(i, 1);
                data.textWasQuoted.splice(i, 1);
                data.quotedLocalAt.splice(i, 1);
                break;
            }
        }

        // Try a looser regex match if strict match found nothing
        if (!data.address.length) {
            let extracted = false;
            for (let i = 0; i < data.text.length; i++) {
                // Security: Do not extract email addresses from quoted strings
                if (!data.textWasQuoted[i]) {
                    // the strict tier found nothing, so it spliced nothing and the indexes still line up
                    const part = candidates[i];
                    let remainder = data.text[i];

                    const at = _looseAddressStart(part);
                    if (at >= 0) {
                        LOOSE_TEXT_ADDR.lastIndex = at;
                        const match = LOOSE_TEXT_ADDR.exec(part);
                        if (match) {
                            data.address = [match[0].trim()];
                            extracted = true;
                            remainder = part.slice(0, at) + ' ' + part.slice(at + match[0].length);
                        }
                    }

                    data.text[i] = remainder.trim();
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

    if (addressFromQuotedText && data.text.indexOf('@') >= 0) {
        // A quoted run with no '@' in it is a display name and nothing else, so it stays
        // where it is. Moving it over anyway made a comment the mailbox was read from:
        // '"Display Name" <(a comment)>' handed on 'Display Name' as the address with the
        // comment as the name, and a quoted name holding a ',' or a ';' became an address
        // that reads as two recipients once a consumer writes it back into a header.
        //
        // The mailbox is still sitting in the text, so it moves over here and is quoted
        // before the recovery below rather than after it. Anything else the text holds
        // came along with it: a comment ends the domain but leaves the atoms behind it in
        // the same text, and '"user"@example.com(x)evil.com' was handed on as the address
        // 'user@example.com evil.com', a second domain riding into the envelope recipient
        // on a value that is no addr-spec at all (GHSA-g57g-f23g-4646). Putting the quotes
        // back first is what lets the recovery tell the whitespace an addr-spec may carry
        // from the wreckage trailing one, as only a quoted local part may hold whitespace
        // The quotes are gone at this point, so the '@' the domain splits off at is the
        // last one, not the single one _collapseAtSpacing insists on
        data.address = _quoteLocalPart(_joinAtSpacing(data.text, _domainAt(data.text)));
        data.text = '';
    }

    _recoverAddrSpec(data);

    // a comment names the mailbox only when nothing else does, as one outside the brackets
    if (!data.text && addressComments.length) {
        data.text = addressComments.join(' ');
        textFromComment = true;
    }

    const address: MailboxAddress = {
        address: data.address || (textFromComment ? '' : data.text) || '',
        name: data.text || data.address || ''
    };

    if (address.address === address.name) {
        if (/@/.test(address.address || '')) {
            address.name = '';
        } else {
            address.address = '';
        }
    }

    return address;
}

/* eslint-disable no-bitwise -- see TokenList */

/**
 * Creates a Tokenizer object for tokenizing address field strings
 *
 * @constructor
 * @param str Address field string
 */
class Tokenizer {
    str: string;
    operatorCurrent: string;
    operatorExpecting: string;
    /** Index of the text run being collected, -1 when none is */
    node: number;
    escaped: boolean;
    inDomainLiteral: boolean;
    /** The last addr-spec character seen was an "@", with only whitespace or comments since */
    afterAt: boolean;
    /** A group has opened and its ';' has not been seen yet */
    inGroup: boolean;
    /** A quoted string is open inside the angle-addr being collected */
    innerQuoted: boolean;
    /**
     * Comment depth inside the angle-addr being collected, or of the comments nested in the
     * comment being collected
     */
    innerComment: number;
    /** A domain literal is open inside the angle-addr being collected */
    innerLiteral: boolean;
    /** The previous character inside an inner quoted string or comment was a backslash */
    innerEscaped: boolean;
    list: TokenList;
    operators: { [operator: string]: string };

    constructor(str?: string | null) {
        this.str = (str || '').toString();
        this.operatorCurrent = '';
        this.operatorExpecting = '';
        this.node = -1;
        this.escaped = false;
        this.inDomainLiteral = false;
        this.afterAt = false;
        this.inGroup = false;
        this.innerQuoted = false;
        this.innerComment = 0;
        this.innerLiteral = false;
        this.innerEscaped = false;

        this.list = new TokenList(this.str);
        /**
         * Operator tokens and which tokens are expected to end the sequence
         */
        this.operators = {
            '"': '"',
            '(': ')',
            '<': '>',
            ',': '',
            // A group is read in the same pass as the rest of the list, so its ':' only marks
            // where the name ends and its members are tokenized like any other address
            ':': '',
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
     * @return An array of operator|text tokens
     */
    tokenize(): TokenList {
        const str = this.str;
        const len = str.length;
        for (let i = 0; i < len; i++) {
            this.checkChar(str.charAt(i), i);
        }
        this._closeText(len);

        // Compacted in place: a text run is trimmed to its value and one left empty is
        // dropped, and the value of a run that is no plain slice is rebuilt and kept aside
        const list = this.list;
        const slots = list.slots;
        let kept = 0;
        for (let i = 0, count = list.length; i < count; i++) {
            const kind = slots[i * 3];
            let start = slots[i * 3 + 1];
            let end = slots[i * 3 + 2];

            if (kind & TOKEN_DIRTY) {
                const value = this._cleanValue(start, end, kind).trim();
                if (!value) {
                    continue;
                }
                list.cleaned.set(kept, value);
            } else if (!(kind & TOKEN_OPERATOR)) {
                while (start < end && _isSpaceCode(str.charCodeAt(start))) {
                    start++;
                }
                while (end > start && _isSpaceCode(str.charCodeAt(end - 1))) {
                    end--;
                }
                if (start === end) {
                    continue;
                }
            }

            slots[kept * 3] = kind;
            slots[kept * 3 + 1] = start;
            slots[kept * 3 + 2] = end;
            kept++;
        }
        list.length = kept;

        return list;
    }

    /**
     * Ends the text run being collected, if there is one
     *
     * @param end Offset just past its last character
     */
    _closeText(end: number): void {
        if (this.node >= 0) {
            this.list.slots[this.node * 3 + 2] = end;
            this.node = -1;
        }
    }

    /**
     * Rebuilds the value of a text run that is no plain slice of the field, applying the
     * rules checkChar collects characters by: an escaping backslash is dropped, a line break
     * reads as a space and any other control character is left out
     *
     * @param start Offset of the first character of the run
     * @param end Offset just past its last character
     * @param kind Kind and flags of the run
     * @return Value of the run
     */
    _cleanValue(start: number, end: number, kind: number): string {
        const str = this.str;
        const escapes = (kind & TOKEN_ESCAPES) !== 0;
        let escaped = (kind & TOKEN_STARTS_ESCAPED) !== 0;
        let value = '';
        for (let i = start; i < end; i++) {
            const chr = str.charAt(i);
            if (escapes && !escaped && chr === '\\') {
                escaped = true;
                continue;
            }
            escaped = false;
            if (chr === '\n') {
                value += ' ';
            } else if (chr.charCodeAt(0) >= 0x21 || chr === ' ' || chr === '\t') {
                value += chr;
            }
        }
        return value;
    }

    /**
     * Checks if a character is an operator or text and acts accordingly
     *
     * @param chr Character from the address field
     * @param i Offset of the character in the field
     */
    checkChar(chr: string, i: number): void {
        // Track RFC 5322 domain-literals ("[" *dtext "]"). The ":" of an IPv6
        // address-literal (user@[IPv6:2001:db8::1]) is dtext and must not be treated as
        // the group delimiter while inside the brackets. That is the only operator the
        // literal hides: letting it hide the others as well meant a "[" could turn the
        // comment, quoted string or angle-addr after it into text and pick a different
        // mailbox, '[ ( ] <a@victim.com> ) <b@evil.com>' yielded a@victim.com where
        // RFC 5322 reads b@evil.com. A "[" also only opens a literal right after the "@"
        // of an addr-spec, so the group delimiter of a display name holding one stays
        // intact. Quoted strings and comments are handled separately via
        // operatorExpecting, so only enter this state when no operator is open. The list
        // separators "," and ";" always end the literal (and split the address list) so
        // that an unclosed "[" cannot swallow later recipients.
        if (!this.escaped && !this.operatorExpecting) {
            if (!this.inDomainLiteral && chr === '[' && this.afterAt) {
                this.inDomainLiteral = true;
            } else if (this.inDomainLiteral && (chr === ']' || chr === ',' || chr === ';')) {
                this.inDomainLiteral = false;
            }
        }

        // The closer of an angle-addr is only read outside the quoted strings, comments and
        // domain literals it holds. Looking for nothing but the closer let a '>' inside a
        // quoted local part end the angle-addr, '<"a@evil.com>"@good.com>' was read as an
        // address at evil.com. The characters are still collected as they are, the angle-addr
        // is read again later
        let nested = false;
        if (this.operatorExpecting === '>') {
            nested = this._trackInner(chr);
            if (!nested && chr === ';' && this.inGroup) {
                // The ';' of a group ends an angle-addr left open inside it, as it always did
                // when a group was cut out of the field at its ';' and parsed on its own. Read
                // as text instead, an unclosed '<' swallowed the end of the group and every
                // recipient after it
                this._closeText(i);
                this.operatorExpecting = '';
                this._resetInner();
            }
        } else if (this.operatorExpecting === ')' && !this.escaped) {
            // Comments nest (RFC 5322 3.2.2). Ending one at the first ')' let the ')' of a
            // nested comment close the outer one and released the rest of it, an address
            // included, into the header
            if (chr === '(') {
                this.innerComment++;
            } else if (chr === ')' && this.innerComment) {
                this.innerComment--;
                nested = true;
            }
        }

        if (this.escaped) {
            // ignore next condition blocks
        } else if (chr === this.operatorExpecting && !nested) {
            const nextChr = this.str.charAt(i + 1);
            this._closeText(i);
            this.list.push(nextChr && ![' ', '\t', '\r', '\n', ',', ';'].includes(nextChr) ? TOKEN_OPERATOR | TOKEN_NO_BREAK : TOKEN_OPERATOR, i, i + 1);
            if (chr !== ')') {
                // a comment is folding whitespace, it does not part the "@" from the "["
                this.afterAt = false;
            }
            this.operatorExpecting = '';
            this.escaped = false;
            this._resetInner();

            return;
        } else if (!this.operatorExpecting && !(this.inDomainLiteral && chr === ':') && chr in this.operators) {
            this._closeText(i);
            this.list.push(TOKEN_OPERATOR, i, i + 1);
            if (chr === ':') {
                this.inGroup = true;
            } else if (chr === ';') {
                this.inGroup = false;
            }
            if (chr !== '(') {
                this.afterAt = false;
            }
            this.operatorExpecting = this.operators[chr];
            this.escaped = false;
            this._resetInner();
            return;
        } else if (['"', "'", ')'].includes(this.operatorExpecting) && chr === '\\') {
            // A backslash escapes the next character inside a quoted string and inside a
            // comment alike (RFC 5322 3.2.2, ccontent includes quoted-pair). Honouring it
            // only in quoted strings let an escaped parenthesis close the comment, which
            // released the rest of it, an address included, into the header
            this.escaped = true;
            if (this.node >= 0) {
                // the backslash is left out of the value
                this.list.slots[this.node * 3] |= TOKEN_DIRTY;
            }
            return;
        }

        if (this.node < 0) {
            this.node = this.list.push(
                (this.operatorExpecting === '"' || this.operatorExpecting === ')' ? TOKEN_ESCAPES : 0) | (this.escaped ? TOKEN_STARTS_ESCAPED : 0),
                i,
                i
            );
        }

        if (chr === '\n') {
            // Convert newlines to spaces. Carriage return is ignored as \r and \n usually
            // go together anyway and there already is a WS for \n. Lone \r means something is fishy.
            chr = ' ';
            this.list.slots[this.node * 3] |= TOKEN_DIRTY;
        }

        if (chr.charCodeAt(0) >= 0x21 || chr === ' ' || chr === '\t') {
            // the character is part of the value, which is read off the field later
            // text inside a quoted string or a comment is not part of an addr-spec. Tracked
            // as it goes rather than read back off the value (see lastChars in _handleAddress)
            if (!this.operatorExpecting && chr !== ' ' && chr !== '\t') {
                this.afterAt = chr === '@';
            }
        } else {
            // skip command bytes
            this.list.slots[this.node * 3] |= TOKEN_DIRTY;
        }

        this.escaped = false;
    }

    /**
     * Tracks the quoted strings, comments and domain literals inside an angle-addr, which its
     * closer must not be read from. A backslash escapes the next character inside a quoted
     * string and a comment. A domain literal opens right after an "@" and ends at the "]".
     * dtext holds the list separators as well, and inside the brackets they never split the
     * list anyway.
     *
     * @param chr Character from the address field
     * @return true while the character sits inside one of them, the one that closes it included
     */
    _trackInner(chr: string): boolean {
        if (this.innerEscaped) {
            this.innerEscaped = false;
            return true;
        }
        if (this.innerQuoted) {
            if (chr === '\\') {
                this.innerEscaped = true;
            } else if (chr === '"') {
                this.innerQuoted = false;
            }
            return true;
        }
        if (this.innerComment) {
            if (chr === '\\') {
                this.innerEscaped = true;
            } else if (chr === '(') {
                this.innerComment++;
            } else if (chr === ')') {
                this.innerComment--;
            }
            return true;
        }
        if (this.innerLiteral) {
            if (chr === ']') {
                this.innerLiteral = false;
            }
            return true;
        }
        if (chr === '"') {
            this.innerQuoted = true;
            return true;
        }
        if (chr === '(') {
            this.innerComment = 1;
            return true;
        }
        if (chr === '[' && this.afterAt) {
            this.innerLiteral = true;
            return true;
        }
        // afterAt is otherwise only kept outside the operators and is cleared when one opens
        // or ends, so inside an angle-addr it serves the literal tracked here
        if (!_isSpaceCode(chr.charCodeAt(0))) {
            this.afterAt = chr === '@';
        }
        return false;
    }

    /**
     * Forgets the nesting collected for the operator that just opened or ended
     */
    _resetInner(): void {
        this.innerQuoted = false;
        this.innerComment = 0;
        this.innerLiteral = false;
        this.innerEscaped = false;
    }
}

/* eslint-enable no-bitwise */

/**
 * Folds the fragments an unquoted display name holding a comma is split into back together.
 *
 * "Joe Foo, PhD <joe@example.com>" is split on the comma into
 * [{name:"Joe Foo", address:""}, {name:"PhD", address:"joe@example.com"}]. A name-only entry
 * followed by an entry with both name and address is recombined. Walked back to front so
 * that a run of fragments folds into one entry in a single pass. Splicing each fragment out
 * of the list instead would cost O(n^2).
 *
 * @param list Parsed entries, in order
 * @return The entries with the fragments folded in
 */
function _mergeNameFragments<T extends Address>(list: T[]): T[] {
    const merged: T[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const current = list[i];
        const next = merged.length ? merged[merged.length - 1] : null;
        if (next && current.address === '' && current.name && !current.group && next.address && next.name) {
            next.name = current.name + ', ' + next.name;
        } else {
            merged.push(current);
        }
    }
    return merged.reverse();
}

/**
 * Parses an address list, groups included, in a single pass over its tokens.
 *
 * A group used to be cut out of the field at the ';' that ends it and parsed again as an
 * address list of its own, recursively, so every level of nesting parsed what was left of
 * the field once more and the depth had to be capped. RFC 5322 does not nest groups at all,
 * and the nested ones were flattened anyway. The tokens are now walked once: a ':' opens a
 * group, its members are read as they come, a ';' closes it. A ':' inside an open group
 * stands for a group nested in it, whose name is dropped and whose members belong to the
 * outer one, which is how they were flattened before. The first ';' ends the group, nested
 * or not, as it did.
 *
 * @param str Address field
 * @return An array of address objects
 */
function _parseAddressList(str: string | null | undefined): Address[] {
    const tokens = new Tokenizer(str).tokenize();

    const parsedAddresses: Address[] = [];
    let group: GroupAddress | null = null;
    let members: MailboxAddress[] = [];

    // Every address is handed over as the range of the token list it covers, as soon as the
    // separator after it is seen. Copying the tokens of each address into an array of its own,
    // and collecting those before handling any, held a second structure as large as the token
    // list for the whole parse, and an array that receives a single push is allocated room for
    // seventeen: a list of one letter names took some 80 times its size in that alone
    let from = 0;
    for (let i = 0, len = tokens.length; i <= len; i++) {
        const operator = i < len ? tokens.operatorAt(i) : '';
        if (i < len && operator !== ',' && operator !== ';' && operator !== ':') {
            continue;
        }

        if (operator === ':') {
            if (!group) {
                group = { name: _groupName(tokens, from, i), group: [] };
                members = [];
            }
            from = i + 1;
            continue;
        }

        if (i > from) {
            // Appended in place. Rebuilding the accumulator with concat() would copy every
            // entry collected so far on each address, making a flat list cost O(n^2).
            const address = _handleAddress(tokens, from, i);
            if (group) {
                members.push(address);
            } else {
                parsedAddresses.push(address);
            }
        }
        from = i + 1;

        if (group && (operator === ';' || i === len)) {
            group.group = _mergeNameFragments(members);
            parsedAddresses.push(group);
            group = null;
        }
    }

    return _mergeNameFragments(parsedAddresses);
}

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
 * @param str Address field
 * @param options Optional options object
 * @return An array of address objects
 */
function addressparser(str: string | null | undefined, options: AddressParserOptions & { flatten: true }): MailboxAddress[];
function addressparser(str?: string | null, options?: AddressParserOptions): Address[];
function addressparser(str?: string | null, options?: AddressParserOptions): Address[] {
    const parsedAddresses = _parseAddressList(str);

    if (options?.flatten) {
        const flatAddresses: MailboxAddress[] = [];
        const walkAddressList = (list: Address[]) => {
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

/**
 * Type aliases in the layout of @types/nodemailer, so `addressparser.Address` style references keep working
 */
// the namespace member can not refer to the module level type of the same name directly
type AddressEntry = Address;

declare namespace addressparser {
    export type Address = MailboxAddress;
    export type Group = GroupAddress;
    export type AddressOrGroup = AddressEntry;
}

/** The names @types/nodemailer used for the group entry and for the union of both entry types */
export type { GroupAddress as Group, Address as AddressOrGroup };

export default addressparser;
