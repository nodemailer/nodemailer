import Mail from './mailer/index.js';
import type { MailDefaults, SentMessageInfo, Transport, TransportOptions } from './mailer/index.js';
import * as shared from './shared/index.js';
import SMTPPool from './smtp-pool/index.js';
import type { SMTPPoolOptions, SMTPPoolSentMessageInfo } from './smtp-pool/index.js';
import SMTPTransport from './smtp-transport/index.js';
import type { SMTPTransportOptions, SMTPSentMessageInfo } from './smtp-transport/index.js';
import SendmailTransport from './sendmail-transport/index.js';
import type { SendmailTransportOptions, SendmailSentMessageInfo } from './sendmail-transport/index.js';
import StreamTransport from './stream-transport/index.js';
import type { StreamTransportOptions, StreamSentMessageInfo } from './stream-transport/index.js';
import JSONTransport from './json-transport/index.js';
import type { JSONTransportOptions, JSONSentMessageInfo, JSONSentMessageObjectInfo } from './json-transport/index.js';
import SESTransport from './ses-transport/index.js';
import type { SESTransportOptions, SESSentMessageInfo } from './ses-transport/index.js';
import * as errors from './errors.js';
import type { NodemailerError, ResultCallback } from './errors.js';
import nmfetch from './fetch/index.js';
import type { FetchOptions } from './fetch/index.js';
import * as packageData from './package-info.js';

// Read on use rather than at load, so that importing the module does not touch the
// environment (Deno refuses that without --allow-env, even for apps that never use Ethereal)
const etherealApi = () => (process.env.ETHEREAL_API || 'https://api.nodemailer.com').replace(/\/+$/, '');
const etherealWeb = () => (process.env.ETHEREAL_WEB || 'https://ethereal.email').replace(/\/+$/, '');
const etherealApiKey = () => (process.env.ETHEREAL_API_KEY || '').replace(/\s*/g, '') || null;
const etherealCache = () => ['true', 'yes', 'y', '1'].includes((process.env.ETHEREAL_CACHE || 'yes').toString().trim().toLowerCase());

/**
 * Connection details of a service endpoint of an Ethereal test account
 */
export interface TestAccountService {
    host: string;
    port: number;
    secure: boolean;
}

/**
 * Ethereal test account returned by createTestAccount()
 */
export interface TestAccount {
    user: string;
    pass: string;
    smtp: TestAccountService;
    imap: TestAccountService;
    pop3: TestAccountService;
    web: string;
    /** true if the account can also receive external mail */
    mxEnabled?: boolean | undefined;
    [key: string]: unknown;
}

/**
 * Callback for createTestAccount()
 */
export type TestAccountCallback = (err: Error | null, account: TestAccount) => void;

/**
 * Configuration object of any of the bundled transports
 */
export type TransportConfig =
    SMTPTransportOptions | SMTPPoolOptions | SendmailTransportOptions | StreamTransportOptions | JSONTransportOptions | SESTransportOptions;

let testAccount: TestAccount | false = false;

/**
 * Creates a transporter object for sending e-mails
 *
 * @param transporter Transport configuration object, a connection URL or a transport plugin instance
 * @param defaults Default message fields that are merged into every message
 * @returns Mail instance wrapping the transport
 */
