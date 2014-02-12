var testCase = require('nodeunit').testCase,
    nodemailer = require("../lib/nodemailer"),
    Transport = nodemailer.Transport,
    stripHTML = require("../lib/helpers").stripHTML,
    fs = require("fs");

var TMP_DIR = "/tmp",
    SENDMAIL_OUTPUT = TMP_DIR + "/nodemailer-sendmail-test";

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
            mailOptions = {
                name: "test.host"
            };

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            var regex = "^Message\\-Id:\\s*<[0-9\.a-fA-F]+@test\.host>$";
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
        });
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
    },

    "Default X-Mailer value": function(test){
        var transport = nodemailer.createTransport("Stub"),
            mailOptions = {};

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/^X\-Mailer: Nodemailer/im));
            test.done();
        });
    },

    "Custom X-Mailer value": function(test){
        var transport = nodemailer.createTransport("Stub",{
                xMailer: "TEST"
            }),
            mailOptions = {};

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(response.message.match(/^X\-Mailer: TEST$/im));
            test.done();
        });
    },

    "Missing X-Mailer value": function(test){
        var transport = nodemailer.createTransport("Stub",{
                xMailer: false
            }),
            mailOptions = {};

        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            test.ok(!response.message.match(/^X\-Mailer:/im));
            test.done();
        });
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

exports["Sendmail transport"] = {
    "MessageId value in response": function(test){
        var transport = nodemailer.createTransport("Sendmail", {
                path: "test/mock/sendmail"
            }),
            mailOptions = {};

        try{
            fs.unlinkSync(SENDMAIL_OUTPUT);
        }catch(E){};
        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            try{
                fs.unlinkSync(SENDMAIL_OUTPUT);
            }catch(E){
                test.ifError(E);
            };
            test.ok(response.messageId);
            test.done();
        })
    },

    "Path as string parameter": function(test){
        var transport = nodemailer.createTransport("Sendmail", "test/mock/sendmail"),
            mailOptions = {};

        try{
            fs.unlinkSync(SENDMAIL_OUTPUT);
        }catch(E){};
        transport.sendMail(mailOptions, function(error, response){
            test.ifError(error);
            fs.readFile(SENDMAIL_OUTPUT, function(error, mail) {
                try{
                    fs.unlinkSync(SENDMAIL_OUTPUT);
                }catch(E){
                    test.ifError(E);
                };
                test.ifError(error);
                test.ok(mail.toString());
                test.done();
            })
        })
    },

    "Transform line endings": function(test){
        var transport = nodemailer.createTransport("Sendmail", {path: "test/mock/sendmail"}),
            mailOptions = {
                html: "Lorem Ipsum is simply dummy text of the printing and typesetting industry."+
                      "Lorem Ipsum has been the industry's standard dummy text ever since the 1500s."
            };

        try{
            fs.unlinkSync(SENDMAIL_OUTPUT);
        }catch(E){};
        transport.sendMail(mailOptions, function(error, response){
            fs.readFile(SENDMAIL_OUTPUT, function(error, mail) {

                try{
                    fs.unlinkSync(SENDMAIL_OUTPUT);
                }catch(E){
                    test.ifError(E);
                };

                test.ok(!/\r\n/.test(mail.toString()))
                test.done();
            })
        });
    }
};

exports["Pickup transport"] = {
    Pickup: function(test){
        var mailOptions = {
                subject: "pickup test",
                text: "pickup body",
                messageId: "test-id"
            },
            transport = nodemailer.createTransport("Pickup", {
                directory: TMP_DIR
            });

        transport.sendMail(mailOptions, function(err, response){
            test.ifError(err);
            try{
                fs.unlinkSync(TMP_DIR + "/" + mailOptions.messageId + ".eml");
            }catch(E){
                test.ifError(E);
            }
            test.equal(response.messageId, mailOptions.messageId);
            test.done();
        });
    },

    "Shorthand config": function(test){
        var mailOptions = {
                subject: "pickup test",
                text: "pickup body",
                messageId: "test-id"
            },
            transport = nodemailer.createTransport("Pickup", TMP_DIR);

        transport.sendMail(mailOptions, function(err, response){
            test.ifError(err);
            try{
                fs.unlinkSync(TMP_DIR + "/" + mailOptions.messageId + ".eml");
            }catch(E){
                test.ifError(E);
            }
            test.equal(response.messageId, mailOptions.messageId);
            test.done();
        });
    },

    "No callback": function(test){
        var mailOptions = {
                subject: "pickup test",
                text: "pickup body",
                messageId: "test-id"
            },
            transport = nodemailer.createTransport("Pickup", TMP_DIR);

        transport.sendMail(mailOptions);

        setTimeout(function(){
            test.ok(1);
            test.done();
        }, 2000);
    }
}

module.exports["Custom transport type"] = {
    "Define transport": function(test){
        test.expect(3);

        function MyTransport(options){
            this.options = options;
            test.ok(true);
        }

        MyTransport.prototype.sendMail = function(emailMessage, callback){
            test.ok(true);
            emailMessage.streamMessage();
            emailMessage.on("end", function(){
                callback(null, true);
            });
        }

        var transport = nodemailer.createTransport(MyTransport);
        transport.sendMail({text: "hello world!"}, function(err, response){
            test.equal(transport.transportType, "MYTRANSPORT");

            transport.close(function(){
                test.done();
            });
        });
    },

    "Close transport": function(test){
        test.expect(2);

        function MyTransport(options){
            this.options = options;
        }

        MyTransport.prototype.sendMail = function(emailMessage, callback){
            test.ok(true);
            callback();
        }

        MyTransport.prototype.close = function(callback){
            test.ok(true);
            callback();
        }

        var transport = nodemailer.createTransport(MyTransport);
        transport.sendMail({text: "hello world!"}, function(err, response){
            transport.close(function(){
                test.done();
            });
        });
    }
};

