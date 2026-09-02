/**
 * Minimal HTTP/S proxy client
 */

import net from 'node:net';
import tls from 'node:tls';
import * as urllib from '../shared/url.js';
import * as errors from '../errors.js';
import type { NodemailerError } from '../errors.js';

// Cap the CONNECT response we buffer before the header terminator, so a proxy that
// never sends \r\n\r\n cannot grow memory unboundedly before the socket times out.
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;

/**
 * TLS options for connecting to an HTTPS proxy
 */
export interface HttpProxyClientOptions {
    /** Set to false to accept a proxy certificate that fails validation (e.g. self-signed) */
    rejectUnauthorized?: boolean;
}

/**
 * Receives the proxied socket once the CONNECT handshake has succeeded, or the error that prevented it
 */
export type HttpProxyClientCallback = (err: NodemailerError | null, socket?: net.Socket) => void;

/**
 * Establishes proxied connection to destinationPort
 *
 * httpProxyClient("http://localhost:3128/", 80, "google.com", function(err, socket){
 *     socket.write("GET / HTTP/1.0\r\n\r\n");
 * });
 *
 * @param proxyUrl proxy configuration, etg "http://proxy.host:3128/"
 * @param destinationPort Port to open in destination host
 * @param destinationHost Destination hostname
 * @param [tlsOptions] Optional TLS options for an HTTPS proxy (e.g. { rejectUnauthorized: false })
 * @param callback Callback to run with the rocket object once connection is established
 */
function httpProxyClient(
    proxyUrl: string,
    destinationPort: number | string,
    destinationHost: string,
    callback: HttpProxyClientCallback
): void;
function httpProxyClient(
    proxyUrl: string,
    destinationPort: number | string,
    destinationHost: string,
    tlsOptions: HttpProxyClientOptions | undefined,
    callback: HttpProxyClientCallback
): void;
function httpProxyClient(
    proxyUrl: string,
    destinationPort: number | string,
    destinationHost: string,
    tlsOptions?: HttpProxyClientOptions | HttpProxyClientCallback,
    callback?: HttpProxyClientCallback
): void {
    if (typeof tlsOptions === 'function') {
        callback = tlsOptions;
        tlsOptions = {};
    }
    tlsOptions = tlsOptions || {};

    // Reject CRLF in the destination before it reaches the CONNECT request line
    // and Host header. A tainted host/port could otherwise inject additional
    // request headers into the proxy connection (HTTP request splitting).
    destinationPort = Number(destinationPort) || 0;
    if (!destinationPort || /[\r\n]/.test(destinationHost)) {
        const err: NodemailerError = new Error('Invalid proxy destination');
        err.code = errors.EPROXY;
        setImmediate(() => callback!(err));
        return;
    }

    const proxy = urllib.parse(proxyUrl);

    const connectOptions: tls.ConnectionOptions & net.TcpNetConnectOpts = {
        host: proxy.hostname as string,
        port: Number(proxy.port) ? Number(proxy.port) : proxy.protocol === 'https:' ? 443 : 80
    };

    let connect: (options: typeof connectOptions, listener: () => void) => net.Socket;
    if (proxy.protocol === 'https:') {
        // Validate the proxy's TLS certificate by default. A caller that uses a
        // self-signed proxy (e.g. integration tests) opts out explicitly with
        // tls.rejectUnauthorized === false.
        connectOptions.rejectUnauthorized = tlsOptions.rejectUnauthorized !== false;
        connect = tls.connect.bind(tls);
    } else {
        connect = net.connect.bind(net);
    }

    let socket: net.Socket;

    // Error harness for initial connection. Once connection is established, the responsibility
    // to handle errors is passed to whoever uses this socket
    let finished = false;
    const tempSocketErr = (err: Error) => {
        if (finished) {
            return;
        }
        finished = true;
        try {
            socket.destroy();
        } catch (_E) {
            // ignore
        }
        callback!(err);
    };

    const timeoutErr = () => {
        const err: NodemailerError = new Error('Proxy socket timed out');
        err.code = 'ETIMEDOUT';
        tempSocketErr(err);
    };

    socket = connect(connectOptions, () => {
        if (finished) {
            return;
        }

        const reqHeaders: Record<string, string> = {
            Host: destinationHost + ':' + destinationPort,
            Connection: 'close'
        };
        if (proxy.auth) {
            reqHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(proxy.auth).toString('base64');
        }

        socket.write(
            // HTTP method
            'CONNECT ' +
                destinationHost +
                ':' +
                destinationPort +
                ' HTTP/1.1\r\n' +
                // HTTP request headers
                Object.keys(reqHeaders)
                    .map(key => key + ': ' + reqHeaders[key])
                    .join('\r\n') +
                // End request
                '\r\n\r\n'
        );

        let headers = '';
        const onSocketData = (chunk: Buffer) => {
            let match: RegExpMatchArray | null;
            let remainder: string;

            if (finished) {
                return;
            }

            headers += chunk.toString('binary');
            if ((match = headers.match(/\r\n\r\n/))) {
                socket.removeListener('data', onSocketData);

                remainder = headers.substr(match.index! + match[0].length);
                headers = headers.substr(0, match.index);
                if (remainder) {
                    socket.unshift(Buffer.from(remainder, 'binary'));
                }

                // proxy connection is now established
                finished = true;

                // check response code
                match = headers.match(/^HTTP\/\d+\.\d+ (\d+)/i);
                if (!match || (match[1] || '').charAt(0) !== '2') {
                    try {
                        socket.destroy();
                    } catch (_E) {
                        // ignore
                    }
                    const err: NodemailerError = new Error('Invalid response from proxy' + ((match && ': ' + match[1]) || ''));
                    err.code = errors.EPROXY;
                    return callback!(err);
                }

                socket.removeListener('error', tempSocketErr);
                socket.removeListener('timeout', timeoutErr);
                socket.setTimeout(0);

                return callback!(null, socket);
            }

            if (headers.length > MAX_RESPONSE_HEADER_BYTES) {
                socket.removeListener('data', onSocketData);
                const err: NodemailerError = new Error('Proxy response headers too large');
                err.code = errors.EPROXY;
                return tempSocketErr(err);
            }
        };
        socket.on('data', onSocketData);
    });

    socket.setTimeout(httpProxyClient.timeout || 30 * 1000);
    socket.on('timeout', timeoutErr);

    socket.once('error', tempSocketErr);
}

/**
 * Socket timeout in milliseconds while the CONNECT handshake is in progress, defaults to 30 seconds.
 * Settable on the function itself, the same way the CommonJS module exposed it.
 */
declare namespace httpProxyClient {
    let timeout: number | undefined;
}

export default httpProxyClient;
