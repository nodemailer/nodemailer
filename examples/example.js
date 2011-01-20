
var mail = require("../lib/mail");

// Set up SMTP server settings
// NB! Authentication only works if the server doesn't require auth over TLS
mail.SMTP = {
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
    html:"<p><b>Hello</b> to myself</p>",
    
    attachments:[
        {
            filename: "notes.txt",
            contents: "Some notes about this e-mail"
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
mail.send_mail(message, callback);

