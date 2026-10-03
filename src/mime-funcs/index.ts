/* eslint no-control-regex:0 */

import * as base64 from '../base64/index.js';
import * as qp from '../qp/index.js';
import * as mimeTypes from './mime-types.js';
import { isProtoKey } from '../shared/objects.js';

/**
 * A header value split into the value token and its parameters, the result of parseHeaderValue
 */
export interface ParsedHeaderValue {
    /** The value ahead of the parameters, for example the content type, an empty string when there is none */
    value: string;
    /** Parameter values keyed by lowercase parameter name */
    params: Record<string, string>;
}

/**
 * Header value structure accepted by buildHeaderValue
 */
export interface StructuredHeaderValue {
    /** The value ahead of the parameters, for example the content type */
    value: string | false;
    /** Parameter values keyed by parameter name */
    params?: Record<string, string> | undefined;
}

/**
 * A single key=value pair of an rfc2231 encoded header parameter
 */
export interface EncodedHeaderParam {
    /** Parameter name with the continuation suffix, for example title*0* */
    key: string;
    /** Parameter value of this part */
    value: string;
}

/** The names @types/nodemailer used for the two types above */
export type HeaderValue = StructuredHeaderValue;
export type ParsedHeaderParam = EncodedHeaderParam;

/**
 * One section of an rfc2231 parameter value continuation, as collected by parseHeaderValue
 */
interface ContinuationSection {
    /** Section number, 0 when the parameter name carries none */
    nr: number;
    /** Section value, with the charset prefix of section 0 taken off */
    value: string;
    /** The parameter name ended in '*', so the value is percent encoded */
    encoded: boolean;
}

/**
 * The sections collected for a single rfc2231 parameter value continuation
 */
interface ContinuationParam {
    /** Charset named by the prefix of the encoded section 0, false when there is none */
    charset: string | false;
    sections: ContinuationSection[];
}

/**
 * Checks if a value is plaintext string (uses only printable 7bit chars)
 *
 * When isParam is set the value is destined for a header parameter, so HT, CR and LF
 * are not plaintext either: a header parameter has no way to carry them. HT is a valid
 * fold point, so folding and unfolding a header would rewrite it as a space, and CR/LF
 * cannot appear in a header value at all. DEL is neither a token character nor qtext,
 * so it can not be carried bare or quoted. Such values have to go through the rfc2231
 * parameter continuation encoding instead, the same way a quote already does.
 *
 * @param value String to be tested
 * @param [isParam] Set to true if the value is a header parameter value
 * @returns true if it is a plaintext string
 */
