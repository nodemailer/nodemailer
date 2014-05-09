"use strict";

/*
 * This is a collection of well known SMTP service providers
 */

module.exports = {
    "Gmail":{
        transport: "SMTP",
        host: "smtp.gmail.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["gmail.com", "googlemail.com"]
    },
    "Yahoo":{
        transport: "SMTP",
        host: "smtp.mail.yahoo.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["yahoo.com"]
    },
    "Hotmail":{
        transport: "SMTP",
        host: "smtp.live.com",
        port: 587,
        requiresAuth: true,
        domains: ["hotmail.com", "outlook.com"],
        tls: {ciphers:'SSLv3'}
    },
    "hot.ee":{
        transport: "SMTP",
        host: "mail.hot.ee",
        requiresAuth: true,
        domains: ["hot.ee"]
    },
    "mail.ee":{
        transport: "SMTP",
        host: "smtp.mail.ee",
        requiresAuth: true,
        domains: ["mail.ee"]
    },
    "SES":{
        transport: "SMTP",
        host: "email-smtp.us-east-1.amazonaws.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true
    },
    "Zoho":{
        transport: "SMTP",
        host: "smtp.zoho.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        authMethod: 'LOGIN'
    },
    "iCloud":{
        transport: "SMTP",
        host:"smtp.mail.me.com",
        port: 587,
        requiresAuth: true,
        domains: ["me.com", "mac.com"]
    },
    "SendGrid":{
        transport: "SMTP",
        host: "smtp.sendgrid.net",
        port: 587,
        requiresAuth: true
    },
    "Mailgun":{
        transport: "SMTP",
        host: "smtp.mailgun.org",
        port: 587,
        requiresAuth: true,
        tls: {ciphers:'SSLv3'}
    },
    "Postmark":{
        transport: "SMTP",
        host: "smtp.postmarkapp.com",
        port: 25,
        requiresAuth: true
    },
    "yandex":{
        transport: "SMTP",
        host: "smtp.yandex.ru",
        port: 465,
        secureConnection: true,
        requiresAuth: true,
        domains: ["yandex.ru"]
    },
    "Mail.Ru":{
        transport: "SMTP",
        host: "smtp.mail.ru",
        port: 465,
        secureConnection: true,
        requiresAuth: true,
        domains: ["mail.ru"]
    },
    "DynectEmail":{
        transport: "SMTP",
        host:"smtp.dynect.net",
        port:25,
        requiresAuth: true
    },
    "Mandrill":{
        transport: "SMTP",
        host: "smtp.mandrillapp.com",
        port: 587,
        requiresAuth: true
    },
    "Mailjet":{
        transport: "SMTP",
        host: "in.mailjet.com",
        port: 587,
        requiresAuth: true
    },
    "QQ":{
        transport: "SMTP",
        host: "smtp.qq.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["qq.com"]
    },
    "QQex":{
        transport: "SMTP",
        host: "smtp.exmail.qq.com",
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        domains: ["exmail.qq.com"]
    },
    "Godaddy": {
        transport: "SMTP",
        host: "smtpout.secureserver.net",
        port: 25,
        requiresAuth: true
    },
    "GodaddyEurope": {
        transport: "SMTP",
        host: "smtp.europe.secureserver.net",
        port: 25,
        requiresAuth: true
    },
    "GodaddyAsia": {
        transport: "SMTP",
        host: "smtp.asia.secureserver.net",
        port: 25,
        requiresAuth: true
    },
    // https://www.fastmail.fm/help/remote_email_access_server_names_and_ports.html
    'FastMail': {
        transport: 'SMTP',
        host: 'mail.messagingengine.com',
        secureConnection: true,
        port: 465,
        requiresAuth: true,
        // and many more: https://www.fastmail.fm/help/signup_domains.html
        domains: ['fastmail.fm']
    },
    "SendCloud": {
        transport: "SMPT",
        host: "smtpcloud.sohu.com",
        port: 25,
        requiresAuth: true
    },
    // http://help.aol.com/help/microsites/microsite.do?cmd=displayKC&externalId=73332
    "AOL":{
        transport: "SMTP",
        host: "smtp.aol.com",
        port: 587,
        requiresAuth: true,
        domains: ["aol.com"]
    }
};
