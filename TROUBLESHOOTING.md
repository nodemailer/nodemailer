Nodemailer Troubleshooting Guide

This document provides solutions to the most common issues encountered when sending email with Nodemailer. It complements the main documentation found at https://nodemailer.com.

## Gmail Issues (Updated for 2025)

Google has significantly restricted SMTP usage. If Gmail is not working for you, this section explains why and what to do.

### 1. Gmail Username/Password Fails

    Common errors:

        535-5.7.8 Username and Password not accepted
        EAUTH
        “Sign-in attempt prevented”

This happens because Google no longer allows basic SMTP login for most accounts.

### Option A — Use OAuth2 (Recommended)

    auth: {
    type: 'OAuth2',
    user: 'you@gmail.com',
    clientId: 'GOOGLE_CLIENT_ID',
    clientSecret: 'GOOGLE_CLIENT_SECRET',
    refreshToken: 'GOOGLE_REFRESH_TOKEN'
    }

    This avoids blocked logins and works reliably.

### Option B — Use an App Password (Only if 2FA is enabled)

    Steps:

        Enable 2-Step Verification
        Go to: Google Account → Security
        “App Passwords” → Create → Choose “Mail”
        Use that generated password as your SMTP password

### Option C — Switch Providers

    Gmail is not designed for automation. If you continue to get blocked, use:

        SendGrid
        Mailgun
        AWS SES
        Postmark
        Resend

    These services accept automated SMTP/API usage without Google-style restrictions.

## ETIMEDOUT Errors

A timeout means Nodemailer cannot reach the SMTP server.

    Common Causes

        Firewall blocking port 587 or 465
        ISP blocking outbound SMTP (common on shared networks)
        Corporate networks with locked-down email ports
        Wrong hostname or port

        Things to Try

        Test connectivity:
                telnet smtp.example.com 587

        Try another network/hotspot
        Ensure antivirus is not inspecting traffic
        Confirm SMTP server accepts external connections

## TLS / Certificate Errors

TLS issues occur before authentication.

    ### 1. Wrong secure setting

        Use secure: true only for port 465
        For port 587 or 25, use secure: false

        // Correct for port 587
        secure: false

### 2. TLS version mismatch

        Node.js now requires TLS ≥ 1.2.
        If your server only supports TLS 1.1 or lower, add:

        tls: {
        minVersion: 'TLSv1.1'
        }

        Or preferably upgrade your server.

### 3. Antivirus MITM interference

Windows antiviruses often insert MITM certificates and break SMTP TLS.

    Fix:

    Disable email scanning in antivirus settings
    Or run Node in a controlled VM/container

### 4. Let's Encrypt certificate chain issues

Older Node.js versions may not trust newer LE chain certificates.

    Temporary workaround:

    tls: { rejectUnauthorized: false }

    Better solution: update Node.js.

## DNS / Hosts File Issues

Nodemailer uses c-ares DNS, not the OS resolver.
This means custom DNS routing on your system may be ignored.

    Steps to Fix

        Ensure DNS resolves both IPv4 and IPv6
        If your DNS setup is unusual, force an IP:

        host: '1.2.3.4', // SMTP server IP
        secure: true,
        tls: { servername: 'example.com' }

The servername option is required for proper certificate validation.

## Works on One Machine but Not Another

Usually caused by:

Different firewalls
Different network rules
One machine behind corporate restrictions
ISP-level SMTP blocks

Try:

Using a VPN
Using port 587 instead of 465
Testing on a different network

## SyntaxError Issues

If you see errors related to spread operators, destructuring, etc., upgrade Node.js.

Nodemailer supports Node ≥ 6, but many features expect Node ≥ 12 or higher.

## TypeScript Issues

Nodemailer does not maintain TypeScript typings.

All TypeScript issues belong to:
https://www.npmjs.com/package/@types/nodemailer

## Other Issues

If you have a problem not listed here, try:

StackOverflow (nodemailer tag)
The official docs: https://nodemailer.com
Checking if your SMTP credentials work in another client (Thunderbird, Outlook, etc.)

## Quick Diagnostic Checklist

Follow this checklist before debugging further:

    ✔ Is your SMTP hostname correct?
    ✔ Are you using the correct port?
    ✔ Are you using secure: true only for port 465?
    ✔ Does the server support TLS 1.2?
    ✔ Does your network block SMTP ports?
    ✔ Are you testing with correct credentials?
    ✔ Are you behind a corporate firewall?
    ✔ Are you using Gmail without OAuth2 or App Passwords?

## Example Known Good Configuration

    const transporter = nodemailer.createTransport({
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: {
        user: 'user@example.com',
        pass: 'password'
    },
    tls: {
        minVersion: 'TLSv1.2'
    }
    });
