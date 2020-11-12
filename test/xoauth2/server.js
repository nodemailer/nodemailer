'use strict';

// Mock server for serving Oauth2 tokens

const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');

module.exports = function (options) {
    return new OAuthServer(options);
};

function OAuthServer(options) {
    this.options = options || {};
    this.users = {};
    this.tokens = {};

    this.options.port = Number(this.options.port) || 3080;
    this.options.expiresIn = Number(this.options.expiresIn) || 3600;
}

OAuthServer.prototype.addUser = function (username, refreshToken) {
    let user = {
        username,
        refreshToken: refreshToken || crypto.randomBytes(10).toString('base64')
    };

    this.users[username] = user;
    this.tokens[user.refreshToken] = username;

    return this.generateAccessToken(user.refreshToken);
};

OAuthServer.prototype.generateAccessToken = function (refreshToken) {
    let username = this.tokens[refreshToken];
    let accessToken = crypto.randomBytes(10).toString('base64');

    if (!username) {
        return {
            error: 'Invalid refresh token'
        };
    }

    this.users[username].accessToken = accessToken;
    this.users[username].expiresIn = Date.now + this.options.expiresIn * 1000;

    if (this.options.onUpdate) {
        this.options.onUpdate(username, accessToken);
    }

    return {
        access_token: accessToken,
        expires_in: this.options.expiresIn,
        token_type: 'Bearer'
    };
};

OAuthServer.prototype.validateAccessToken = function (username, accessToken) {
    if (!this.users[username] || this.users[username].accessToken !== accessToken || this.users[username].expiresIn < Date.now()) {
        return false;
    } else {
        return true;
    }
};

OAuthServer.prototype.start = function (callback) {
    this.server = http.createServer((req, res) => {
        let data = [];
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
                response = this.generateAccessToken(query.refresh_token);

            res.writeHead(!response.error ? 200 : 401, {
                'Content-Type': 'application/json'
            });

            res.end(JSON.stringify(response));
        });
    });

    this.server.listen(this.options.port, callback);
};

OAuthServer.prototype.stop = function (callback) {
    this.server.close(callback);
};
