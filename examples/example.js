
var nodemailer = require("../lib/mail");

// Set up SMTP server settings
// NB! Authentication only works if the server doesn't require auth over TLS
nodemailer.SMTP = {
    host: "smtp.example.com",
    port: 25,
    hostname: "myhost.com",
    use_authentication: false,
    user: "",
    pass: ""
}

// Message object
var message = {
    sender: 'Example Test <test@example.com>',
    to: '"My Name" <mymail@example.com>',
    subject: "Nodemailer is unicode friendly ✔",
    
    body: "Hello to myself!",
    html:"<p><b>Hello</b> to myself <img src=\"cid:unique-id-of-the-image\"/></p>",
    
    attachments:[
        {
            filename: "notes.txt",
            contents: "Some notes about this e-mail"
        },
        {
            filename: "image.png",
            contents: new Buffer("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/"+
                                 "//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U"+
                                 "g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC", "base64"),
            cid: "unique-id-of-the-image"
        }
    ]
}

// Callback to be run after the sending is completed
var callback = function(error, success){
    if(error){
        console.log("Error occured");
        console.log(error.message);
        return;
    }
    if(success){
        console.log("Message sent successfully!");
    }else{
        console.log("Message failed, reschedule!");
    }
}

// Send the e-mail
nodemailer.send_mail(message, callback);

