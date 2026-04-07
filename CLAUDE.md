# Nodemailer

E-mail sending library for Node.js. Zero runtime dependencies. Entry point is `lib/nodemailer.js`, which exposes `createTransport(transporter, defaults)` and routes to one of the bundled transports based on the options object.

## Layout

- `lib/nodemailer.js` — public entry, transport dispatch (`createTransport`).
- `lib/mailer/` — `Mail` class: the user-facing transport wrapper that normalizes messages, runs the DKIM signer, and hands off to the underlying transport's `.send()`.
- `lib/mail-composer/` + `lib/mime-node/` — message → MIME tree → raw RFC822 stream.
- `lib/smtp-connection/` — low-level SMTP/LMTP/ESMTP client. Hot path; security-sensitive. Used by `smtp-transport` and `smtp-pool`.
- `lib/smtp-transport/` — single-shot SMTP transport.
- `lib/smtp-pool/` — pooled SMTP transport with rate limiting.
- `lib/sendmail-transport/`, `lib/ses-transport/`, `lib/stream-transport/`, `lib/json-transport/` — alternate transports.
- `lib/dkim/`, `lib/addressparser/`, `lib/mime-funcs/`, `lib/base64/`, `lib/qp/`, `lib/punycode/`, `lib/well-known/`, `lib/xoauth2/`, `lib/fetch/`, `lib/shared/` — supporting modules.
- `test/` — mirrors `lib/` structure. Most suites spin up real `smtp-server` instances on ephemeral ports; raw `net` servers are used when byte-exact reply control is needed (e.g. injecting non-ASCII or invalid UTF-8).

Each transport must implement `name`, `version`, and `send(mail, callback)`. `Mail` discovers them via duck typing.

## Engine target

`engines.node = ">=6.0.0"`. The library is shipped as ES2017 script-mode CommonJS — no `import`, no top-level `await`, no optional chaining, no nullish coalescing, no class fields. ESLint enforces `ecmaVersion: 2017` and `sourceType: 'script'`. There is a Node 6 syntax-compat check (`npm run test:syntax`, runs `test/syntax-compat.js` inside `node:6-alpine`) that must keep passing — do not introduce syntax that breaks it. `'use strict';` directive at the top of every file.

## Conventions

- CommonJS only: `const x = require('...')`, `module.exports = ...`.
- Callback-first style throughout the public API. Many internals are still callback-based — match the style of the file you are editing rather than introducing promises mid-module.
- Prettier handles formatting; ESLint handles correctness. Run `npm run format` and `npm run lint` before sending changes. The lint config disables Prettier-overlapping rules.
- Snake_case is not used; camelCase for variables and methods, PascalCase for classes.
- Prefer small, surgical diffs. The codebase is mature and load-bearing — avoid drive-by refactors, comment churn, or "improvements" outside the scope of the change.
- Every change to security-sensitive code (anything in `lib/smtp-connection/`, address parsing, header generation, DKIM) needs tests that exercise the failure mode, not just the happy path.

## Testing

- `npm test` — full suite via `node --test` (~150s, 480+ tests, runs serially).
- `npm run test:coverage` — same suite under `c8`.
- `npm run test:syntax` — Node 6 syntax compatibility check in Docker.
- `npm run lint` / `npm run lint:fix`.
- `npm run format` / `npm run format:check`.

Always run `npm test` and `npm run lint` before considering a change done. Tests are required to pass on every commit because release-please cuts releases directly from `master`.

## Releases

Releases, version numbers, the `version` field in `package.json`, git tags, `CHANGELOG.md` entries, and npm publication are all managed automatically by the release-please GitHub Action (`.github/workflows/release.yaml`, configured by `.release-please-config.json`). **Never edit any of these manually and never propose manual edits to them.**

Release-please derives the next version and changelog from Conventional Commit messages on `master`, opens a release PR (`chore: release X.Y.Z [skip-ci]`), and publishes to npm with provenance when that PR is merged. The only thing that should land on `master` between releases is normal commits with Conventional Commit prefixes — release-please takes care of the rest.

Conventional Commit prefixes used in this repo: `fix:`, `feat:`, `chore:`, `docs:`, `refactor:`, `test:`. Use `fix:` for anything users would benefit from seeing in the changelog, including security fixes (reference the GHSA in the body).

## Security

This is a widely-deployed library — security-sensitive changes get extra scrutiny:
- SMTP command injection: any user-controllable value that flows into a written SMTP command (envelope addresses, sizes, the `name`/EHLO option, headers) must be CRLF-stripped or rejected at the boundary. Sanitize at the assignment, not at every call site.
- Server reply parsing in `lib/smtp-connection/index.js` uses a `'binary'` byte-container intermediate to reassemble multi-byte UTF-8 across socket chunks; the actual decode happens at line boundaries via `decodeServerResponse`. Don't change the chunk-buffering encoding without understanding why.
- Reference the GHSA ID in commit messages for advisories.
