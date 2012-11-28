var nodemailer = require('../lib/nodemailer');

// Create a SMTP transport object
var transport = nodemailer.createTransport("SMTP", {
        service: 'Gmail', // use well known service
        auth: {
            user: "test.nodemailer@gmail.com",
            pass: "Nodemailer123"
        }
    });

console.log('SMTP Configured');

// Message object
var message = { 
    
    // sender info
    from: 'Sender Name <sender@example.com>',
    
    // Comma separated list of recipients
    to: '"Receiver Name" <receiver@example.com>',
    
    // Subject of the message
    subject: 'Automatically embedded image', //
    
    // HTML body with image that will be converted to embedded attachment
    html:'<p>Embedded image: <img src="'+__dirname+'/nyan.gif"/></p>',
    
    forceEmbeddedImages: true
};

console.log('Sending Mail');
transport.sendMail(message, function(error){
    if(error){
        console.log('Error occured');
        console.log(error.message);
        return;
    }
    console.log('Message sent successfully!');
    
    // if you don't want to use this transport object anymore, uncomment following line
    //transport.close(); // close the connection pool
});