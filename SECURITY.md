# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, use GitHub's private "Report a vulnerability" form on the repository's Security tab, or email the maintainer listed in [`package.json`](package.json).

Include:

- a clear description of the issue,
- steps to reproduce,
- the impact you observed,
- any suggested fix (optional).

You'll get an initial response within 7 days.

## Supported versions

Only the latest `main` branch is supported. Security fixes will be released as a new minor version.

## Operational notes

- **Never commit your `.env`.** It is gitignored by default. Rotate any token that has been pushed by accident.
- The REST API uses a single shared `API_KEY`. Treat it as a secret and rotate it if leaked.
- The Telegram webhook path includes the bot token. Always serve it over HTTPS.
- Uploaded files are written to `uploads/` and deleted after dispatch. Run the process with a least-privileged user (the Dockerfile does this).
