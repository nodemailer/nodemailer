# Nodemailer

[![Nodemailer](https://raw.githubusercontent.com/nodemailer/nodemailer/master/assets/nm_logo_200x136.png)](https://nodemailer.com/about/)

Send emails from Node.js – easy as cake! 🍰✉️

[![NPM](https://nodei.co/npm/nodemailer.png?downloads=true&downloadRank=true&stars=true)](https://nodemailer.com/about/)

See [nodemailer.com](https://nodemailer.com/) for documentation and terms.

## Having an issue?

> Nodemailer supports all Node.js versions starting from Node.js@v6.0.0. The existing test suite does not support such old Node.js versions, so all features are not tested. From time to time, some regression bugs might occur because of this.

#### First review the docs

Documentation for Nodemailer can be found at [nodemailer.com](https://nodemailer.com/about/).

#### Nodemailer throws a SyntaxError for "..."

You are using an older Node.js version than v6.0. Upgrade Node.js to get support for the spread operator.

#### I'm having issues with Gmail

Gmail either works well, or it does not work at all. It is probably easier to switch to an alternative service instead of fixing issues with Gmail. If Gmail does not work for you, then don't use it. Read more about it [here](https://nodemailer.com/usage/using-gmail/).

#### I get ETIMEDOUT errors

Check your firewall settings. Timeout usually occurs when you try to open a connection to a firewalled port either on the server or on your machine. Some ISPs also block email ports to prevent spamming.

#### Nodemailer works on one machine but not in another

It's either a firewall issue, or your SMTP server blocks authentication attempts from some servers.

#### I get TLS errors

-   If you are running the code on your machine, check your antivirus settings. Antiviruses often mess around with email ports usage. Node.js might not recognize the MITM cert your antivirus is using.
-   Latest Node versions allow only TLS versions 1.2 and higher. Some servers might still use TLS 1.1 or lower. Check Node.js docs on how to get correct TLS support for your app.
-   You might have the wrong value for the `secure` option. This is `true` _only_ for port 465. For every other port, it should be `false`. Setting `secure` to `false` does not mean that Nodemailer would not use TLS. Nodemailer would still try to upgrade the connection to use TLS if the server supports it.
-   Older Node versions do not support the newest Let's Encrypt certificates. Either set `tls.rejectUnauthorized` to `false` or upgrade your Node version

#### I have issues with DNS / hosts file

Nodemailer uses `dns.resolve4()` and `dns.resolve6()` to resolve hostname into an IP address. If both calls fail, then Nodemailer will fall back to `dns.lookup()`. If this does not work for you, you can hard code the IP address into the configuration. In that case, Nodemailer would not perform any DNS lookups.

```
let configOptions = {
    host: "1.2.3.4",
    port: 465,
    secure: true,
    tls: {
        // must provide server name, otherwise TLS certificate check will fail
        servername: "example.com"
    }
}
```

#### I have a different problem

If you are having issues with Nodemailer, then the best way to find help would be [Stack Overflow](https://stackoverflow.com/search?q=nodemailer) or revisit the [docs](https://nodemailer.com/about/).

### License

Nodemailer is licensed under the **MIT license**

---

The Nodemailer logo was designed by [Sven Kristjansen](https://www.behance.net/kristjansen).
