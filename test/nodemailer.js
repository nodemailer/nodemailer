var testCase = require('nodeunit').testCase,
    nodemailer = require("../lib/nodemailer"),
    Transport = nodemailer.Transport,
    stripHTML = require("../lib/helpers").stripHTML;

exports["General tests"] = {

    "Create a new Nodemailer object": function(test){
        // this is more like a stub here
        var mail = new nodemailer.Nodemailer();
        test.done();
    },

    "stripHTML": function(test){

        var html = "<html><head><title>Title</title><style>h1{color:#fe57a1}</style></head><body><h1>Tere &raquo;</h1><ul><li>Test</li></ul></body></html>",
            output = "Tere »\n======\n\n  * Test";

        test.equal(stripHTML(html).trim(), output);
        test.done();
    },

    "generate XOAuthToken": function(test){
        nodemailer.createXOAuthGenerator({
            user: "test.nodemailer@gmail.com",
            consumerKey: "anonymous", // optional
            consumerSecret: "anonymous", // optional
            token: "1/O_HgoO4h2uOUfpus0V--7mygICXrQQ0ZajB3ZH52KqM",
            tokenSecret: "_mUBkIwNPnfQBUIWrJrpXJ0c",
            timestamp: "1332499914",
            nonce: "3595015741981970681"
        }).generate(function(err, token){
            test.equal(token, "R0VUIGh0dHBzOi8vbWFpbC5nb29nbGUuY29tL21haWwvYi90ZXN0Lm5vZGVtYWlsZXJAZ21haWwuY29tL3NtdHAvIG9hdXRoX2NvbnN1bWVyX2tleT0iYW5vbnltb3VzIixvYXV0aF9ub25jZT0iMzU5NTAxNTc0MTk4MTk3MDY4MSIsb2F1dGhfc2lnbmF0dXJlPSJZZkt4QlJHZnRkMUx0bk5LMXM5d25QUjM5UnclM0QiLG9hdXRoX3NpZ25hdHVyZV9tZXRob2Q9IkhNQUMtU0hBMSIsb2F1dGhfdGltZXN0YW1wPSIxMzMyNDk5OTE0IixvYXV0aF90b2tlbj0iMSUyRk9fSGdvTzRoMnVPVWZwdXMwVi0tN215Z0lDWHJRUTBaYWpCM1pINTJLcU0iLG9hdXRoX3ZlcnNpb249IjEuMCI=");
            test.done();
        });

    },

    "generate XOAuthToken with defaults": function(test){
        nodemailer.createXOAuthGenerator({
            user: "test.nodemailer@gmail.com",
            token: "1/O_HgoO4h2uOUfpus0V--7mygICXrQQ0ZajB3ZH52KqM",
            tokenSecret: "_mUBkIwNPnfQBUIWrJrpXJ0c",
            timestamp: "1332499914",
            nonce: "3595015741981970681"
        }).generate(function(err, token){
            test.equal(token, "R0VUIGh0dHBzOi8vbWFpbC5nb29nbGUuY29tL21haWwvYi90ZXN0Lm5vZGVtYWlsZXJAZ21haWwuY29tL3NtdHAvIG9hdXRoX2NvbnN1bWVyX2tleT0iYW5vbnltb3VzIixvYXV0aF9ub25jZT0iMzU5NTAxNTc0MTk4MTk3MDY4MSIsb2F1dGhfc2lnbmF0dXJlPSJZZkt4QlJHZnRkMUx0bk5LMXM5d25QUjM5UnclM0QiLG9hdXRoX3NpZ25hdHVyZV9tZXRob2Q9IkhNQUMtU0hBMSIsb2F1dGhfdGltZXN0YW1wPSIxMzMyNDk5OTE0IixvYXV0aF90b2tlbj0iMSUyRk9fSGdvTzRoMnVPVWZwdXMwVi0tN215Z0lDWHJRUTBaYWpCM1pINTJLcU0iLG9hdXRoX3ZlcnNpb249IjEuMCI=");
            test.done();
        });

    },

    "Use default Message-Id value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {};

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            var regex = "^Message\\-Id:\\s*<[0-9\.a-fA-F]+@"+nodemailer.X_MAILER_NAME.replace(/([\(\)\\\.\[\]\-\?\:\!\{\}])/g, "\\$1")+">$";
            test.ok(response.message.match(new RegExp(regex, "m")));
            test.done();
        })
    },

    "Use custom Message-Id value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                messageId: "ABCDEF"
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/Message\-Id:\s*<ABCDEF>/));
            // default not present
            var regex = "^Message\\-Id:\\s*<[0-9\.a-fA-F]+@"+nodemailer.X_MAILER_NAME.replace(/([\(\)\\\.\[\]\-\?\:\!\{\}])/g, "\\$1")+">$";
            test.ok(!response.message.match(new RegExp(regex, "m")));
            test.done();
        })
    },

    "Use custom Date value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                date: "Fri, 5 Nov 2012 09:41:00 -0800"
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/Date:\s*Fri, 5 Nov 2012 09:41:00 -0800/));
            // default not present
            test.ok(!response.message.match(/^Date:\s*[0-9\s:a-yA-Y]+\s+GMT$/m));
            test.done();
        })
    },

    "Use custom header value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            value = "a\r\n b\r\nc",
            mailOptions = {
                messageId: value,
                headers: {'test-key': value}
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            // should not be modified
            test.ok(response.message.match(/Test\-Key:\s*a\r\n b\r\nc/));
            // newlines should be removed
            test.ok(response.message.match(/Message\-Id:\s*<abc>/));
            test.done();
        })
    },

    "Use In-Reply-To": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                inReplyTo: "abc"
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/^In\-Reply\-To:\s*<abc>$/m));
            test.done();
        })
    },

    "Use References": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                references: ["abc def <ghi>", "jkl"]
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/^References:\s*<abc> <def> <ghi> <jkl>$/m));
            test.done();
        })
    },

    "Skip Message-Id value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                messageId: false
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(!response.message.match(/Message\-Id:/i));
            test.done();
        });
    },

    "Use custom envelope": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                from: "sender1@tr.ee",
                to: "receiver1@tr.ee",
                envelope: {
                    from: "sender2@tr.ee",
                    to: "receiver2@tr.ee",
                }
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.deepEqual(response.envelope, {from:'sender2@tr.ee',to: [ 'receiver2@tr.ee' ],stamp: 'Postage paid, Par Avion'})
            test.done();
        })
    },

    "Use default envelope": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {
                from: "sender1@tr.ee",
                to: "receiver1@tr.ee"
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.deepEqual(response.envelope, {from:'sender1@tr.ee',to: [ 'receiver1@tr.ee' ],stamp: 'Postage paid, Par Avion'})
            test.done();
        })
    }
};

exports["Transport close"] = {
    "SMTP - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SMTP", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },

    "SMTP - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SMTP", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    },
    "Sendmail - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("Sendmail", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },

    "Sendmail - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("Sendmail", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    },
    "SES - Callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SES", {});
        transport.close(function(){
            test.ok(true);
            test.done();
        });
    },

    "SES - No callback in transport.close": function(test){
        var transport = nodemailer.createTransport("SES", {});
        transport.close();
        process.nextTick(function(){
            test.ok(true);
            test.done();
        });
    }
};

exports["Options"] = {
    "Sendmail - when noCR is set to 'true', sendMail should set 'noCR:true'":function(test){
        var transport = nodemailer.createTransport("sendmail", {noCR:true});
        var options = {transport:new Transport("stub")};
        transport.sendMail(options, function(){
            test.ok(options.noCR);
            test.done();
        });
    },
    "SMTP - when noCR is set to 'true', sendMail should not set 'noCR:true'":function(test){
        var transport = nodemailer.createTransport("smtp", {noCR:true});
        var options = {transport:new Transport("stub")};
        transport.sendMail(options, function(){
            test.ok(!options.noCR);
            test.done();
        });
    }
};
