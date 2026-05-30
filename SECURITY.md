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
   the discussion private until a fix is published and lets us credit you.
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

Nodemailer is maintained by a single person, so there is no guaranteed response
time — sometimes reports are handled within hours, sometimes they take longer.
Accepted issues are fixed in a new release and coordinated through a GitHub
Security Advisory, and reporters who wish to be named are credited.

## CVEs

We track and disclose vulnerabilities through GitHub Security Advisories. We do
not request or manage CVE identifiers ourselves. If you need a CVE assigned for a
reported issue, please request one yourself — for example, through GitHub's own
CVE request flow on the published advisory, or another CNA.

## Scope

In scope: the `nodemailer` package source in this repository — message and MIME
generation, SMTP/LMTP client behaviour, address parsing, header handling, DKIM
signing, and the bundled transports.

Out of scope: vulnerabilities in your own application code, misconfiguration of
your mail server or credentials, social-engineering reports, and issues in
third-party services Nodemailer connects to.

Thank you for helping keep Nodemailer and its users safe.
