# Security

Security fixes target the latest code on the `dev` branch.

## Report a vulnerability

Please use **Security and quality → Advisories → Report a vulnerability** on [GitHub](https://github.com/blueraymusic/Data-Genie/security/advisories) to report an issue privately. Include the affected commit, steps to reproduce it, and the possible impact.

If private reporting is unavailable, open an issue asking for a private contact without publishing vulnerability details. Never include real passwords, API keys, or database records in a report.

## Local setup

- Keep the server bound to `127.0.0.1`. This app is designed for local use.
- Keep API keys in `.env`. Local databases, accounts, and configuration are excluded from Git.
- Review generated SQL before confirming a database change.
- PostgreSQL connections are read-only by default. If you enable changes, confirmed edits affect the connected database directly and must also be allowed by its database user.
- PostgreSQL credentials are encrypted locally with a separate owner-readable key. Keep the repository and key private; both are needed to restore saved connections. Neither is included in Git.
- Accounts, history, and saved result rows live in the local SQLite repository. Passwords are salted and hashed, but the repository as a whole is not encrypted. Saved database credentials are not included in AI context; request text, schema, and recent conversation context are. Values you type into requests are included.
- Keep Python, Node.js, and npm dependencies up to date.

## Hosted development setup

Use the documented WSGI entry point and [Azure free-tier configuration](docs/azure-free-hosting.md), rather than exposing the local development server. Hosted operation validates the public HTTPS hostname, rejects cross-origin writes, sets Secure login cookies, and blocks PostgreSQL connections to private or cloud-metadata addresses. PostgreSQL requires certificate verification in hosted mode.

Cloud state snapshots contain private account/history/data files. They execute on dedicated scratch disk and are durably committed to Azure SQL before an API response is released. This bounded, serialized adapter is for a small student demo. Do not increase worker counts or capacity without reviewing its persistence and free-tier limits. Keep Azure SQL's free offer and AutoPause enabled; no paid fallback is part of this deployment.

Terraform state and Azure app settings contain the generated SQL password and connection-encryption key. Restrict their access, use resource-group-scoped OIDC identities for Terraform and DevOps, and preserve the encryption key for recovery. Deployment bundles exclude local accounts, databases, and `.env` files. Existing desktop data is never transferred automatically.
