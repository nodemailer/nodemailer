
var nodemailer = require("../lib/mail");

// Set up SMTP server settings
// NB! Authentication only works if the server doesn't require auth over TLS
nodemailer.SMTP = {
    host: "smtp.gmail.com",
    port: 465,
    use_authentication: true,
    ssl: true,
    user: "your.username@gmail.com",
    pass: "your_gmail_password"
}

// unique cid value for the embedded image
var cid = Date.now()+".image.png";

// Message object
var message = {
    sender: 'Example Test <test@example.com>',
    to: '"My Name" <mymail@example.com>',
    subject: "Nodemailer is unicode friendly ✔",
    
    body: "Hello to myself!",
    html:"<p><b>Hello</b> to myself <img src=\"cid:"+cid+"\"/></p>",
    
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
            cid: cid
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

