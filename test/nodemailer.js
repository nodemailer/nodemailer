var testCase = require('nodeunit').testCase,
    nodemailer = require("../lib/nodemailer"),
    stripHTML = require("../lib/helpers").stripHTML;

exports["General tests"] = {
    
    "Create a new Nodemailer object": function(test){
        // this is more like a stub here
        var mail = new nodemailer.Nodemailer();
        test.done();
    },
    
    "stripHTML": function(test){
        
        var html = "<h1>Tere &raquo;</h1><ul><li>Test</li></ul>",
            output = "Tere »\n======\n\n  * Test";
        
        test.equal(stripHTML(html).trim(), output);
        test.done();
    }
};

exports["Transport close"] = {
    "SMTP - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SMTP", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },
    
    "SMTP - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SMTP", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    },
    "Sendmail - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("Sendmail", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },
    
    "Sendmail - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("Sendmail", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    },
    "SES - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SES", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },
    
    "SES - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SES", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    }
};