# Nodemailer

[![Nodemailer](https://raw.githubusercontent.com/nodemailer/nodemailer/master/assets/nm_logo_200x136.png)](https://nodemailer.com/about/)

> Sponsored by [Forward Email](https://forwardemail.net/?ref=nodemailer) &ndash; free email forwarding + custom domains + 100% open-source!

Send e-mails from Node.js – easy as cake! 🍰✉️

[![NPM](https://nodei.co/npm/nodemailer.png?downloads=true&downloadRank=true&stars=true)](https://nodemailer.com/about/)

See [nodemailer.com](https://nodemailer.com/) for documentation and terms.

## Having an issue?

#### First review the docs

Documentation for Nodemailer can be found at [nodemailer.com](https://nodemailer.com/about/).

#### Nodemailer throws a SyntaxError for "..."

You are using older Node.js version than v6.0. Upgrade Node.js to get support for the spread operator.

#### I'm having issues with Gmail

Gmail either works well or it does not work at all. It is probably easier to switch to an alternative service instead of fixing issues with Gmail. If Gmail does not work for you then don't use it. Read more about it [here](https://nodemailer.com/usage/using-gmail/).

#### I get ETIMEDOUT errors

Check your firewall settings. Timeout usually occurs when you try to open a connection to a port that is firewalled either on the server or on your machine.

#### I get TLS errors

* If you are running the code in your own machine, then check your antivirus settings. Antiviruses often mess around with email ports usage. Node.js might not recognize the MITM cert your antivirus is using.
* Latest Node versions allow only TLS versions 1.2 and higher, some servers might still use TLS 1.1 or lower. Check Node.js docs how to get correct TLS support for your app.

#### I have a different problem

If you are having issues with Nodemailer, then the best way to find help would be [Stack Overflow](https://stackoverflow.com/search?q=nodemailer) or revisit the [docs](https://nodemailer.com/about/).

### License

Nodemailer is licensed under the **MIT license**

---

The Nodemailer logo was designed by [Sven Kristjansen](https://www.behance.net/kristjansen).
