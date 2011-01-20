
var mail = require("./mail");

mail.SMTP = {
    host: "smtp.zone.ee",
    port: 25,
    hostname: "node.ee",
    use_authentication: true,
    user: "test@kreata.ee",
    pass: "Kreata123"
}

var message = {
    sender: "andris r. <andris@tr.ee>",
    to:"Andris Reinman <andris@kreata.ee>, andmekala@hot.ee",
    subject: "Täpitähed lähevad läbi!",
    
    body: "abc öäõü",
    html:"<p><b>tere tere öäõü</b></p>",
    
    attachments:[
        {
            filename: "möirakaru.txt",
            contents: "tere jõgeva!"
        },
        {
            filename: "tabel.csv",
            contents: new Buffer("nodemailer, v0.1, 2011", 'utf-8')
        }
    ]
}

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

mail.send_mail(message, callback);

