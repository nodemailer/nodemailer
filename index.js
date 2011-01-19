
var SMTPClient = require("./smtp").SMTPClient;


var smtpclient = new SMTPClient("smtp.zone.ee", 25, {
    hostname: "node.ee",
    use_authentication: true,
    user: "test@kreata.ee",
    pass: "Kreata123"
});

smtpclient.on("error", function(error){
    console.log("Error occured")
    console.log(error.message);
});

var mail_data = {
    from: "andmekala@hot.ee",
    to: "andris.reinman@gmail.com",
    headers:[
        "From: andmekala@hot.ee",
        "To: andris.reinman@gmail.com"
    ],
    subject: "test message",
    body: "tere tere\r\nvana kere!"
}

var commands = [];
commands.push("MAIL FROM:<"+mail_data.from+">");
commands.push("RCPT TO:<"+mail_data.to+">");
commands.push("DATA");


function execute(callback){
    var command = commands.shift();
    if(command){
        smtpclient.send(command, function(error, message){
            if(!error){
                //console.log("Command '"+command+"' sent, response:\n"+message);
                execute(callback);
            }else{
                console.log("Command '"+command+"' ended with error\n"+error.message);
                smtpclient.connection.end();
            }
        });
    }else
        send_body(callback);
}

function send_body(callback){
    
    var headers = [];
    for(var i=0; i<mail_data.headers.length; i++){
        headers.push(mail_data.headers[i]);
    }
    headers.push("Subject:"+mail_data.subject);
    smtpclient.send(headers.join("\r\n")+"\r\n");
    
    smtpclient.send(mail_data.body);
    smtpclient.send("\r\n.", function(error, message){
        if(!error){
            console.log("Message sent, response:\n"+message);
            smtpclient.send("QUIT", function(error, message){
                smtpclient.close();
                callback();
            });
            
        }else{
            console.log("Message ended with error\n"+error.message);
            // schedule resend
            smtpclient.close();
        }
    });
}

execute(function(){
    console.log("READY!");
    commands.push("MAIL FROM:<"+mail_data.from+">");
    commands.push("RCPT TO:<"+mail_data.to+">");
    commands.push("DATA");
    execute(function(){
        console.log("READY!");
        commands.push("MAIL FROM:<"+mail_data.from+">");
        commands.push("RCPT TO:<"+mail_data.to+">");
        commands.push("DATA");
        execute(function(){
            console.log("TRIPLE READY!")
        })
    })
});
