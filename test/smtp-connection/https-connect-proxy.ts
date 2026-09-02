import https from 'node:https';
import net from 'node:net';

/**
 * Minimal HTTPS CONNECT proxy for the proxy tests: tunnels every CONNECT request to the
 * host and port it names. Listens on `listenPort`, 0 picks an ephemeral port
 */
export function createHttpsProxy(
    httpsOptions: https.ServerOptions,
    listenPort: number,
    callback: (proxyServer: https.Server, port: number) => void
): void {
    const proxyServer = https.createServer(httpsOptions);
    proxyServer.on('connect', (req: any, clientSocket, head) => {
        const parts = req.url.split(':');
        const port = Number(parts.pop());
        const host = parts.join(':') || '127.0.0.1';
        const serverSocket = net.connect(port, host, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) {
                serverSocket.write(head);
            }
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });
        serverSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => serverSocket.destroy());
    });
    proxyServer.listen(listenPort, '127.0.0.1', () => callback(proxyServer, (proxyServer.address() as net.AddressInfo).port));
}
