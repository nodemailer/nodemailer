/*
 * This is a collection of well known SMTP service providers
 */

module.exports = {
    "Gmail":{
        host: "smtp.gmail.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true
    },
    "Yahoo":{
        host: "smtp.mail.yahoo.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true
    },
    "Hotmail":{
        host: "smtp.live.com",
        port: 587,
        requiresAuth: true
    },
    "hot.ee":{
        host: "mail.hot.ee",
        requiresAuth: true
    },
    "mail.ee":{
        host: "smtp.mail.ee",
        requiresAuth: true
    },
    "SES":{
        host: "email-smtp.us-east-1.amazonaws.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true
    },
    "Zoho":{
        host: "smtp.zoho.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true
    },
    "iCloud":{
        host:"smtp.mail.me.com",
        port: 587,
        requiresAuth: true
    },
    "SendGrid":{
        host: "smtp.sendgrid.net",
        port: 587,
        requiresAuth: true
    },
    "Postmark":{
        host: "smtp.postmarkapp.com",
        port: 25,
        requiresAuth: true
    }
};