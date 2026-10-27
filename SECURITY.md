# Security

Security fixes target the latest code on the `dev` branch.

## Report a vulnerability

Please use **Security and quality → Advisories → Report a vulnerability** on [GitHub](https://github.com/blueraymusic/Data-Genie/security/advisories) to report an issue privately. Include the affected commit, steps to reproduce it, and the possible impact.

If private reporting is unavailable, open an issue asking for a private contact without publishing vulnerability details. Never include real passwords, API keys, or database records in a report.

## Local setup

- Keep the server bound to `127.0.0.1`. This app is designed for local use.
- Keep API keys in `.env`. Local databases, accounts, and configuration are excluded from Git.
- Review generated SQL before confirming a database change.
- Keep Python, Node.js, and npm dependencies up to date.
