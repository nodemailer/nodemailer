// Mock server for serving Oauth2 tokens

import http from 'node:http';
import crypto from 'node:crypto';
import querystring from 'node:querystring';

export interface OAuthServerOptions {
    port?: number;
    expiresIn?: number;
    onUpdate?: (username: string, accessToken: string) => void;
}

export interface OAuthTokenResponse {
    error?: string;
    access_token?: string;
    expires_in?: number;
    token_type?: string;
}

export class OAuthServer {
    options: OAuthServerOptions;
    users: { [username: string]: any };
    tokens: { [refreshToken: string]: string };
    server!: http.Server;

    constructor(options?: OAuthServerOptions) {
        this.options = options || {};
        this.users = {};
        this.tokens = {};

        this.options.port = Number(this.options.port) || 3080;
        this.options.expiresIn = Number(this.options.expiresIn) || 3600;
    }

    addUser(username: string, refreshToken?: string): OAuthTokenResponse {
        let user = {
            username,
            refreshToken: refreshToken || crypto.randomBytes(10).toString('base64')
        };

        this.users[username] = user;
        this.tokens[user.refreshToken] = username;

        return this.generateAccessToken(user.refreshToken);
    }

    generateAccessToken(refreshToken: string): OAuthTokenResponse {
        let username = this.tokens[refreshToken];
        let accessToken = crypto.randomBytes(10).toString('base64');

        if (!username) {
            return {
                error: 'Invalid refresh token'
            };
        }

        this.users[username].accessToken = accessToken;
        this.users[username].expiresIn = (Date.now as any) + (this.options.expiresIn as number) * 1000;

        if (this.options.onUpdate) {
            this.options.onUpdate(username, accessToken);
        }

        return {
            access_token: accessToken,
            expires_in: this.options.expiresIn,
            token_type: 'Bearer'
        };
    }

    validateAccessToken(username: string, accessToken: string): boolean {
        if (!this.users[username] || this.users[username].accessToken !== accessToken || this.users[username].expiresIn < Date.now()) {
            return false;
        } else {
            return true;
        }
    }

    start(callback: () => void): void {
        this.server = http.createServer((req, res) => {
            let data: Buffer[] = [];
            let datalen = 0;

            req.on('data', chunk => {
                if (!chunk || !chunk.length) {
                    return;
                }

                data.push(chunk);
                datalen += chunk.length;
            });

            req.once('end', () => {
                let query = querystring.parse(Buffer.concat(data, datalen).toString()),
                    response = this.generateAccessToken(query.refresh_token as string);

                res.writeHead(!response.error ? 200 : 401, {
                    'Content-Type': 'application/json'
                });

                res.end(JSON.stringify(response));
            });
        });

        this.server.listen(this.options.port, callback);
    }

    stop(callback: (err?: Error) => void): void {
        this.server.close(callback);
    }
}

export default function (options?: OAuthServerOptions): OAuthServer {
    return new OAuthServer(options);
}
