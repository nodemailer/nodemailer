/*
 * This is a collection of well known SMTP service providers
 */

module.exports = {
    "Gmail":{
        host: "smtp.gmail.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["gmail.com", "googlemail.com"]
    },
    "Yahoo":{
        host: "smtp.mail.yahoo.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["yahoo.com"]
    },
    "Hotmail":{
        host: "smtp.live.com",
        port: 587,
        requiresAuth: true,
        domains: ["hotmail.com", "outlook.com"]
    },
    "hot.ee":{
        host: "mail.hot.ee",
        requiresAuth: true,
        domains: ["hot.ee"]
    },
    "mail.ee":{
        host: "smtp.mail.ee",
        requiresAuth: true,
        domains: ["mail.ee"]
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
        requiresAuth: true,
        authMethod: 'LOGIN'
    },
    "iCloud":{
        host:"smtp.mail.me.com",
        port: 587,
        requiresAuth: true,
        domains: ["me.com", "mac.com"]
    },
    "SendGrid":{
        host: "smtp.sendgrid.net",
        port: 587,
        requiresAuth: true
    },
    "Mailgun":{
        host: "smtp.mailgun.org",
        port: 587,
        requiresAuth: true
    },
    "Postmark":{
        host: "smtp.postmarkapp.com",
        port: 25,
        requiresAuth: true
    },
    "yandex":{
        host: "smtp.yandex.ru",
        port: 465,
        secureConnection: true,
        requiresAuth: true,
        domains: ["yandex.ru"]
    },
    "Mail.Ru":{
        host: "smtp.mail.ru",
        port: 465,
        secureConnection: true,
        requiresAuth: true,
        domains: ["mail.ru"]
    },
    "DynectEmail":{
        host:"smtp.dynect.net",
        port:25,
        requiresAuth: true
    },
    "Mandrill":{
        host: "smtp.mandrillapp.com",
        port: 587,
        requiresAuth: true
    },
    "Mailjet":{
        host: "in.mailjet.com",
        port: 587,
        requiresAuth: true
    }
};
