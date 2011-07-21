var nodemailer = require('../lib/mail');

// Set up SMTP server settings
nodemailer.SMTP = {
    host: 'smtp.gmail.com',
    port: 465,
    use_authentication: true,
    ssl: true,
    user: undefined,
    pass: undefined,
    debug: true
}
console.log('SMTP Configured')
// unique cid value for the embedded image
var cid = Date.now() + '.image.png';

// Message object
var message = {
    sender: 'Sender Name <from@example.com>',
    to: '"Receiver Name" <to@example.com>',
    subject: 'Nodemailer is unicode friendly ✔',

    body: 'Hello to myself!',
    html:'<p><b>Hello</b> to myself <img src="cid:"' + cid + '"/></p>',
    debug: true,
    attachments:[
        {
            filename: 'notes.txt',
            contents: 'Some notes about this e-mail'
        },
        {
            filename: 'image.png',
            contents: new Buffer('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/' +
                                 '//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U' +
                                 'g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC', 'base64'),
            cid: cid
        }
    ]
}

// Callback to be run after the sending is completed
var callback = function(error, success){
    if(error){
        console.log('Error occured');
        console.log(error.message);
        return;
    }
    if(success){
        console.log('Message sent successfully!');
    }else{
        console.log('Message failed, reschedule!');
    }
}

console.log('Sending Mail')

// Catch uncaught errors
process.on('uncaughtException', function(e){
    console.log('Uncaught Exception', e.stack);
});

// Send the e-mail
var mail;
try{
    mail = nodemailer.send_mail(message, callback);
}catch(e) {
    console.log('Caught Exception',e);
}

var oldemit = mail.emit;
mail.emit = function(){
    console.log('Mail.emit', arguments);
    oldemit.apply(mail, arguments);
}