export function createTransport(
    transporter: SMTPPool | (SMTPPoolOptions & { pool: true }),
    defaults?: MailDefaults
): Mail<SMTPPoolSentMessageInfo, SMTPPoolOptions>;
export function createTransport(
    transporter: SendmailTransport | (SendmailTransportOptions & { sendmail: true | string }),
    defaults?: MailDefaults
): Mail<SendmailSentMessageInfo, SendmailTransportOptions>;
export function createTransport(
    transporter: StreamTransport | (StreamTransportOptions & { streamTransport: true }),
    defaults?: MailDefaults
): Mail<StreamSentMessageInfo, StreamTransportOptions>;
export function createTransport(
    transporter: JSONTransportOptions & { jsonTransport: true; skipEncoding: true },
    defaults?: MailDefaults
): Mail<JSONSentMessageObjectInfo, JSONTransportOptions>;
export function createTransport(
    transporter: JSONTransport | (JSONTransportOptions & { jsonTransport: true }),
    defaults?: MailDefaults
): Mail<JSONSentMessageInfo, JSONTransportOptions>;
export function createTransport(
    transporter: SESTransport | (SESTransportOptions & { SES: object }),
    defaults?: MailDefaults
): Mail<SESSentMessageInfo, SESTransportOptions>;
export function createTransport(transporter: SMTPTransport, defaults?: MailDefaults): Mail<SMTPSentMessageInfo, SMTPTransportOptions>;
export function createTransport<T = SentMessageInfo, D extends TransportOptions = TransportOptions>(
    transporter: Transport<T, D>,
    defaults?: MailDefaults
): Mail<T, D>;
export function createTransport(
    transporter?: SMTPTransportOptions | string,
    defaults?: MailDefaults
): Mail<SMTPSentMessageInfo, SMTPTransportOptions>;
export function createTransport(transporter?: TransportConfig | Transport<any, any> | string, defaults?: MailDefaults): Mail<any, any>;
export function createTransport(transporter?: TransportConfig | Transport<any, any> | string, defaults?: MailDefaults): Mail<any, any> {
    let options: (TransportConfig & TransportOptions) | undefined;

    if (
        // provided transporter is a configuration object, not transporter plugin
        (typeof transporter === 'object' && typeof (transporter as Transport<any>).send !== 'function') ||
        // provided transporter looks like a connection url
        (typeof transporter === 'string' && /^(smtps?|direct):/i.test(transporter))
    ) {
        const urlConfig = typeof transporter === 'string' ? transporter : (transporter as SMTPTransportOptions).url;
        if (urlConfig) {
            // parse a configuration URL into configuration options. The other keys of a
            // configuration object apply where the url does not set them, merged the same
            // way the SMTP transports merge their own url option
            const parsed = shared.parseConnectionUrl(urlConfig);
            options = (
                typeof transporter === 'object'
                    ? shared.assign(
                          false,
                          shared.copyOwnKeys({}, transporter, key => key === 'url'),
                          parsed
                      )
                    : parsed
            ) as TransportConfig & TransportOptions;
        } else {
            options = transporter as TransportConfig & TransportOptions;
        }

        if ((options as SMTPPoolOptions).pool) {
            transporter = new SMTPPool(options as SMTPPoolOptions);
        } else if ((options as SendmailTransportOptions).sendmail) {
            transporter = new SendmailTransport(options as SendmailTransportOptions);
        } else if ((options as StreamTransportOptions).streamTransport) {
            transporter = new StreamTransport(options as StreamTransportOptions);
        } else if ((options as JSONTransportOptions).jsonTransport) {
            transporter = new JSONTransport(options as JSONTransportOptions);
        } else if ((options as SESTransportOptions).SES) {
            const ses = (options as SESTransportOptions).SES as { ses?: unknown; aws?: unknown };
            if (ses.ses && ses.aws) {
                const error: NodemailerError = new Error(
                    'Using legacy SES configuration, expecting @aws-sdk/client-sesv2, see https://nodemailer.com/transports/ses/'
                );
                error.code = errors.ECONFIG;
                throw error;
            }
            transporter = new SESTransport(options as SESTransportOptions);
        } else {
            transporter = new SMTPTransport(options as SMTPTransportOptions);
        }
    }

    return new Mail(transporter as Transport<any>, options, defaults);
}

/**
 * Creates a test account from the Ethereal service (https://ethereal.email)
 *
 * @param callback Callback function to run with the account object
 */
export function createTestAccount(callback: TestAccountCallback): void;
/**
 * Creates a test account from the Ethereal service (https://ethereal.email)
 *
 * @param apiUrl API endpoint, defaults to https://api.nodemailer.com
 * @param callback Callback function to run with the account object
 */
export function createTestAccount(apiUrl: string | false | null | undefined, callback: TestAccountCallback): void;
/**
 * Creates a test account from the Ethereal service (https://ethereal.email)
 *
 * @param [apiUrl] API endpoint, defaults to https://api.nodemailer.com
 * @returns Promise that resolves with the account object
 */
