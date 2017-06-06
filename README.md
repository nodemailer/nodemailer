# Nodemailer

![Nodemailer](https://raw.githubusercontent.com/nodemailer/nodemailer/master/assets/nm_logo_200x136.png)

Send e-mails from Node.js – easy as cake! 🍰✉️

[![NPM](https://nodei.co/npm/nodemailer.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/nodemailer/)

See [nodemailer.com](https://nodemailer.com/) for documentation and terms.

-------

## Having an issue?

#### Nodemailer throws a SyntaxError for "..."

You are using older Node.js version than v6.0. Upgrade Node.js to get support for the spread operator

#### I'm having issues with Gmail

Gmail either works well or it does not work at all. It is probably easier to switch to an alternative service instead of fixing issues with Gmail. If Gmail does not work for you then don't use it.

#### I get ETIMEDOUT errors

Check your firewall settings. Timeout usually occurs when you try to open a connection to a port that is firewalled either on the server or on your machine

#### I get TLS errors

If you are running the code in your own machine, then check your antivirus settings. Antiviruses often mess around with email ports usage. Node.js might not recognize the MITM cert your antivirus is using.

#### I have a different problem

If you are having issues with Nodemailer, then the best way to find help would be [Stack Overflow](https://stackoverflow.com/search?q=nodemailer).

### License

Nodemailer is licensed under the **MIT license**
