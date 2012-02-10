var testCase = require('nodeunit').testCase,
    nodemailer = require("../lib/nodemailer");

exports["General tests"] = {
    
    "Create a new Nodemailer object": function(test){
        // this is more like a stub here
        var mail = new nodemailer.Nodemailer();
        test.done();
    }
}