export function isPlainText(value: unknown, isParam?: boolean): boolean {
    const re = isParam ? /[\x00-\x1f\x7f"\u0080-\uFFFF]/ : /[\x00-\x08\x0b\x0c\x0e-\x1f\u0080-\uFFFF]/;
    return typeof value === 'string' && !re.test(value);
}

/**
 * Wraps a value into a quoted-string. Inside one a quote would end the string early
 * and a backslash would escape whatever follows it, so both go out as quoted-pairs.
 *
 * @param value String to be quoted
 * @returns The value as a quoted-string, quotes included
 */
export function quoteString(value?: string): string {
    return '"' + (value || '').toString().replace(/["\\]/g, '\\$&') + '"';
}

/**
 * Checks if a multi line string containes lines longer than the selected value.
 *
 * Useful when detecting if a mail message needs any processing at all:
 * if only plaintext characters are used and lines are short, then there is
 * no need to encode the values in any way. If the value is plaintext but has
 * longer lines then allowed, then use format=flowed
 *
 * @param str Multi line string to check
 * @param lineLength Max line length to check for
 * @returns Returns true if there is at least one line longer than lineLength chars
 */
export function hasLongerLines(str: string, lineLength: number): boolean {
    if (str.length > 128 * 1024) {
        // do not test strings longer than 128kB
        return true;
    }
    return new RegExp('^.{' + (lineLength + 1) + ',}', 'm').test(str);
}

/**
 * Encodes a string or an Buffer to an UTF-8 MIME Word (rfc2047)
 *
 * @param data String to be encoded
 * @param mimeWordEncoding='Q' Encoding for the mime word, either Q or B
 * @param [maxLength=0] If set, split mime words into several chunks if needed
 * @return Single or several mime words joined together
 */
export function encodeWord(data: string | Buffer, mimeWordEncoding?: string, maxLength?: number): string {
    mimeWordEncoding = (mimeWordEncoding || 'Q').toString().toUpperCase().trim().charAt(0);
    maxLength = maxLength || 0;

    let encodedStr!: string;
    const toCharset = 'UTF-8';

    if (maxLength && maxLength > 7 + toCharset.length) {
        maxLength -= 7 + toCharset.length;
    }

    if (mimeWordEncoding === 'Q') {
        // https://tools.ietf.org/html/rfc2047#section-5 rule (3)
        encodedStr = qp.encode(data).replace(/[^a-z0-9!*+\-/=]/gi, chr => {
            const ord = chr.charCodeAt(0).toString(16).toUpperCase();
            if (chr === ' ') {
                return '_';
            }
            return '=' + (ord.length === 1 ? '0' + ord : ord);
        });
    } else if (mimeWordEncoding === 'B') {
        // the chunking loop below splits raw text and base64 encodes each part, so a
        // Buffer goes in as its UTF-8 string: handing it the base64 of the whole input
        // would encode the encoding itself and decode back to base64 text
        encodedStr = typeof data === 'string' ? data : data.toString('utf-8');
        maxLength = maxLength ? Math.max(3, ((maxLength - (maxLength % 4)) / 4) * 3) : 0;
    }

    if (maxLength && (mimeWordEncoding !== 'B' ? encodedStr : base64.encode(data)).length > maxLength) {
        if (mimeWordEncoding === 'Q') {
            encodedStr = splitMimeEncodedString(encodedStr, maxLength).join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
        } else {
            // RFC2047 6.3 (2) states that encoded-word must include an integral number of characters, so no chopping unicode sequences
            const parts: string[] = [];
            let lpart = '';
            for (let i = 0, len = encodedStr.length; i < len; i++) {
                let chr = encodedStr.charAt(i);

                if (/[\ud800-\udbff]/.test(chr) && /[\udc00-\udfff]/.test(encodedStr.charAt(i + 1))) {
                    // leading surrogate, so add the trailing surrogate as well
                    // an unpaired one must not swallow the next unit, that would destroy
                    // a valid pair following it
                    chr += encodedStr.charAt(++i);
                }

                // check if we can add this character to the existing string
                // without breaking byte length limit
                if (Buffer.byteLength(lpart + chr) <= maxLength || i === 0) {
                    lpart += chr;
                } else {
                    // we hit the length limit, so push the existing string and start over
                    parts.push(base64.encode(lpart));
                    lpart = chr;
                }
            }
            if (lpart) {
                parts.push(base64.encode(lpart));
            }

            if (parts.length > 1) {
                encodedStr = parts.join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
            } else {
                encodedStr = parts.join('');
            }
        }
    } else if (mimeWordEncoding === 'B') {
        encodedStr = base64.encode(data);
    }

    return '=?' + toCharset + '?' + mimeWordEncoding + '?' + encodedStr + (encodedStr.substr(-2) === '?=' ? '' : '?=');
}

/**
 * Finds word sequences with non ascii text and converts these to mime words
 *
 * @param value String to be encoded
 * @param mimeWordEncoding='Q' Encoding for the mime word, either Q or B
 * @param [maxLength=0] If set, split mime words into several chunks if needed
 * @param [encodeAll=false] If true and the value needs encoding then encodes entire string, not just the smallest match
 * @return String with possible mime words
 */
export function encodeWords(value: string, mimeWordEncoding?: string, maxLength?: number, encodeAll?: boolean): string {
    maxLength = maxLength || 0;

    // find first word with a non-printable ascii or special symbol in it
    const firstMatch = value.match(/(?:^|\s)([^\s]*["\u0080-\uFFFF])/);
    if (!firstMatch) {
        return value;
    }

    if (encodeAll) {
        // if it is requested to encode everything or the string contains something that resebles encoded word, then encode everything
        return encodeWord(value, mimeWordEncoding, maxLength);
    }

    // find the last word with a non-printable ascii in it
    const lastMatch = value.match(/(["\u0080-\uFFFF][^\s]*)[^"\u0080-\uFFFF]*$/);
    if (!lastMatch) {
        // should not happen
        return value;
    }

    const startIndex =
        (firstMatch.index as number) +
        ((
            firstMatch[0].match(/[^\s]/) || {
                index: 0
            }
        ).index as number);
    const endIndex = (lastMatch.index as number) + (lastMatch[1] || '').length;

    return (
        (startIndex ? value.substr(0, startIndex) : '') +
        encodeWord(value.substring(startIndex, endIndex), mimeWordEncoding || 'Q', maxLength) +
        (endIndex < value.length ? value.substr(endIndex) : '')
    );
}

/**
 * Joins parsed header value together as 'value; param1=value1; param2=value2'
 * PS: We are following RFC 822 for the list of special characters that we need to keep in quotes.
 *      Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
 * @param structured Parsed header value
 * @return joined header value
 */
export function buildHeaderValue(structured: StructuredHeaderValue): string {
    const paramsArray: string[] = [];

    Object.keys(structured.params || {}).forEach(key => {
        // filename might include unicode characters so it is a special case
        // other values probably do not
        const value = (structured.params as Record<string, string>)[key];
        // a parameter name is a token too and it is emitted without any quoting around it
        const param = key.replace(/[\x00-\x1f\x7f]/g, '');
        if (!isPlainText(value, true) || value.length >= 75) {
            buildHeaderParam(param, value, 50).forEach(encodedParam => {
                if (!/[\s"\\;:/=(),<>@[\]?]|^[-']|'$/.test(encodedParam.value) || encodedParam.key.substr(-1) === '*') {
                    paramsArray.push(encodedParam.key + '=' + encodedParam.value);
                } else {
                    paramsArray.push(encodedParam.key + '=' + JSON.stringify(encodedParam.value));
                }
            });
        } else if (!value.length || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(value)) {
            // a parameter value is a token or a quoted-string and a token is never empty, so
            // a valueless parameter such as the 'flag' of 'multipart/mixed; flag; boundary=b'
            // goes out as 'flag=""' rather than as the 'flag=' that parses as neither
            paramsArray.push(param + '=' + JSON.stringify(value));
        } else {
            paramsArray.push(param + '=' + value);
        }
    });

    // the value ahead of the parameters is a token, it has no way to carry a control
    // char or DEL and there is no quoting construct around it to escape one into
    const value = typeof structured.value === 'string' ? structured.value.replace(/[\x00-\x1f\x7f]/g, '') : structured.value;

    return value + (paramsArray.length ? '; ' + paramsArray.join('; ') : '');
}

/**
 * Encodes a string or an Buffer to an UTF-8 Parameter Value Continuation encoding (rfc2231)
 * Useful for splitting long parameter values.
 *
 * For example
 *      title="unicode string"
 * becomes
 *     title*0*=utf-8''unicode
 *     title*1*=%20string
 *
 * @param key Parameter name the generated keys are built from, for example title
 * @param data String to be encoded
 * @param [maxLength=50] Max length for generated chunks
 * @return A list of encoded keys and headers
 */
export function buildHeaderParam(key: string, data: string | Buffer, maxLength?: number): EncodedHeaderParam[] {
    const list: { line: string; encoded?: boolean }[] = [];
    let encodedStr: string | string[] = typeof data === 'string' ? data : (data || '').toString();
    let chr: string;
    let line: string;
    let startPos = 0;
    let i: number, len: number;

    maxLength = maxLength || 50;

    // process ascii only text
    if (isPlainText(data, true)) {
        // check if conversion is even needed
        if (encodedStr.length <= maxLength) {
            return [
                {
                    key,
                    value: encodedStr
                }
            ];
        }

        encodedStr = encodedStr.replace(new RegExp('.{' + maxLength + '}', 'g'), str => {
            list.push({
                line: str
            });
            return '';
        });

        if (encodedStr) {
            list.push({
                line: encodedStr
            });
        }
    } else {
        if (/[\uD800-\uDBFF]/.test(encodedStr)) {
            // string containts surrogate pairs, so normalize it to an array of bytes
            const encodedStrArr: string[] = [];
            for (i = 0, len = encodedStr.length; i < len; i++) {
                chr = encodedStr.charAt(i);
                if (/[\ud800-\udbff]/.test(chr) && /[\udc00-\udfff]/.test(encodedStr.charAt(i + 1))) {
                    // an unpaired leading surrogate must not consume the next unit, that
                    // would tear apart a valid pair following it
                    chr += encodedStr.charAt(i + 1);
                    encodedStrArr.push(chr);
                    i++;
                } else {
                    encodedStrArr.push(chr);
                }
            }
            encodedStr = encodedStrArr;
        }

        // first line includes the charset and language info and needs to be encoded
        // even if it does not contain any unicode characters
        line = "utf-8''";
        let encoded = true;
        startPos = 0;

        // process text with unicode or special chars
        for (i = 0, len = encodedStr.length; i < len; i++) {
            chr = encodedStr[i];

            if (encoded) {
                chr = safeEncodeURIComponent(chr);
            } else {
                // try to urlencode current char
                chr = chr === ' ' ? chr : safeEncodeURIComponent(chr);
                // By default it is not required to encode a line, the need
                // only appears when the string contains unicode or special chars
                // in this case we start processing the line over and encode all chars
                if (chr !== encodedStr[i]) {
                    // Check if it is even possible to add the encoded char to the line
                    // If not, there is no reason to use this line, just push it to the list
                    // and start a new line with the char that needs encoding
                    if ((safeEncodeURIComponent(line) + chr).length >= maxLength) {
                        list.push({
                            line,
                            encoded
                        });
                        // the line we start here holds an encoded char, so it has to be
                        // flagged as one. otherwise it gets an unstarred continuation key
                        // and a receiver reads the percent escapes as literal text
                        line = '';
                        encoded = true;
                    } else {
                        encoded = true;
                        i = startPos;
                        line = '';
                        continue;
                    }
                }
            }

            // if the line is already too long, push it to the list and start a new one
            if ((line + chr).length >= maxLength) {
                list.push({
                    line,
                    encoded
                });
                line = chr = encodedStr[i] === ' ' ? ' ' : safeEncodeURIComponent(encodedStr[i]);
                if (chr === encodedStr[i]) {
                    encoded = false;
                    startPos = i - 1;
                } else {
                    encoded = true;
                }
            } else {
                line += chr;
            }
        }

        if (line) {
            list.push({
                line,
                encoded
            });
        }
    }

    return list.map((item, i) => ({
        // encoded lines: {name}*{part}*
        // unencoded lines: {name}*{part}
        // if any line needs to be encoded then the first line (part==0) is always encoded
        key: key + '*' + i + (item.encoded ? '*' : ''),
        value: item.line
    }));
}

/**
 * An RFC 2045 token: printable ASCII without SPACE, the control characters, DEL and the
 * tspecials. A charset name is one, and the name a continuation carries is written into
 * the encoded word the parameter value becomes, so it is checked against this before it
 * goes in. Whitespace used to come off it only because the value was trimmed first.
 */
const TOKEN = /^[^\x00-\x20\x7f()<>@,;:\\"/[\]?=]+$/;

/**
 * Whether a string can be a header parameter name.
 *
 * A parameter name is a token, so it is never empty. A "__proto__" name would target the
 * prototype chain of the params object instead of an own property of it and read back as
 * Object.prototype, so it is no name either.
 *
 * @param name Candidate parameter name, already lowercased
 * @return true when the name can be used
 */
function _isParamName(name: string): boolean {
    return !!name && !isProtoKey(name);
}

/**
 * Parses a header value with key=value arguments into a structured
 * object.
 *
 *   parseHeaderValue('content-type: text/plain; CHARSET='UTF-8'') ->
 *   {
 *     'value': 'text/plain',
 *     'params': {
 *       'charset': 'UTF-8'
 *     }
 *   }
 *
 * @param str Header value
 * @return Header value as a parsed structure
 */
export function parseHeaderValue(str: string): ParsedHeaderValue {
    const response: ParsedHeaderValue = {
        value: '',
        params: {}
    };

    // A duplicated parameter resolves to its first occurrence, the way a duplicated header
    // does. Letting the last one win disagrees with the receivers that take the first, and
    // the two readings of 'boundary="b"; boundary="c"' name different delimiters. The
    // continuation join below is the only writer of the name it builds, so it tests the
    // name with _isParamName directly rather than taking that rule along from here.
    const setParam = (name: string, value: string) => {
        name = name.toLowerCase();
        if (_isParamName(name) && !Object.prototype.hasOwnProperty.call(response.params, name)) {
            response.params[name] = value;
        }
    };

    let key: string | false = false;
    let value = '';
    let stage: 'key' | 'value' = 'value';
    let quote: string | false = false;
    let escaped = false;
    let chr: string;

    // Whitespace seen outside a quoted string is held back until a significant character
    // follows it, so the whitespace around a value is dropped without trimming spaces the
    // sender quoted on purpose. Trimming the stored value instead loses the trailing space
    // of 'filename*0="Annual Report "', which the next continuation section is appended to.
    let pendingSpace = '';
    let quoteClosed = false;

    // Whitespace ahead of the first character of a value is padding and is dropped, the
    // whitespace between two characters of it is content
    const flushSpace = () => {
        if (value.length) {
            value += pendingSpace;
        }
        pendingSpace = '';
    };

    const addChr = (c: string) => {
        flushSpace();
        value += c;
    };

    const takeValue = () => {
        const taken = value;
        value = '';
        pendingSpace = '';
        quoteClosed = false;
        return taken;
    };

    const storeValue = () => {
        const taken = takeValue();
        if (key === false) {
            response.value = taken;
        } else {
            setParam(key, taken);
        }
    };

    // A parameter name with no '=' is a valueless parameter, not the start of the next one.
    // Without this the name keeps growing across the ';' and swallows whatever follows, which
    // is how 'multipart/mixed; flag; boundary="AAA"' lost its boundary to a parameter named
    // 'flag; boundary' and left the node declaring the generated boundary beside the asked
    // for one, so a receiver reading the first of the two found no delimiter it matched.
    const storeEmptyKey = () => {
        setParam(takeValue().trim(), '');
    };

    for (let i = 0, len = str.length; i < len; i++) {
        chr = str.charAt(i);
        if (stage === 'key') {
            if (chr === '=') {
                key = takeValue().trim();
                stage = 'value';
                continue;
            }
            if (chr === ';') {
                storeEmptyKey();
                continue;
            }
            value += chr;
        } else {
            if (quoteClosed && chr !== ';') {
                // Nothing behind a closed quoted string reaches the value. RFC 2045 says a
                // parameter value is a token or a quoted string and not both, so what follows
                // one is junk and only the ';' that ends the parameter still counts. Tested
                // ahead of the branches rather than beside the append at the foot of them,
                // where each branch above was a way around it: a second '"' reopened quoting
                // and swallowed the rest of the header, so 'boundary="AAA" "; boundary=BBB"'
                // read as a single boundary of 'AAA ', and the junk of
                // 'boundary="AAA" (unterminated comment' still joined the declared boundary
                // through the escape branch. quoteClosed is only ever set while no quote is
                // open, and this is what keeps one from being opened afterwards.
                escaped = false;
                continue;
            }

            if (escaped) {
                addChr(chr);
            } else if (quote && chr === '\\') {
                // a backslash only escapes inside a quoted string, everywhere else it is an
                // ordinary character. Treating it as an escape turns the parameter value
                // 'C:\Users\me\report.txt' into 'C:Usersmereport.txt'
                escaped = true;
                continue;
            } else if (quote && chr === quote) {
                quote = false;
                quoteClosed = true;
            } else if (!quote && chr === '"') {
                quote = chr;
                flushSpace();
            } else if (!quote && chr === ';') {
                storeValue();
                stage = 'key';
            } else if (!quote && (chr === ' ' || chr === '\t')) {
                pendingSpace += chr;
            } else {
                addChr(chr);
            }
            escaped = false;
        }
    }

    if (stage === 'value') {
        storeValue();
    } else {
        // a key with no value, as in 'Header-Key: somevalue; key=value; emptykey'
        storeEmptyKey();
    }

    // handle parameter value continuations
    // https://tools.ietf.org/html/rfc2231#section-3

    // Sections are collected in a list and ordered below rather than written into an array
    // at their own section number. An index write makes the array as long as the number the
    // header asked for, and the join that follows walks all of it, so the 55 byte value
    // "attachment; filename*0*=utf-8''a; filename*4000000000=b" held a core for over two
    // minutes.
    const continuations = new Map<string, ContinuationParam>();

    Object.keys(response.params).forEach(key => {
        const match = key.match(/(\*(\d+)|\*(\d+)\*|\*)$/);
        if (!match) {
            // not a continuation parameter, there is nothing to join
            return;
        }

        const actualKey = key.substr(0, match.index);
        const nr = Number(match[2] || match[3]) || 0;
        // RFC 2231 section 4.1: only a section whose name ends in '*' is percent encoded
        const encoded = match[0].substr(-1) === '*';

        // remove the old reference
        let value = response.params[key];
        delete response.params[key];

        if (!_isParamName(actualKey)) {
            // the joined value can not be written back under this name. It is empty when the
            // continuation suffix was all there was of it, as in the bare '*' of 'text/plain; a;*'
            return;
        }

        let continuation = continuations.get(actualKey);
        if (!continuation) {
            continuation = { charset: false, sections: [] };
            continuations.set(actualKey, continuation);
        }

        const charsetMatch = nr === 0 && encoded ? value.match(/^([^']*)'[^']*'(.*)$/) : null;
        if (charsetMatch) {
            // the charset is a token, and anything else named as one is no charset a consumer
            // could resolve, so it reads as the unnamed case rather than being carried into
            // the encoded word below. A "\r\n" of a prefix would otherwise reach a consumer
            // of the parsed value as the charset of a word that no decoder can act on
            continuation.charset = TOKEN.test(charsetMatch[1]) ? charsetMatch[1] : 'iso-8859-1';
            value = charsetMatch[2];
        }

        continuation.sections.push({ nr, value, encoded });
    });

    // concatenate split rfc2231 strings and convert encoded strings to mime encoded words
    continuations.forEach((continuation, key) => {
        if (Object.prototype.hasOwnProperty.call(response.params, key)) {
            // The same name was also given as a plain parameter, which the starred keys were
            // just deleted from around, so this write would be the only one in the function
            // to override a name already taken. 'filename=plain.txt; filename*0=evil.txt'
            // resolves to the plain parameter either way round, so the reading does not come
            // down to which of the two spellings the sender put first
            return;
        }

        continuation.sections.sort((a, b) => a.nr - b.nr);

        if (!continuation.charset) {
            // nothing said which charset the percent escapes of an encoded section are in,
            // so every section is passed on as the text it already is
            response.params[key] = continuation.sections.map(section => section.value).join('');
            return;
        }

        // convert "%AB" to "=?charset?Q?=AB?="
        response.params[key] = '=?' + continuation.charset + '?Q?' + continuation.sections.map(_encodeContinuationSection).join('') + '?=';
    });

    return response;
}

/**
 * Renders one parameter value continuation section as the payload of a Q encoded word.
 *
 * A section whose name ends in '*' is percent encoded and its escapes carry the bytes of
 * the value, so they only have to be rewritten into the "=AB" spelling a Q encoded word
 * uses. A section without the '*' is literal text (RFC 2231 section 4.1), so its '%' is a
 * '%' and is escaped along with the characters a Q encoded word can not carry bare.
 * Decoding a literal section invents bytes that never appeared on the wire: it is how the
 * value 'filename*0*=utf-8''safe; filename*1=%2F..%2F..%2Fetc%2Fpasswd' was emitted as a
 * filename every receiving client reads back as 'safe/../../etc/passwd'.
 *
 * @param section One collected continuation section
 * @return The section as Q encoded word payload
 */
function _encodeContinuationSection(section: ContinuationSection): string {
    const specials = section.encoded ? /[=?_\s]/g : /[=?_\s%]/g;

    return (
        section.value
            // fix invalidly encoded chars
            .replace(specials, s => {
                const c = s.charCodeAt(0).toString(16);
                if (s === ' ') {
                    return '_';
                }
                return '%' + (c.length < 2 ? '0' : '') + c;
            })
            // change from urlencoding to percent encoding
            .replace(/%/g, '=')
    );
}

/**
 * Returns file extension for a content type string. If no suitable extensions
 * are found, 'bin' is used as the default extension
 *
 * @param mimeType Content type to be checked for
 * @return File extension
 */
export function detectExtension(mimeType?: string | false): string {
    return mimeTypes.detectExtension(mimeType);
}

/**
 * Returns content type for a file extension. If no suitable content types
 * are found, 'application/octet-stream' is used as the default content type
 *
 * @param extension Extension to be checked for
 * @return File extension
 */
export function detectMimeType(extension?: string | false): string {
    return mimeTypes.detectMimeType(extension);
}

/**
 * Folds long lines, useful for folding header lines (afterSpace=false) and
 * flowed text (afterSpace=true)
 *
 * @param str String to be folded
 * @param [lineLength=76] Maximum length of a line
 * @param afterSpace If true, leave a space in th end of a line
 * @return String with folded lines
 */
export function foldLines(str: string, lineLength?: number, afterSpace?: boolean): string {
    str = (str || '').toString();
    lineLength = lineLength || 76;

    let pos = 0;
    const len = str.length;
    let result = '';
    let line: string, match: RegExpMatchArray | null;

    while (pos < len) {
        line = str.substr(pos, lineLength);
        if (line.length < lineLength) {
            result += line;
            break;
        }
        if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
            line = match[0];
            result += line;
            pos += line.length;
            continue;
        } else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length) {
            line = line.substr(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
        } else if ((match = str.substr(pos + line.length).match(/^[^\s]+(\s*)/))) {
            line = line + match[0].substr(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
        }

        result += line;
        pos += line.length;
        if (pos < len) {
            result += '\r\n';
        }
    }

    return result;
}

/**
 * Splits a mime encoded string. Needed for dividing mime words into smaller chunks
 *
 * @param str Mime encoded string to be split up
 * @param maxlen Maximum length of characters for one part (minimum 12)
 * @return Split string
 */
export function splitMimeEncodedString(str: string, maxlen?: number): string[] {
    const lines: string[] = [];
    let curLine: string, fallbackLine: string, match: RegExpMatchArray | null, chr: number, done: boolean;

    // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
    maxlen = Math.max(maxlen || 0, 12);

    while (str.length) {
        curLine = str.substr(0, maxlen);

        // move incomplete escaped char back to main
        if ((match = curLine.match(/[=][0-9A-F]?$/i))) {
            curLine = curLine.substr(0, match.index);
        }

        // Malformed input (a run of stray UTF-8 continuation bytes) has no split point
        // that keeps a character sequence whole, so the loop below walks back to an
        // empty line looking for one. Keep the widest chunk that at least does not cut
        // a "=XX" escape in half, so the part stays a decodable encoded word.
        fallbackLine = curLine.length ? curLine : str.substr(0, maxlen);

        done = false;
        while (!done && curLine.length) {
            done = true;
            // check if not middle of a unicode char sequence
            if ((match = str.substr(curLine.length).match(/^[=]([0-9A-F]{2})/i))) {
                chr = parseInt(match[1], 16);
                // invalid sequence, move one char back anc recheck
                if (chr < 0xc2 && chr > 0x7f) {
                    curLine = curLine.substr(0, curLine.length - 3);
                    done = false;
                }
            }
        }

        if (!curLine.length) {
            curLine = fallbackLine;
        }

        lines.push(curLine);
        str = str.substr(curLine.length);
    }

    return lines;
}

export function encodeURICharComponent(chr: string): string {
    let res = '';
    let ord = chr.charCodeAt(0).toString(16).toUpperCase();

    if (ord.length % 2) {
        ord = '0' + ord;
    }

    if (ord.length > 2) {
        for (let i = 0, len = ord.length / 2; i < len; i++) {
            res += '%' + ord.substr(i, 2);
        }
    } else {
        res += '%' + ord;
    }

    return res;
}

export function safeEncodeURIComponent(str: string): string {
    str = (str || '').toString();

    try {
        // might throw if we try to encode invalid sequences, eg. partial emoji
        str = encodeURIComponent(str);
    } catch (_E) {
        // an unpaired surrogate has no utf-8 representation, so run the value through a
        // utf-8 roundtrip to get the same U+FFFD every other encoder here produces and
        // retry. the value must never come back unencoded, it goes into a header parameter
        // where a bare quote or semicolon would break it out into a parameter of its own
        str = encodeURIComponent(Buffer.from(str, 'utf-8').toString('utf-8'));
    }

    // ensure chars that are not handled by encodeURICompent are converted as well
    return str.replace(/[\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]/g, chr => encodeURICharComponent(chr));
}
