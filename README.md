![Nodemailer](https://raw2.github.com/andris9/Nodemailer/master/assets/nm_logo_200x136.png)

Send e-mails from Node.js – easy as cake!

[![Build Status](https://secure.travis-ci.org/andris9/Nodemailer.svg)](http://travis-ci.org/andris9/Nodemailer)
<a href="http://badge.fury.io/js/nodemailer"><img src="https://badge.fury.io/js/nodemailer.svg" alt="NPM version" height="18"></a>

## Upgrade warning

Do not upgrade Nodemailer from 0.7 or lower to 1.0 as there are breaking changes. You can continue to use the 0.7 branch as long as you like. See the documentation for 0.7 [here](https://github.com/andris9/Nodemailer/blob/0.7/README.md).

### Migration guide

See the migration guide from 0.7 to 1.0 [in the 1.0 release blog post](http://www.andrisreinman.com/nodemailer-v1-0/#migrationguide).

## Notes and information

### Nodemailer supports

  * **Unicode** to use any characters
  * **Windows** – you can install it with *npm* on Windows just like any other module, there are no compiled dependencies. Use it from Azure or from your Windows box hassle free.
  * **HTML content** as well as **plain text** alternative
  * **Attachments** (including attachment **streaming** for sending larger files)
  * **Embedded images** in HTML
  * Secure e-mail delivery using **SSL/STARTTLS**
  * Different **transport methods**, either using built in transports or from external plugins
  * Custom **Plugin support** for manipulating messages (add DKIM signatures, use markdown content instead of HTML etc.)
  * Sane **XOAUTH2** login with automatic access token generation (and feedback about the updated tokens)

### Support Nodemailer development

[![Donate to author](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=DB26KWR2BQX5W)

If you want to support with Bitcoins, then my wallet address is `15Z8ADxhssKUiwP3jbbqJwA21744KMCfTM`

## TL;DR Usage Example

This is a complete example to send an e-mail with plaintext and HTML body

```javascript
var nodemailer = require('nodemailer');

// create reusable transporter object using SMTP transport
var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'gmail.user@gmail.com',
        pass: 'userpass'
    }
});

// NB! No need to recreate the transporter object. You can use
// the same transporter object for all e-mails

// setup e-mail data with unicode symbols
var mailOptions = {
    from: 'Fred Foo ✔ <foo@blurdybloop.com>', // sender address
    to: 'bar@blurdybloop.com, baz@blurdybloop.com', // list of receivers
    subject: 'Hello ✔', // Subject line
    text: 'Hello world ✔', // plaintext body
    html: '<b>Hello world ✔</b>' // html body
};

// send mail with defined transport object
transporter.sendMail(mailOptions, function(error, info){
    if(error){
        console.log(error);
    }else{
        console.log('Message sent: ' + info.response);
    }
});
```

See [nodemailer-smtp-transport](https://github.com/andris9/nodemailer-smtp-transport#usage) for SMTP configuration options and [nodemailer-wellknown](https://github.com/andris9/nodemailer-wellknown#supported-services) for preconfigured service names (example uses 'gmail').

> When using default SMTP transport, then you do not need to define transport type explicitly (even though you can), just provide the SMTP options and that's it. For anything else, see the docs of the particular [transport mechanism](#available-transports).

## Goals for 1.0

### 1. Move optional features out of core

Nodemailer 0.x is quite large and includes a ton of stuff that is not needed for most users. Sometimes it causes problems, for example when
a feature that you do not even use requires some dependency to be installed that throws in your environment. If you only use SMTP to send e-mails you do not need the SES code and vice versa. The goal is achieved with a plugin system where you can install and load only these plugins that you actually require.

### 2. Gigabyte attachments

Version 1.0 is a total rewrite from the ground up and relying heavily on Streams2. This allows you to reliably
send messages with gigabyte attachments even through a slow network connection without CPU or memory penalties. You probably never need it but it makes using smaller attachments more reliable as well.

## Setting up

Install with npm

    npm install nodemailer

To send e-mails you need a transporter object

```javascript
var transporter = nodemailer.createTransport(transport)
```

Where

  * **transporter** is going to be an object that is able to send mail
  * **transport** is a transport mechanism. If it is not set [nodemailer-direct-transport](https://github.com/andris9/nodemailer-direct-transport) transport is used. If it is a regular object [nodemailer-smtp-transport](https://github.com/andris9/nodemailer-smtp-transport) is used and the value is passed as SMTP configuration.

> You have to create the transporter object only once. If you already have a transporter object you can use it to send mail as much as you like.

### Examples

#### Use *direct* transport

In this case all e-mails are sent directly to the recipients MX server (using port 25)

```javascript
var nodemailer = require('nodemailer');
var transporter = nodemailer.createTransport();
transporter.sendMail({
    from: 'sender@address',
    to: 'receiver@address',
    subject: 'hello',
    text: 'hello world!'
});
```

> Using *direct* transport is not reliable as outgoing port 25 used is often blocked by default. Additionally mail sent from dynamic addresses is often flagged as spam. You should really consider using a SMTP provider.

#### Use the default *SMTP* transport

See SMTP [configuration options here](https://github.com/andris9/nodemailer-smtp-transport#usage)

```javascript
var nodemailer = require('nodemailer');
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'sender@gmail.com',
        pass: 'password'
    }
});
transporter.sendMail({
    from: 'sender@address',
    to: 'receiver@address',
    subject: 'hello',
    text: 'hello world!'
});
```

> Default SMTP transport is not suitable for large volume of e-mails as a new SMTP connection is established for every mail sent. Use [nodemailer-smtp-pool](https://github.com/andris9/nodemailer-smtp-pool) if you need to send a large amout of e-mails.

#### Use a transport plugin

See [Available Transports](#available-transports) for known transport plugins but there might be non listed polugins as well.

The following example uses [nodemailer-ses-transport](https://github.com/andris9/nodemailer-ses-transport) (Amazon SES).

```javascript
var nodemailer = require('nodemailer');
var ses = require('nodemailer-ses-transport');
var transporter = nodemailer.createTransport(ses({
    accessKeyId: 'AWSACCESSKEY',
    secretAccessKey: 'AWS/Secret/key'
}));
transporter.sendMail({
    from: 'sender@address',
    to: 'receiver@address',
    subject: 'hello',
    text: 'hello world!'
});
```

## Available Transports

**Built in**

  * **[nodemailer-smtp-transport](https://github.com/andris9/nodemailer-smtp-transport)** for sending messages using a SMTP service
  * **[nodemailer-direct-transport](https://github.com/andris9/nodemailer-direct-transport)** for sending messages directly to recipients MX servers (zero configuration needed but unreliable)

**Install as dependencies**

  * **[nodemailer-smtp-pool](https://github.com/andris9/nodemailer-smtp-pool)** for sending messages to SMTP using pooled connections
  * **[nodemailer-ses-transport](https://github.com/andris9/nodemailer-ses-transport)** for sending messages to AWS SES
  * **[nodemailer-sendmail-transport](https://github.com/andris9/nodemailer-sendmail-transport)** for piping messages to the *sendmail* command
  * **[nodemailer-stub-transport](https://github.com/andris9/nodemailer-stub-transport)** is just for returning messages, most probably for testing purposes
  * **[nodemailer-pickup-transport](https://github.com/andris9/nodemailer-pickup-transport)** for storing messages to pickup folders
  * *add yours* (see transport api documentation [here](#transports))

## Available Plugins

  * **[nodemailer-markdown](https://github.com/andris9/nodemailer-markdown)** to use markdown for the content
  * **[nodemailer-dkim](https://github.com/andris9/nodemailer-dkim)** to sign messages with DKIM
  * *add yours* (see plugin api documentation [here](#plugin-api))

## Sending mail

Once you have a transporter object you can send mail

```javascript
transporter.sendMail(data, callback)
```

Where

  * **data** defines the mail content (see [e-mail message fields](#e-mail-message-fields) below)
  * **callback** is an optional callback function to run once the message is delivered or it failed.
    * **err** is the error object if message failed
    * **info** includes the result, the exact format depends on the transport mechanism used
      * **info.messageId** most transports *should* return the final Message-Id value used with this property
      * **info.envelope** includes the envelope object for the message
      * **info.accepted** is an array returend by SMTP transports (includes recipient addresses that were accepted by the server)
      * **info.rejected** is an array returend by SMTP transports (includes recipient addresses that were rejected by the server)
      * **info.pending** is an array returend by Direct SMTP transport. Includes recipient addresses that were temporarily rejected together with the server response
      * **response** is a string returned by SMTP transports and includes the last SMTP response from the server

> If the message includes several recipients then the message is considered sent if at least one recipient is accepted

### E-mail message fields

The following are the possible fields of an e-mail message:

  - **from** - The e-mail address of the sender. All e-mail addresses can be plain `'sender@server.com'` or formatted `'Sender Name <sender@server.com>'`, see [here](#address-formatting) for details
  - **to** - Comma separated list or an array of recipients e-mail addresses that will appear on the *To:* field
  - **cc** - Comma separated list or an array of recipients e-mail addresses that will appear on the *Cc:* field
  - **bcc** - Comma separated list or an array of recipients e-mail addresses that will appear on the *Bcc:* field
  - **replyTo** - An e-mail address that will appear on the *Reply-To:* field
  - **inReplyTo** - The message-id this message is replying
  - **references** - Message-id list (an array or space separated string)
  - **subject** - The subject of the e-mail
  - **text** - The plaintext version of the message as an Unicode string, Buffer, Stream or an object *{path: '...'}*
  - **html** - The HTML version of the message as an Unicode string, Buffer, Stream or an object *{path: '...'}*
  - **headers** - An object of additional header fields *{"X-Key-Name": "key value"}*
  - **attachments** - An array of attachment objects  (see [below](#attachments) for details)
  - **alternatives** - An array of alternative text contents (in addition to text and html parts)  (see [below](#alternatives) for details)
  - **envelope** - optional SMTP envelope, if auto generated envelope is not suitable (see [below](#smtp-envelope) for details)
  - **messageId** - optional Message-Id value, random value will be generated if not set
  - **date** - optional Date value, current UTC string will be used if not set
  - **encoding** - optional transfer encoding for the textual parts (defaults to 'quoted-printable')

All text fields (e-mail addresses, plaintext body, html body) use UTF-8 as the encoding.
Attachments are streamed as binary.

### Attachments

Attachment object consists of the following properties:

  * **filename** - filename to be reported as the name of the attached file, use of unicode is allowed
  * **cid** - optional content id for using inline images in HTML message source
  * **content** - String, Buffer or a Stream contents for the attachment
  * **path** - path to a file or an URL if you want to stream the file instead of including it (better for larger attachments)
  * **contentType** - optional content type for the attachment, if not set will be derived from the `filename` property
  * **contentDisposition** - optional content disposition type for the attachment, defaults to 'attachment'

Attachments can be added as many as you want.

```javascript
var mailOptions = {
    ...
    attachments: [
        {   // utf-8 string as an attachment
            filename: 'text1.txt',
            content: 'hello world!'
        },
        {   // binary buffer as an attachment
            filename: 'text2.txt',
            content: new Buffer('hello world!','utf-8')
        },
        {   // file on disk as an attachment
            filename: 'text3.txt',
            path: '/path/to/file.txt' // stream this file
        },
        {   // filename and content type is derived from path
            path: '/path/to/file.txt'
        },
        {   // stream as an attachment
            filename: 'text4.txt',
            content: fs.createReadStream('file.txt')
        },
        {   // define custom content type for the attachment
            filename: 'text.bin',
            content: 'hello world!',
            contentType: 'text/plain'
        },
        {   // use URL as an attachment
            filename: 'license.txt',
            path: 'https://raw.github.com/andris9/Nodemailer/master/LICENSE'
        }
    ]
}
```

### Alternatives

In addition to text and HTML, any kind of data can be inserted as an alternative content of the main body - for example a word processing document with the same text as in the HTML field. It is the job of the e-mail client to select and show the best fitting alternative to the reader. Usually this field is used for calendar events and such.

Alternative objects use the same options as [attachment objects](#attachments). The difference between an attachment and an alternative is the fact that attachments are placed into *multipart/mixed* or *multipart/related* parts of the message white alternatives are placed into *multipart/alternative* part.

**Usage example:**

```javascript
var mailOptions = {
    ...
    html: '<b>Hello world!</b>',
    alternatives: [
        {
            contentType: 'text/x-web-markdown',
            content: '**Hello world!**'
        }
    ]
}
```

Alternatives can be added as many as you want.

### Address Formatting

All the e-mail addresses can be plain e-mail addresses

```
foobar@blurdybloop.com
```

or with formatted name (includes unicode support)

```
"Ноде Майлер" <foobar@blurdybloop.com>
```

or as an address object

```
{
    name: 'Ноде Майлер',
    address: 'foobar@blurdybloop.com'
}
```

To, Cc and Bcc fields accept comma separated list of e-mails or an array of
e-mails or an array of comma separated list of e-mails - use it as you like.
Formatting can be mixed.

```
...,
to: 'foobar@blurdybloop.com, "Ноде Майлер" <bar@blurdybloop.com>, "Name, User" <baz@blurdybloop.com>',
cc: ['foobar@blurdybloop.com', '"Ноде Майлер" <bar@blurdybloop.com>, "Name, User" <baz@blurdybloop.com>']
...
```

You can even use unicode domains, these are automatically converted to punycode

```
'"Unicode Domain" <info@müriaad-polüteism.info>'
```

### SMTP envelope

SMTP envelope is usually auto generated from `from`, `to`, `cc` and `bcc` fields but
if for some reason you want to specify it yourself, you can do it with `envelope` property.

`envelope` is an object with the following params: `from`, `to`, `cc` and `bcc` just like
with regular mail options. You can also use the regular address format, unicode domains etc.

```javascript
mailOptions = {
    ...,
    from: 'mailer@kreata.ee',
    to: 'daemon@kreata.ee',
    envelope: {
        from: 'Daemon <deamon@kreata.ee>',
        to: 'mailer@kreata.ee, Mailer <mailer2@kreata.ee>'
    }
}
```

> Not all transports can use the `envelope` object, for example SES ignores it and uses the data from the From:, To: etc. headers.

### Using Embedded Images

Attachments can be used as embedded images in the HTML body. To use this feature, you need to set additional property of the attachment - `cid` (unique identifier of the file) which is a reference to the attachment file. The same `cid` value must be used as the image URL in HTML (using `cid:` as the URL protocol, see example below).

**NB!** the cid value should be as unique as possible!

```javascript
var mailOptions = {
    ...
    html: 'Embedded image: <img src="cid:unique@kreata.ee"/>',
    attachments: [{
        filename: 'image.png',
        path: '/path/to/file',
        cid: 'unique@kreata.ee' //same cid value as in the html img src
    }]
}
```

## Plugin system

There are 3 stages a plugin can hook to

  1. **'compile'** is the step where e-mail data is set but nothing has been done with it yet. At this step you can modify mail options, for example modify `html` content, add new headers etc. Example: [nodemailer-markdown](https://github.com/andris9/nodemailer-markdown) that allows you to use `markdown` source instead of `text` and `html`.
  2. **'stream'** is the step where message tree has been compiled and is ready to be streamed. At this step you can modify the generated MIME tree or add a transform stream that the generated raw e-mail will be piped through before passed to the transport object. Example: [nodemailer-dkim](https://github.com/andris9/nodemailer-dkim) that adds DKIM signature to the generated message.
  3. **Transport** step where the raw e-mail is streamed to destination. Example: [nodemailer-smtp-transport](https://github.com/andris9/nodemailer-smtp-transport) that streams the message to a SMTP server.

### Including plugins

'compile' and 'stream' plugins can be attached with `use(plugin)` method

```javascript
transporter.use(step, pluginFunc)
```

Where

  * **transporter** is a transport object created with `createTransport`
  * **step** is a string, either 'compile' or 'stream' thatd defines when the plugin should be hooked
  * **pluginFunc** is a function that takes two arguments: the mail object and a callback function

## Plugin API

All plugins (including transports) get two arguments, the mail object and a callback function.

Mail object that is passed to the plugin function as the first argument is an object with the following properties:

  * **data** is the mail data object that is passed to the `sendMail` method
  * **message** is the [BuildMail](https://github.com/andris9/buildmail) object of the message. This is available for the 'stream' step and for the transport but not for 'compile'.

### 'compile'

Compile step plugins get only the `mail.data` object but not `mail.message` in the `mail` argument of the plugin function. If you need to access the `mail.message` as well use 'stream' step instead.

This is really straightforward, your plugin can modify the `mail.data` object at will and once everything is finished run the callback function. If the callback gets an error object as an argument, then the process is terminated and the error is returned to the `sendMail` callback.

**Example**

The following plugin checks if `text` value is set and if not converts `html` value to `text` by removing all html tags.

```javascript
transporter.use('compile', function(mail, callback){
    if(!mail.text && mail.html){
        mail.text = mail.html.replace(/<[^>]*>/g, ' ');
    }
    callback();
});
```

See [plugin-compile.js](examples/plugin-compile.js) for a working example.

### 'stream'

Streaming step is invoked once the message structure is built and ready to be streamed to the transport. Plugin function still gets `mail.data` but it is included just for the reference, modifying it should not change anything (unless the transport requires something from the `mail.data`, for example `mail.data.envelope`).

You can modify the `mail.message` object as you like, the message is not yet streaming anything (message starts streaming when the transport calls `mail.message.createReadStream()`).

In most cases you might be interested in the [message.transform()](https://github.com/andris9/buildmail#transform) method for applying transform streams to the raw message.

**Example**

The following plugin replaces all tabs with spaces in the raw message.

```javascript
var transformer = new (require('stream').Transform)();
transformer._transform = function(chunk, encoding, done) {
    // replace all tabs with spaces in the stream chunk
    for(var i = 0; i < chunk.length; i++){
        if(chunk[i] === 0x09){
            chunk[i] = 0x20;
        }
    }
    this.push(chunk);
    done();
};

transporter.use('stream', function(mail, callback){
    // apply output transformer to the raw message stream
    mail.message.transform(transformer);
    callback();
});
```

See [plugin-stream.js](examples/plugin-stream.js) for a working example.

### Transports

Transports are objects that have a method `send` and properies `name` and `version`. Additionally, if the transport object is an Event Emitter, 'log' events are piped through Nodemailer. A transport object is passed to the `nodemailer.createTransport(transport)` method to create the transporter object.

**`transport.name`**

This is the name of the transport object. For example 'SMTP' or 'SES' etc.

```javascript
transport.name = require('package.json').name;
```

**`transport.version`**

This should be the transport module version. For example '0.1.0'.

```javascript
transport.version = require('package.json').version;
```

**`transport.send(mail, callback)`**

This is the method that actually sends out e-mails. The method is basically the same as 'stream' plugin functions. It gets two arguments: `mail` and a callback. To start streaming the message, create the stream with `mail.message.createReadStream()`

Callback function should return an `info` object as the second arugment. This info object should contain `messageId` value with the Message-Id header (without the surrounding &lt; &gt; brackets)

The following example pipes the raw stream to the console.

```javascript
transport.send = function(mail, callback){
    var input = mail.message.createReadStream();
    var messageId = (mail.message.getHeader('message-id') || '').replace(/[<>\s]/g, '');
    input.pipe(process.stdout);
    input.on('end', function() {
        callback(null, {
            messageId: messageId
        });
    });
};
```

**`transport.close(args*)`**

If your transport needs to be closed explicitly, you can implement a `close` method.

This is purely optional feature and only makes sense in special contexts (eg. closing a SMTP pool).

Once you have a transport object, you can create a mail transporter out of it.

```
var nodemailer = require('nodemailer');
var transport = require('some-transport-method');
var transporter = nodemailer.createTransport(transport);
transporter.sendMail({mail data});
```

See [minimal-transport.js](examples/minimal-transport.js) for a working example.

## License

**Nodemailer** is licensed under [MIT license](https://github.com/andris9/Nodemailer/blob/master/LICENSE). Basically you can do whatever you want to with it

----

The Nodemailer logo was designed by [Sven Kristjansen](https://www.behance.net/kristjansen).
