import * as punycode from '../punycode/index.js';
import * as mimeFuncs from '../mime-funcs/index.js';
import crypto from 'node:crypto';
import type { MessageParserHeaderLine } from './message-parser.js';

/**
 * Private key accepted by crypto.Sign#sign: a PEM string, a Buffer, a KeyObject or an
 * object with the key and its passphrase
 */
export type DKIMPrivateKey = crypto.KeyLike | crypto.SignKeyObjectInput | crypto.SignPrivateKeyInput;

/**
 * Options for the DKIM signature header generator
 */
export interface DKIMKey {
    /** Domain name to be signed for */
    domainName?: string;
    /** DKIM key selector to use */
    keySelector?: string;
    /** DKIM private key to use */
    privateKey?: DKIMPrivateKey;
}

export interface DKIMSignOptions extends DKIMKey {
    /** Colon separated list of header field names to sign, defaults to the RFC4871 list */
    headerFieldNames?: string;
    /** Colon separated list of header field names to leave out of the signature */
    skipFields?: string;
}

/**
 * Canonicalized headers and the list of field names that went into them
 */
export interface DKIMRelaxedHeaders {
    /** Relaxed header lines, each terminated with CRLF */
    headers: string;
    /** Colon separated list of the field names that were included */
    fieldNames: string;
}

/**
 * Returns DKIM signature header line
 *
 * @param headers Parsed headers object from MessageParser
 * @param bodyHash Base64 encoded hash of the message
 * @param options DKIM options
 * @param options.domainName Domain name to be signed for
 * @param options.keySelector DKIM key selector to use
 * @param options.privateKey DKIM private key to use
 * @return Complete header line
 */

function sign(headers: MessageParserHeaderLine[], hashAlgo: string, bodyHash: string, options?: DKIMSignOptions): string | false {
    options = options || {};

    // all listed fields from RFC4871 #5.5
    const defaultFieldNames =
        'From:Sender:Reply-To:Subject:Date:Message-ID:To:' +
        'Cc:MIME-Version:Content-Type:Content-Transfer-Encoding:Content-ID:' +
        'Content-Description:Resent-Date:Resent-From:Resent-Sender:' +
        'Resent-To:Resent-Cc:Resent-Message-ID:In-Reply-To:References:' +
        'List-Id:List-Help:List-Unsubscribe:List-Subscribe:List-Post:' +
        'List-Owner:List-Archive';

    const fieldNames = options.headerFieldNames || defaultFieldNames;

    const canonicalizedHeaderData = relaxedHeaders(headers, fieldNames, options.skipFields);
    const dkimHeader = generateDKIMHeader(options.domainName, options.keySelector, canonicalizedHeaderData.fieldNames, hashAlgo, bodyHash);

    canonicalizedHeaderData.headers += 'dkim-signature:' + relaxedHeaderLine(dkimHeader);

    const signer = crypto.createSign(('rsa-' + hashAlgo).toUpperCase());
    signer.update(canonicalizedHeaderData.headers);
    let signature: string;
    try {
        signature = signer.sign(options.privateKey as DKIMPrivateKey, 'base64');
    } catch (_E) {
        return false;
    }

    return dkimHeader + signature.replace(/(^.{73}|.{75}(?!\r?\n|\r))/g, '$&\r\n ').trim();
}

sign.relaxedHeaders = relaxedHeaders;

export default sign;

function generateDKIMHeader(
    domainName: string | undefined,
    keySelector: string | undefined,
    fieldNames: string,
    hashAlgo: string,
    bodyHash: string
): string {
    // the caller supplied tag values are interpolated straight into the tag list, and none of
    // them has any way to carry a control char, DEL, or one of the delimiters that would close
    // the value and open a tag of its own
    const cleanTagValue = (value: string | undefined) => (value || '').toString().replace(/[\x00-\x1f\x7f;=]/g, '');

    const dkim = [
        'v=1',
        'a=rsa-' + hashAlgo,
        'c=relaxed/relaxed',
        'd=' + punycode.toASCII(cleanTagValue(domainName)),
        'q=dns/txt',
        's=' + cleanTagValue(keySelector),
        'bh=' + bodyHash,
        'h=' + cleanTagValue(fieldNames)
    ].join('; ');

    return mimeFuncs.foldLines('DKIM-Signature: ' + dkim, 76) + ';\r\n b=';
}

function relaxedHeaders(headers: MessageParserHeaderLine[], fieldNames?: string, skipFields?: string): DKIMRelaxedHeaders {
    const includedFields = new Set<string>();
    const skip = new Set<string>();
    const headerFields = new Map<string, string>();

    (skipFields || '')
        .toLowerCase()
        .split(':')
        .forEach(field => {
            skip.add(field.trim());
        });

    (fieldNames || '')
        .toLowerCase()
        .split(':')
        .filter(field => !skip.has(field.trim()))
        .forEach(field => {
            includedFields.add(field.trim());
        });

    for (let i = headers.length - 1; i >= 0; i--) {
        const line = headers[i];
        // only include the first value from bottom to top
        if (includedFields.has(line.key) && !headerFields.has(line.key)) {
            headerFields.set(line.key, relaxedHeaderLine(line.line));
        }
    }

    const headersList: string[] = [];
    const fields: string[] = [];
    includedFields.forEach(field => {
        if (headerFields.has(field)) {
            fields.push(field);
            headersList.push(field + ':' + headerFields.get(field));
        }
    });

    return {
        headers: headersList.join('\r\n') + '\r\n',
        fieldNames: fields.join(':')
    };
}

function relaxedHeaderLine(line: string): string {
    return line
        .substr(line.indexOf(':') + 1)
        .replace(/\r?\n/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
