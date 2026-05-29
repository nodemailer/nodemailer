# Security Policy

Nodemailer is a widely deployed, zero-dependency e-mail library. We take security
reports seriously and aim to respond quickly.

## Supported Versions

Security fixes are released only against the latest major version. We do not
backport patches to older majors — upgrading to the current release line is the
supported way to receive security updates.

| Version | Supported          |
| ------- | ------------------ |
| 8.x     | :white_check_mark: |
| < 8.0   | :x:                |

If you are on an older major, please upgrade. See the migration notes at
<https://nodemailer.com/> before updating.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Report privately through one of the following channels:

1. **GitHub Security Advisories (preferred).** Open a private report at
   <https://github.com/nodemailer/nodemailer/security/advisories/new>. This keeps
   the discussion private until a fix is published and lets us coordinate a CVE
   and credit you.
2. **Email.** Send details to **andris@reinman.eu** (the contact listed in
   [`SECURITY.txt`](SECURITY.txt)). Encrypt sensitive details if possible.

When reporting, please include as much of the following as you can:

- The affected version(s) and environment (Node.js version, OS).
- The component involved (e.g. SMTP connection, address parsing, MIME/header
  generation, DKIM).
- A clear description of the issue and its impact (e.g. header/SMTP command
  injection, information disclosure, DoS).
- A minimal proof of concept or reproduction steps.
- Any suggested remediation, if you have one.

## What to Expect

- **Acknowledgement:** we aim to confirm receipt within 5 business days.
- **Assessment:** we will investigate and let you know whether the report is
  accepted, needs more information, or is declined (with reasoning).
- **Fix and disclosure:** for accepted reports we will prepare a fix, publish a
  new release, and coordinate a GitHub Security Advisory / CVE. We are happy to
  credit reporters who wish to be named.
- **Updates:** we will keep you informed of progress as the fix moves toward
  release.

## Scope

In scope: the `nodemailer` package source in this repository — message and MIME
generation, SMTP/LMTP client behaviour, address parsing, header handling, DKIM
signing, and the bundled transports.

Out of scope: vulnerabilities in your own application code, misconfiguration of
your mail server or credentials, social-engineering reports, and issues in
third-party services Nodemailer connects to.

Thank you for helping keep Nodemailer and its users safe.