export function createTestAccount(apiUrl?: string | false | null): Promise<TestAccount>;
export function createTestAccount(
    apiUrl?: string | false | null | TestAccountCallback,
    callback?: TestAccountCallback
): Promise<TestAccount> | void {
    let promise: Promise<TestAccount> | undefined;

    if (!callback && typeof apiUrl === 'function') {
        callback = apiUrl;
        apiUrl = false;
    }

    if (!callback) {
        promise = new Promise((resolve, reject) => {
            callback = shared.callbackPromise(resolve, reject);
        });
    }
    const done = callback as ResultCallback<TestAccount>;

    if (etherealCache() && testAccount) {
        setImmediate(() => done(null, testAccount as TestAccount));
        return promise;
    }

    apiUrl = apiUrl || etherealApi();

    const chunks: Buffer[] = [];
    let chunklen = 0;

    const requestHeaders: Record<string, string> = {};
    const requestBody = {
        requestor: packageData.name,
        version: packageData.version
    };

    const apiKey = etherealApiKey();
    if (apiKey) {
        requestHeaders.Authorization = 'Bearer ' + apiKey;
    }

    const fetchOptions: FetchOptions = {
        contentType: 'application/json',
        method: 'POST',
        headers: requestHeaders,
        body: Buffer.from(JSON.stringify(requestBody))
    };

    // Credential-bearing request to the Ethereal API. src/fetch already
    // validates certs by default; pin rejectUnauthorized:true here so this
    // call stays strict regardless of any future default change and is never
    // relaxed for a real-cert endpoint.
    if (/^https:/i.test(apiUrl as string)) {
        fetchOptions.tls = { rejectUnauthorized: true };
    }

    const req = nmfetch(apiUrl + '/user', fetchOptions);

    req.on('readable', () => {
        let chunk: Buffer | null;
        while ((chunk = req.read()) !== null) {
            chunks.push(chunk);
            chunklen += chunk.length;
        }
    });

    req.once('error', err => done(err));

    req.once('end', () => {
        const res = Buffer.concat(chunks, chunklen);
        let data: any;
        try {
            data = JSON.parse(res.toString());
        } catch (E) {
            return done(E as Error);
        }
        if (data.status !== 'success' || data.error) {
            return done(new Error(data.error || 'Request failed'));
        }
        delete data.status;
        testAccount = data as TestAccount;
        done(null, testAccount);
    });

    return promise;
}

/**
 * Resolves the Ethereal web URL for a message sent through an Ethereal test account
 *
 * @param info Result object of sendMail()
 * @returns URL of the message in the Ethereal web interface, or false if the response does not carry one
 */
export function getTestMessageUrl(info?: { response?: string | Buffer | null | undefined } | false | null): string | false {
    if (!info || !info.response) {
        return false;
    }

    const infoProps = new Map<string, string>();

    // Extract the trailing "[...]" part of the response (no "]" allowed inside)
    // with linear string scanning; the equivalent regex /\[([^\]]+)\]$/ was
    // flagged for polynomial backtracking on adversarial server responses
    const response = info.response.toString();
    if (response.length > 2 && response.charAt(response.length - 1) === ']') {
        const open = response.indexOf('[', response.lastIndexOf(']', response.length - 2) + 1);
        if (open >= 0 && open < response.length - 2) {
            const props = response.substring(open + 1, response.length - 1);
            props.replace(/\b([A-Z0-9]+)=([^\s]+)/g, (m, key, value) => {
                infoProps.set(key, value);
                return m;
            });
        }
    }

    if (infoProps.has('STATUS') && infoProps.has('MSGID')) {
        return ((testAccount && testAccount.web) || etherealWeb()) + '/message/' + infoProps.get('MSGID');
    }

    return false;
}

const nodemailer = {
    createTransport,
    createTestAccount,
    getTestMessageUrl
};

export default nodemailer;

export type { Mail, MailDefaults, SentMessageInfo, Transport, TransportOptions };
export type { SendMailOptions, Transporter } from './mailer/index.js';
export type { NodemailerError, ErrorCode } from './errors.js';
export type { MailMessage, MailMessageData, PluginFunction, VerifyCallback } from './mailer/index.js';
export type {
    MailComposerOptions,
    MailComposerAttachment as Attachment,
    MailComposerAlternative as AttachmentLike,
    MailComposerIcalEvent as IcalAttachment,
    MailComposerListHeaders as ListHeaders
} from './mail-composer/index.js';
export type { MimeNodeAddress as Address, MimeNodeHeaders as Headers } from './mime-node/index.js';
export type { SMTPConnectionOptions, SMTPConnectionAuth, SMTPEnvelope, SMTPEnvelopeDsn } from './smtp-connection/index.js';
export type { DKIMOptions } from './dkim/index.js';
export type { XOAuth2Options, XOAuth2Token } from './xoauth2/index.js';
export type { SMTPTransportOptions, SMTPSentMessageInfo };
export type { SMTPPoolOptions, SMTPPoolSentMessageInfo };
export type { SendmailTransportOptions, SendmailSentMessageInfo };
export type { StreamTransportOptions, StreamSentMessageInfo };
export type { JSONTransportOptions, JSONSentMessageInfo, JSONSentMessageObjectInfo };
export type { SESTransportOptions, SESSentMessageInfo };
