Nodemailer
==========

**Nodemailer** is an easy to use module to send e-mails with Node.JS (using 
SMTP or sendmail or Amazon SES) and is unicode friendly - You can use any characters you like ✔

Nodemailer is Windows friendly, you can install it with *npm* on Windows just like any other module, there are no compiled dependencies. Use it from Azure or from your Windows box hassle free.

Version v0.3 of Nodemailer is built from scratch and might break some existing scripts, so beware while upgrading. Nodemailer should be backwards compatible - if your script worked before, then it should work now, even if Nodemailer documentation differs from your code (method names, properties etc.).

Use [DocumentUp](http://documentup.com/andris9/nodemailer/) to read this README
in a more structured way (with TOC).

[![Build Status](https://secure.travis-ci.org/andris9/Nodemailer.png)](http://travis-ci.org/andris9/Nodemailer)

## Nodemailer supports

  * **Unicode** to use any characters
  * **HTML content** as well as **plain text** alternative
  * **Attachments** (including attachment **streaming** for sending larger files)
  * **Embedded images** in HTML
  * **SSL/STARTTLS** for secure e-mail delivery
  * Different transport methods - **SMTP**, **sendmail** and **Amazon SES**
  * SMTP **Connection pool** and connection reuse for rapid delivery
  * **Preconfigured** services for using SMTP with Gmail, Hotmail etc.
  * Use objects as header values for **SendGrid** SMTP API
  * **XOAUTH** authentication support and token generation (3-legged OAuth) - useful with Gmail
  * **DKIM** signing

## Support Nodemailer development

[![Donate to author](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=DB26KWR2BQX5W)

## Check out my other mail related modules

If you want to parse generated or received e-mail instead of sending it, check 
out [MailParser](https://github.com/andris9/mailparser).

If you only want to generate the raw e-mail stream, check out 
[MailComposer](https://github.com/andris9/mailcomposer).

If you only want to communicate with the SMTP (both as client and the server),
check out [simplesmtp](https://github.com/andris9/simplesmtp).

## Example

This is a complete example to send an e-mail with plaintext and HTML body

    var nodemailer = require("nodemailer");
    
    // create reusable transport method (opens pool of SMTP connections)
    var smtpTransport = nodemailer.createTransport("SMTP",{
        service: "Gmail",
        auth: {
            user: "gmail.user@gmail.com",
            pass: "userpass"
        }
    });
    
    // setup e-mail data with unicode symbols
    var mailOptions = {
        from: "Sender Name ✔ <sender@example.com>", // sender address
        to: "receiver1@example.com, receiver2@example.com", // list of receivers
        subject: "Hello ✔", // Subject line
        text: "Hello world ✔", // plaintext body
        html: "<b>Hello world ✔</b>" // html body
    }

    // send mail with defined transport object
    smtpTransport.sendMail(mailOptions, function(error, response){
        if(error){
            console.log(error);
        }else{
            console.log("Message sent: " + response.message);
        }
        
        // if you don't want to use this transport object anymore, uncomment following line
        //smtpTransport.close(); // shut down the connection pool, no more messages
    });

See also the [examples folder](https://github.com/andris9/Nodemailer/tree/master/examples) 
for full featured examples

## Installation

Install through NPM

    npm install nodemailer

## Usage

Include the module

    var nodemailer = require("nodemailer");

An e-mail can be sent with `sendMail(mailOptions[, callback])` command

    transport.sendMail(mailOptions, callback);

Where

  * `transport` is a transport method defined with `nodemailer.createTransport`
  * **mailOptions** defines the e-mail (set its subject, body text, receivers etc.), see **E-mail Message Fields** for details
  * **callback** is the callback function that will be run after the e-mail is sent or the sending failed (see **Return callback** for details)

## Setting up a transport method

Before you can send any e-mails you need to set up a transport method. This can
be done with `nodemailer.createTransport(type, options)` where `type` indicates
the transport protocol and `options` defines how it is used.

    var transport = nodemailer.createTransport("SMTP", {smtp_options});

The same transport object can and should be reused several times.

When the transport method is defined, it can be used to send e-mail with `sendMail`

    var transport = nodemailer.createTransport("SMTP", {smtp_options});

    transport.sendMail({
        from: "sender@tr.ee",
        to: "receiver@tr.ee"
        ...
    });

### Possible transport methods

Required `type` parameter can be one of the following:

  * **SMTP** for using SMTP
  * **SES** for using Amazon SES
  * **Sendmail** for utilizing systems *sendmail* command

### Setting up SMTP

SMTP is different from the other transport mechanisms, as in its case a connection
pool is created. All the connections try to stay alive as long as possible and 
are reusable to minimize the protocol overhead delay - for example setting up
TLS for authenticating is relatively lengthy process (in CPU terms, not by human
terms), you do not want to do it several times.

Possible SMTP options are the following:

 * **service** - an optional well known service identifier ("Gmail", "Hotmail" etc., see **Well known Services** for a list of supported services) to auto-configure host, port and secure connection settings
 * **host** - hostname of the SMTP server (defaults to "localhost", not needed with `service`)
 * **port** - port of the SMTP server (defaults to 25, not needed with `service`)
 * **secureConnection** - use SSL (default is `false`, not needed with `service`). If you're using port 587 then keep `secureConnection` false, since the connection is started in insecure plain text mode and only later upgraded with STARTTLS  
 * **name** - the name of the client server (defaults to machine name)
 * **auth** - authentication object as `{user:"...", pass:"..."}` or  `{XOAuthToken: "base64data"}`
 * **ignoreTLS** - ignore server support for STARTTLS (defaults to `false`)
 * **debug** - output client and server messages to console
 * **maxConnections** - how many connections to keep in the pool (defaults to 5)

Example:

    var transport = nodemailer.createTransport("SMTP", {
        service: "Gmail",
        auth: {
            user: "gmail.user@gmail.com",
            pass: "userpass"
        }
    });

or the same without `service` parameter

    var transport = nodemailer.createTransport("SMTP", {
        host: "smtp.gmail.com", // hostname
        secureConnection: true, // use SSL
        port: 465, // port for secure SMTP
        auth: {
            user: "gmail.user@gmail.com",
            pass: "userpass"
        }
    });

**NB!** if you want to close the pool (cancel all open connections) you can use
`transport.close()`

    var transport = nodemailer.createTransport("SMTP",{});
    ...
    transport.close(); // close the pool 


#### SMTP XOAUTH and token generation

**nodemailer** supports XOAUTH authentication for SMTP. To use this, include
`XOAuthToken` option in `auth` instead of the regular `user` and `pass`.

    var transportOptions = {
        ...,
        auth: {
            XOAuthToken: "R0VUIGh0dHBzOi8vbWFpbC5nb29...."
        }
    }

**nodemailer** includes also built in XOAUTH token generator which can be used 
with `nodemailer.createXOAuthGenerator()`. The function is preconfigured for
Gmail, so in this case only mandatory options are `user`, `token` and `tokenSecret`.

    var XOAuthTokenGenerator = nodemailer.createXOAuthGenerator({
            user: "test.nodemailer@gmail.com",
            // requestUrl: "https://oauth.access.point",
            // consumerKey: "anonymous",
            // consumerSecret: "anonymous",
            token: "1/O_HgoO4h2uOUfpus0V--7mygICXrQQ0ZajB3ZH52KqM",
            tokenSecret: "_mUBkIwNPnfQBUIWrJrpXJ0c"
        });

One of `user` or `requestUrl` is mandatory. `consumerKey` and `consumerSecret` both
default to `"anonymous"`.

    var transportOptions = {
        service: "Gmail",
        auth: {
            XOAuthToken: nodemailer.createXOAuthGenerator({
                user: "test.nodemailer@gmail.com",
                token: "1/O_HgoO4h2uOUfpus0V--7mygICXrQQ0ZajB3ZH52KqM",
                tokenSecret: "_mUBkIwNPnfQBUIWrJrpXJ0c"
            })
        }
    }

### Setting up SES

SES is actually a HTTP based protocol, the compiled e-mail and related info 
(signatures and such) are sent as a HTTP request to SES servers.

Possible SES options are the following:

 * **AWSAccessKeyID** - AWS access key (required)
 * **AWSSecretKey** - AWS secret (required)
 * **ServiceUrl** - optional API end point URL (defaults to *"https://email.us-east-1.amazonaws.com"*)

Example:

    var transport = nodemailer.createTransport("SES", {
        AWSAccessKeyID: "AWSACCESSKEY",
        AWSSecretKey: "AWS/Secret/key"
    });

### Setting up Sendmail

Sendmail transport method streams the compiled message to the *stdin* of *sendmail*
command.

Options object is optional, possible sendmail options are the following:

  * **path** - path to the `sendmail` command (defaults to *"sendmail"*)
  * **args** - an array of extra command line options to pass to the `sendmail` command (ie. `["-f sender@example.com"]`)

Example:

    var transport = nodemailer.createTransport("sendmail");

or

    var transport = nodemailer.createTransport("sendmail", {
        path: "/usr/local/bin/sendmail",
        args: ["-f sender@example.com"]
    });

### DKIM Signing

**Nodemailer** supports DKIM signing with very simple setup. Use this with caution 
though since the generated message needs to be buffered entirely before it can be
signed. Not a big deal with small messages but might consume a lot of RAM when 
using larger attachments.

Set up the DKIM signing with `useDKIM` method for a transport object:

    transport.useDKIM(dkimOptions)

Where `dkimOptions` includes necessary options for signing

  * **domainName** - the domainname that is being used for signing
  * **keySelector** - key selector. If you have set up a TXT record with DKIM public key at *zzz._domainkey.example.com* then `zzz` is the selector
  * **privateKey** - DKIM private key that is used for signing as a string
  * **headerFieldNames** - optional colon separated list of header fields to sign, by default all fields suggested by RFC4871 #5.5 are used

All messages transmitted through this transport objects are from now on DKIM signed.

Currently if several header fields with the same name exists, only the last one (the one in the bottom) is signed.

Example:

    var transport = nodemailer.createTransport("Sendmail");
    
    transport.useDKIM({
        domainName: "node.ee",
        keySelector: "dkim",
        privateKey: fs.readFileSync("private_key.pem")
    });

    transport.sendMail(mailOptions);

See examples/example_dkim.js for a complete example.

**NB!** Be careful when using services like Gmail, SES etc. through SMTP 
(SES API is handled by Nodemailer automatically) - these tend to modify some 
headers like Message-Id or Date which invalidates the signature. In this case use
`headerFieldNames` property to define only fields that won't be changed and leave
out `Date` or any other unsupported field.

### Well known services for SMTP

If you want to use a well known service as the SMTP host, you do not need
to enter the hostname or port number, just use the `service` parameter (**NB!** case sensitive).

Currently cupported services are: 

  * **"Gmail"** for Google Mail
  * **"hot.ee"** for www.hot.ee
  * **"Hotmail"** for Microsoft Live Hotmail
  * **"iCloud"** for Apple iCloud
  * **"mail.ee"** for www.mail.ee
  * **"Postmark"** for Postmark App
  * **"SendGrid"** for SendGrid
  * **"SES"** for Amazon SES
  * **"Yahoo"** for Yahoo Mail
  * **"Zoho"** for Zoho Mail

Predefined service data covers `host`, `port` and secure connection settings, 
any other parameters (ie. `auth`) need to be set separately.

## E-mail message fields

The following are the possible fields of an e-mail message:

  - **from** - The e-mail address of the sender. All e-mail addresses can be plain `sender@server.com` or formatted `Sender Name <sender@server.com>`
  - **to** - Comma separated list of recipients e-mail addresses that will appear on the `To:` field
  - **cc** - Comma separated list of recipients e-mail addresses that will appear on the `Cc:` field
  - **bcc** - Comma separated list of recipients e-mail addresses that will appear on the `Bcc:` field
  - **replyTo** - An e-mail address that will appear on the `Reply-To:` field
  - **subject** - The subject of the e-mail
  - **text** - The plaintext version of the message
  - **html** - The HTML version of the message
  - **generateTextFromHTML** - if set to true uses HTML to generate plain text body part from the HTML if the text is not defined
  - **headers** - An object of additional header fields `{"X-Key-Name": "key value"}` (NB! values are passed as is, you should do your own encoding to 7bit if needed)
  - **attachments** - An array of attachment objects.
  - **envelope** - optional SMTP envelope, if auto generated envelope is not suitable
  - **messageId** - optional Message-Id value, random value will be generated if not set. Set to false to omit the Message-Id header
  - **encoding** - optional transfer encoding for the textual parts (defaults to "quoted-printable")

All text fields (e-mail addresses, plaintext body, html body) use UTF-8 as the encoding.
Attachments are streamed as binary.

Example:

    var transport = nodemailer.createTransport("Sendmail");

    var mailOptions = {
        from: "me@tr.ee",
        to: "me@tr.ee",
        subject: "Hello world!",
        text: "Plaintext body"
    }
    
    transport.sendMail(mailOptions);

### SendGrid support

Nodemailer supports SendGrid [SMTP API](http://docs.sendgrid.com/documentation/api/smtp-api/) out of the box - you can
use objects as header values and these are automatically JSONized (and mime encoded if needed).

    var mailOptions = {
        ...,
        headers: {
            'X-SMTPAPI': {
                category : "newuser",
                sub:{
                    "%name%": ["Žiguli Õllepruul"]
                }
            }
        },
        subject: "Hello, %name%"
    }

This also applies to any other service that expects a JSON string as a header value for specified key.

### Generate Text from HTML

If `generateTextFromHTML` option is set to true, then HTML contents of the mail is automatically converted
to plaintext format when plaintext content is empty or missing.

For example

    mailOptions = {
        ...,
        generateTextFromHTML: true,
        html: '<h1>Hello world</h1><p><b>How</b> are you?',
        // text: '' // no text part
    }
    
is automatically converted in the backround by Nodemailer to:

    mailOptions = {
        ...,
        // source html:
        html: '<h1>Hello world</h1><p><b>How</b> are you?',
        // automatically generated plaintext message:
        text: "Hello world\n"+
              "===========\n"+
              "\n"+
              "**How** are you?"
    }

As you can see the output syntax for `generateTextFromHTML` looks similar to markdown, and that
is exactly the case here - Nodemailer includes a simple HTML to markdown converter. But don't
expect too much from it, it's not full featured or perfect, just some regexes here and there.

### Attachment fields

Attahcment object consists of the following properties:

  * **fileName** - filename to be reported as the name of the attached file, use of unicode is allowed (except when using Amazon SES which doesn't like it)
  * **cid** - optional content id for using inline images in HTML message source
  * **contents** - String or a Buffer contents for the attachment
  * **filePath** - path to a file or an URL if you want to stream the file instead of including it (better for larger attachments)
  * **streamSource** - Stream object for arbitrary binary streams if you want to stream the contents (needs to support *pause*/*resume*)
  * **contentType** - optional content type for the attachment, if not set will be derived from the `fileName` property
  * **contentDisposition** - optional content disposition type for the attachment, defaults to "attachment" 

One of `contents`, `filePath` or `streamSource` must be specified, if none is 
present, the attachment will be discarded. Other fields are optional.

Attachments can be added as many as you want.

    var mailOptions = {
        ...
        attachments: [
            {   // utf-8 string as an attachment
                fileName: "text1.txt",
                contents: "hello world!
            },
            {   // binary buffer as an attachment
                fileName: "text2.txt",
                contents: new Buffer("hello world!,"utf-8")
            },
            {   // file on disk as an attachment
                fileName: "text3.txt",
                filePath: "/path/to/file.txt" // stream this file
            },
            {   // fileName and content type is derived from filePath
                filePath: "/path/to/file.txt"
            },
            {   // stream as an attachment
                fileName: "text4.txt",
                streamSource: fs.createReadStream("file.txt")
            },
            {   // define custom content type for the attachment
                fileName: "text.bin",
                contents: "hello world!,
                contentType: "text/plain"
            },
            {   // use URL as an attachment
                fileName: "license.txt",
                filePath: "https://raw.github.com/andris9/Nodemailer/master/LICENSE"
            }
        ]
    }

### Address Formatting

All the e-mail addresses can be plain e-mail address

    username@example.com

or with formatted name (includes unicode support)

    "Ноде Майлер" <username@example.com>

To, Cc and Bcc fields accept comma separated list of e-mails. Formatting can be mixed.

    username@example.com, "Ноде Майлер" <username@example.com>, "Name, User" <username@example.com>

You can even use unicode domain and user names, these are automatically converted
to the supported form

    "Uncode Domain" <info@müriaad-polüteism.info>

### SMTP envelope

SMTP envelope is usually auto generated from `from`, `to`, `cc` and `bcc` fields but
if for some reason you want to specify it yourself, you can do it with `envelope` property.

`envelope` is an object with the following params: `from`, `to`, `cc` and `bcc` just like
with regular mail options. You can also use the regular address format.

    mailOptions = {
        ...,
        from: "mailer@node.ee",
        to: "daemon@node.ee",
        envelope: {
            from: "Daemon <deamon@node.ee>",
            to: "mailer@node.ee, Mailer <mailer2@node.ee>"
        }
    }

### Using Embedded Images

Attachments can be used as embedded images in the HTML body. To use this
feature, you need to set additional property of the attachment - `cid` (unique
identifier of the file) which is a reference to the attachment file. The same
`cid` value must be used as the image URL in HTML (using `cid:` as the URL
protocol, see example below).

**NB!** the cid value should be as unique as possible!

    var mailOptions = {
        ...
        html: "Embedded image: <img src='cid:unique@node.ee' />",
        attachments: [{
            filename: "image.png",
            filePath: "/path/to/file",
            cid: "unique@node.ee" //same cid value as in the html img src
        }]
    }

## Return callback

Return callback gets two parameters

  * **error** - an error object if the message failed
  * **responseStatus** - an object with some information about the status on success

Example:

    nodemailer.sendMail(mailOptions, function(error, responseStatus){
        if(!error){
            console.log(responseStatus.message); // response from the server
        }
    });

## Tests

Run the tests with npm in Nodemailer's directory

    npm test

There aren't currently many tests for Nodemailer but there are a lot of tests
in the modules that are used to generate the raw e-mail body and to use the 
SMTP client connection.

## Tweaking 

Nodemailer in itself is actually more like a wrapper for my other modules
[mailcomposer](https://github.com/andris9/mailcomposer) for composing the raw message stream
and [simplesmtp](https://github.com/andris9/simplesmtp) for delivering it, by providing an 
unified API. If there's some problems with particular parts of the 
message composing/sending process you should look at the  appropriate module.

## License

**Nodemailer** is licensed under [MIT license](https://github.com/andris9/Nodemailer/blob/master/LICENSE). Basically you can do whatever you want to with it.
