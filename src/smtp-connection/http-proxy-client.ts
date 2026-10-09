/**
 * Minimal HTTP/S proxy client
 */

import net from 'node:net';
import tls from 'node:tls';
import * as urllib from '../shared/url.js';
import * as errors from '../errors.js';
import type { Callback, NodemailerError, ResultCallback } from '../errors.js';

// Cap the CONNECT response we buffer before the header terminator, so a proxy that
// never sends \r\n\r\n cannot grow memory unboundedly before the socket times out.
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;

// URL hostnames keep the brackets around an IPv6 literal, socket options and net.isIPv6 take it without
const unbracket = (host: string): string =>
    typeof host === 'string' && host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

/**
 * TLS options for connecting to an HTTPS proxy
 */
export interface HttpProxyClientOptions {
    /** Set to false to accept a proxy certificate that fails validation (e.g. self-signed) */
    rejectUnauthorized?: boolean | undefined;
    /** Time in milliseconds the CONNECT handshake may take, defaults to httpProxyClient.timeout or 30 seconds */
    timeout?: number | undefined;
}

/**
 * Receives the proxied socket once the CONNECT handshake has succeeded, or the error that prevented it
 */
export type HttpProxyClientCallback = Callback<net.Socket>;

/**
 * Establishes proxied connection to destinationPort
 *
 * httpProxyClient("http://localhost:3128/", 80, "google.com", function(err, socket){
 *     socket.write("GET / HTTP/1.0\r\n\r\n");
 * });
 *
 * @param proxyUrl proxy configuration, e.g. "http://proxy.host:3128/"
 * @param destinationPort Port to open in destination host
 * @param destinationHost Destination hostname
 * @param callback Callback to run with the socket object once connection is established
 */
function httpProxyClient(
    proxyUrl: string,
    destinationPort: number | string,
    destinationHost: string,
    callback: HttpProxyClientCallback
): void;
/**
 * Establishes proxied connection to destinationPort through an HTTPS proxy
 *
 * @param proxyUrl proxy configuration, e.g. "https://proxy.host:3128/"
 * @param destinationPort Port to open in destination host
 * @param destinationHost Destination hostname
 * @param tlsOptions TLS options for the proxy connection (e.g. { rejectUnauthorized: false })
 * @param callback Callback to run with the socket object once connection is established
 */
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
    // the error paths hand over the error alone
    const done = callback as ResultCallback<net.Socket>;

    // Reject CRLF in the destination before it reaches the CONNECT request line
    // and Host header. A tainted host/port could otherwise inject additional
    // request headers into the proxy connection (HTTP request splitting).
    destinationPort = Number(destinationPort) || 0;
    if (!destinationPort || /[\r\n]/.test(destinationHost)) {
        const err: NodemailerError = new Error('Invalid proxy destination');
        err.code = errors.EPROXY;
        setImmediate(() => done(err));
        return;
    }

    const proxy = urllib.parse(proxyUrl);
    // the CONNECT request line and the Host header take an IPv6 destination in brackets
    const authority =
        (net.isIPv6(unbracket(destinationHost)) ? '[' + unbracket(destinationHost) + ']' : destinationHost) + ':' + destinationPort;

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

    // The handshake is bounded as a whole, a proxy that keeps sending a byte now and then can
    // not hold the connection open past it
    const timeout = Number(tlsOptions.timeout) || httpProxyClient.timeout || 30 * 1000;

    let socket: net.Socket;

    // Single settlement path for the handshake: every temporary listener and the timer are
    // dropped exactly once. Once the tunnel is up, the responsibility to handle errors is passed
    // to whoever uses this socket
    let finished = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('data', onSocketData);
        socket.removeListener('error', fail);
        socket.removeListener('close', onEarlyClose);
    };

    function fail(err: Error): void {
        if (finished) {
            return;
        }
        finished = true;
        cleanup();
        try {
            socket.destroy();
        } catch (_E) {
            // ignore
        }
        done(err);
    }

    function onEarlyClose(): void {
        const err: NodemailerError = new Error('Proxy closed the connection before the tunnel was established');
        err.code = errors.EPROXY;
        fail(err);
    }

    // The response is collected as chunks and only the bytes that just arrived, together
    // with the three before them, are searched for the end of the headers. Appending to a
    // string and searching all of it again re-read the whole response on every chunk.
    const chunks: Buffer[] = [];
    let received = 0;
    let tail = '';
    function onSocketData(chunk: Buffer): void {
        if (finished) {
            return;
        }

        const window = tail + chunk.toString('binary');
        const windowEnd = window.indexOf('\r\n\r\n');
        chunks.push(chunk);
        received += chunk.length;
        tail = window.slice(-3);

        if (windowEnd < 0) {
            if (received > MAX_RESPONSE_HEADER_BYTES) {
                const err: NodemailerError = new Error('Proxy response headers too large');
                err.code = errors.EPROXY;
                fail(err);
            }
            return;
        }

        // Stop reading before anything is put back. A socket that keeps flowing would emit the
        // bytes after the headers, a greeting the proxy sent together with its own response,
        // before the next owner of the socket has a listener for them
        socket.removeListener('data', onSocketData);
        socket.pause();

        const headerEnd = received - window.length + windowEnd;
        const response = Buffer.concat(chunks, received);
        if (response.length > headerEnd + 4) {
            socket.unshift(response.subarray(headerEnd + 4));
        }

        // check response code
        const match = response.toString('binary', 0, headerEnd).match(/^HTTP\/\d+\.\d+ (\d+)/i);
        if (!match || (match[1] || '').charAt(0) !== '2') {
            const err: NodemailerError = new Error('Invalid response from proxy' + ((match && ': ' + match[1]) || ''));
            err.code = errors.EPROXY;
            return fail(err);
        }

        // proxy connection is now established
        finished = true;
        cleanup();

        // A fresh socket starts flowing once something listens for 'data', a paused one would
        // not. Keep that behaviour for the next owner of the socket
        const resumeOnData = (event: string | symbol) => {
            if (event === 'data') {
                socket.removeListener('newListener', resumeOnData);
                socket.resume();
            }
        };
        socket.on('newListener', resumeOnData);

        return done(null, socket);
    }

    socket = connect(connectOptions, () => {
        if (finished) {
            return;
        }

        const reqHeaders: Record<string, string> = {
            Host: authority,
            Connection: 'close'
        };
        if (proxy.auth) {
            reqHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(proxy.auth).toString('base64');
        }

        socket.write(
            // HTTP method
            'CONNECT ' +
                authority +
                ' HTTP/1.1\r\n' +
                // HTTP request headers
                Object.keys(reqHeaders)
                    .map(key => key + ': ' + reqHeaders[key])
                    .join('\r\n') +
                // End request
                '\r\n\r\n'
        );

        socket.on('data', onSocketData);
    });

    timer = setTimeout(() => {
        const err: NodemailerError = new Error('Proxy socket timed out');
        err.code = errors.ETIMEDOUT;
        fail(err);
    }, timeout);

    socket.once('error', fail);
    socket.once('close', onEarlyClose);
}

/**
 * Time in milliseconds the CONNECT handshake may take when the call does not set one, defaults to 30 seconds.
 * Settable on the function itself, the same way the CommonJS module exposed it.
 */
declare namespace httpProxyClient {
    let timeout: number | undefined;
}

export default httpProxyClient;
