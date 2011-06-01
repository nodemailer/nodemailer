Nodemailer
==========

**Nodemailer** is an easy to use module to send e-mails with Node.JS (using SMTP or sendmail). 

You can use two ways to send an e-mail message: the *EmailMessage* constructor or the shortcut function *send_mail()*. 
The *send_mail()* function takes all the fields of the e-mail message as a function parameter and sends the e-mail immediately. 
*EmailMessage* allows to compose the message object first and send it later with its method *send()*. Nodemailers API is designed after Google App Engines [Mail Python API](http://code.google.com/intl/et-EE/appengine/docs/python/mail/).

**Nodemailer is Unicode friendly ✔**. You can use any characters you like.

Nodemailer supports
-------------------

  - *Unicode* to use any characters
  - *HTML content* as well as plain text alternative
  - *Attachments*
  - *Embedded images* in HTML
  - *SSL/TLS* for secure e-mail delivery

Installation
------------

Install through *NPM*

    npm install nodemailer
    
or download [ZIP archive](https://github.com/andris9/Nodemailer/zipball/master).

The source for Nodemailer is available at [GitHub](https://github.com/andris9/Nodemailer).

*NB!* If you are using the source and not the automagic of *NPM*, then you also need to install following dependencies:

  * [mimelib](https://github.com/andris9/mimelib)
  * [node-iconv](https://github.com/bnoordhuis/node-iconv)

If you use *NPM* then the module is available as 

    var nodemailer = require('nodemailer');

but if you're using the source then 

    var nodemailer = require('./path_to_nodemailer/lib/mail');

Usage
-----

Using *send_mail()*

    var nodemailer = require("nodemailer");
    
    nodemailer.send_mail({sender: "me@example.com", 
                          to:"you@example.com",
                          subject:"Hello!",
                          body:"Hi, how are you doing?"},
                          function(error, success){
                              console.log("Message "+(success?"sent":"failed"));
                          });
                          
Using *EmailMessage*

    var nodemailer = require("nodemailer");
    
    var mail = nodemailer.EmailMessage({
                          sender: "me@example.com", 
                          to:"you@example.com"
                          });
    mail.subject = "Hello!";
    mail.body = "Hi, how are you doing?";
    
    mail.send(function(error, success){
                  console.log("Message "+(success?"sent":"failed"));
              });

The callback function gets two parameters - *error* and *success*. If there's an error, then sending failed and you should check where's the problem.
If there's no error value but *success* is not *true* then the server wasn't able to process the message correctly. Probably there was timeout while processing
the message etc - in this case you should re-schedule sending this e-mail. If *success* is *true* then the message was sent successfully. 

### NB!

Before sending e-mails you need to set up SMTP server parameters.

    nodemailer.SMTP = {
        host: "smtp.example.com", // required
        port: 25, // optional, defaults to 25 or 465
        use_authentication: false,
        user: "",
        pass: ""
    }

Or alternatively if you don't want to use SMTP but the `sendmail` command then you could
set property *sendmail* to true or as the path to *sendmail*.

    nodemailer.sendmail = true;

or

    nodemailer.sendmail = "/path/to/sendmail";
    
If *sendmail* is set, then SMTP options are disregarded. 

See [examples/example.js](https://github.com/andris9/Nodemailer/blob/master/examples/example.js) for a complete example.

### SSL Support (port 465)

If you want to use SSL (not TLS/STARTTLS, just SSL), you need to set the *ssl* parameter to true.

	nodemailer.SMTP = {
	    host: "smtp.gmail.com",
	    port: 465,
	    ssl: true,
	    use_authentication: true,
	    user: "my.username@gmail.com",
	    pass: "my.password"
	}

### TLS Support (port 587)

If you want to use TLS/STARTTLS (port 587), leave *ssl* to false or do not set it, encryption will be started automatically when needed.

    nodemailer.SMTP = {
        host: "smtp.gmail.com",
        port: 587,
        ssl: false,
        use_authentication: true,
        user: "my.username@gmail.com",
        pass: "my.password"
    }

E-mail Message Fields
--------------------

The following are the possible fields of an e-mail message:

  - **sender** - The e-mail address of the sender. All e-mail addresses can be plain `sender@server.com` or formatted `Sender Name <sender@server.com>`
  - **to** - Comma separated list of recipients e-mail addresses that will appear on the `To:` field
  - **cc** - Comma separated list of recipients e-mail addresses that will appear on the `Cc:` field
  - **bcc** - Comma separated list of recipients e-mail addresses that will appear on the `Bcc:` field
  - **reply_to** - An e-mail address that will appear on the `Reply-To:` field
  - **subject** - The subject of the e-mail
  - **body** - The plaintext version of the message
  - **html** - The HTML version of the message
  - **attachments** - An array of attachment objects. Attachment object consists of two properties - `filename` and `contents`. Property `contents` can either be a String or a Buffer (for binary data). `filename` is the name of the attachment.

There's an optional extra field **headers** which holds custom header values in the form of `{key: value}`. These values will not overwrite any existing header but will be appended to the list. 

    mail_data = {
        sender:"me@example.com",
        to:"you@example.com",
        ....
        headers: {
            'X-My-Custom-Header-Value': 'Visit www.example.com for more info!'
        }
    }

For debugging set **debug** to true - then all the data passed between the client and the server will be output to console.

Address Formatting
------------------

All the e-mail addresses can be plain e-mail address

    username@example.com
    
or with formatted name (includes unicode support)

    "Ноде Майлер" <username@example.com>
    
To, Cc and Bcc fields accept comma separated list of e-mails. Formatting can be mixed.

    username@example.com, "Ноде Майлер" <username@example.com>, User Name <username@example.com>

Currently you can't use comma in a formatted name, even if the name is in quotes.


Creating HTML messages
----------------------

Message body in HTML format can be set with the message field `html`. If property `html` has contents but plain text alternative `body` has not (is left to empty), then existing text from the html version is also used in the plaintext version (without the html formatting). 

The charset for `html` is UTF-8.

    nodemailer.send_mail({
        ...
        html: "<p>hello world!<br/>хелло ворлд!</p>"
    });

Using Attachments
-----------------

An e-mail message can include one or several attachments. Attachments can be set with the message field `attachments` which accepts a list of attachment objects.

An attachment object primarly consists of two properties - `filename` which is the name of the file (not a filepath to an actual file on disk etc.) that will be reported to the receiver as the attachments name; and `contents` to hold the data in a String or Buffer format.
There's an additional property `cid`  which can be used for embedding images in a HTML message.

Property `filename` is unicode safe.

    var attachment_list = [
        {
            "filename": "attachment1.txt",
            "contents": "contents for attachment1.txt"
        },
        {
            "filename": "аттачмент2.bin",
            "contents": new Buffer("binary contents", "binary");
        }
    ];
    
    nodemailer.send_mail({
        ...
        attachments: attachment_list
    });

Using Embedded Images
---------------------

Attachments can be used as embedded images in the HTML body. To use this feature, you need to set additional property
of the attachment - `cid` (unique identifier of the file) which is a reference to the attachment file.
The same `cid` value must be used as the image URL in HTML (using `cid:` as the URL protocol, see example below).

**NB!** the cid value should be as unique as possible!

    var cid_value = Date.now()+".image.jpg";
    var html = 'Embedded image: <img src="cid:'+cid_value+'" />';
    var attachments = [{
        filename: "image.png",
        contents: IMAGE_CONTENTS,
        cid: cid_value
    }];

Issues
------

Use [Nodemailer Issue tracker](https://github.com/andris9/Nodemailer/issues) to report additional shortcomings, bugs, feature requests etc.

### Charsets

Currently the only allowed charset is UTF-8.

### Attachments

Do not use large attachments as the attachment contents are read into memory and the final message body is combined into one large string before sending.

Contributors
------------

See [Nodemailer/contributors](https://github.com/andris9/Nodemailer/contributors) for a live list

License
-------

**Nodemailer** is licensed under [MIT license](https://github.com/andris9/Nodemailer/blob/master/LICENSE). Basically you can do whatever you want to with it.