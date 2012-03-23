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