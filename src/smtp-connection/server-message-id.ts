/**
 * Reads the Message-ID a receiving server gave the message out of its final 250 reply. Some
 * servers replace the Message-ID header of a submitted message with one of their own, and
 * the copy the recipients and the sent folder get carries that one instead of the id the
 * message was built with. Only replies in a format known to carry such an id are read.
 */

// Microsoft 365 and Outlook.com: "250 2.0.0 OK <id@host.prod.outlook.com> [Hostname=...]"
const OUTLOOK_REPLY = /^250 2\.0\.0 OK (<[^<>\s]+\.prod\.outlook\.com>)/i;

// Amazon SES: "250 Ok 0100018b5c3c0a4f-...-000000", the local part of the Message-ID it sets
const SES_REPLY = /^250 Ok ([0-9a-f]+(?:-[0-9a-f]+)+)$/i;

// an AWS region name such as us-east-1 or ap-southeast-2
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

/**
 * Finds the AWS region an SES SMTP endpoint is in from its hostname, such as
 * email-smtp.eu-west-1.amazonaws.com or a VPC endpoint name under it
 *
 * @param host SMTP hostname
 * @returns Region name, or undefined for a host outside amazonaws.com and awsapps.com
 */
function sesRegion(host: string): string | undefined {
    const labels = host.toLowerCase().replace(/\.$/, '').split('.');
    const domain = labels.slice(-2).join('.');
    if (domain !== 'amazonaws.com' && domain !== 'awsapps.com') {
        return undefined;
    }
    return labels.slice(0, -2).find(label => AWS_REGION.test(label));
}

/**
 * Reads the server assigned Message-ID out of the final reply to a message
 *
 * @param response Final server reply for the message
 * @param [host] Hostname the connection was made to, SES replies are only read for an SES host
 * @returns The Message-ID with its angle brackets, or undefined when the reply names none
 */
export function parseServerMessageId(response: string | undefined, host?: string): string | undefined {
    const reply = (response || '').toString().trim();

    const outlook = reply.match(OUTLOOK_REPLY);
    if (outlook) {
        return outlook[1];
    }

    const ses = reply.match(SES_REPLY);
    if (ses && host) {
        const region = sesRegion(host);
        if (region) {
            // the SES Message-ID domain is email.amazonses.com in us-east-1 and the region elsewhere
            return '<' + ses[1].toLowerCase() + '@' + (region === 'us-east-1' ? 'email' : region) + '.amazonses.com>';
        }
    }

    return undefined;
}
