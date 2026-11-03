# Security

Security fixes target the latest code on the `dev` branch.

The public installation is [Data Genie](https://data-genie-blueray321.azurewebsites.net/). See its [FAQ](https://data-genie-blueray321.azurewebsites.net/faq) for account, data-storage, and connection behavior.

## Report a vulnerability

Please use **Security and quality → Advisories → Report a vulnerability** on [GitHub](https://github.com/blueraymusic/Data-Genie/security/advisories) to report an issue privately. Include the affected commit, steps to reproduce it, and the possible impact.

If private reporting is unavailable, open an issue asking for a private contact without publishing vulnerability details. Never include real passwords, API keys, or database records in a report.

## Accounts, data, and AI

- Accounts, History, and saved result rows belong to the Data Genie installation you use. Hosted accounts are separate from accounts on your laptop.
- Passwords are salted and hashed; the original password is not stored. Login expires after 30 minutes of inactivity or 12 hours in total. Changing a password signs out the other browser logins. This version has no email-based password recovery.
- The application repository contains private data and is not encrypted as a whole by Data Genie. Saved PostgreSQL connection settings are separately encrypted with Fernet. Keep the repository and its encryption key private and preserve both for recovery.
- Review generated SQL before confirming a database change.
- PostgreSQL connections are read-only by default. If you enable changes, confirmed edits affect the connected database directly and must also be allowed by its database user.
- When you use Ask, Data Genie sends the configured AI service your database structure and recent request, SQL, and clarification context. Saved connection credentials and result rows are not included. Values you type into requests are sent to the model.

## Local setup

- Keep the local development server bound to `127.0.0.1`.
- Keep API keys in `.env` or server environment variables. Local databases, accounts, keys, and configuration are excluded from Git.
- Without `GENIE_CONNECTION_KEY`, saved PostgreSQL settings use the owner-readable `data_genie_repository.sqlite3.key` file beside the repository. If you supply that environment key instead, preserve it separately; copying only the repository is not enough to restore saved connections.
- Keep Python, Node.js, and npm dependencies up to date.

## Hosted development setup

Use the documented WSGI entry point and [Azure hosting configuration](docs/azure-free-hosting.md), rather than exposing the local development server. Hosted operation validates the public HTTPS hostname, rejects cross-origin writes, uses CSRF tokens and Secure, HttpOnly login cookies, and blocks PostgreSQL connections to private, loopback, or cloud-metadata addresses. Hosted PostgreSQL connections require `sslmode=verify-full` and a public hostname.

Hosted SQLite executes on dedicated temporary scratch disk. Private account, History, working-database, and encrypted-connection files are saved as bounded snapshots in Azure SQL before the API response is released. A replacement worker restores the committed state. SQL transport verifies the certificate chain and hostname; a storage failure returns an error instead of falling back to an empty temporary database. External PostgreSQL changes and the application snapshot are separate transactions: after a storage error, check History and the connected database before repeating a change.

This serialized adapter is for a small student demo, with 64 MiB of total application state and 256 files across all accounts. The selected hosting tier is one Linux B1 instance; SQL retains its free offer and AutoPause. Review persistence and cost before increasing capacity.

Terraform state and Azure app settings contain the generated SQL password and connection-encryption key. The AI key is supplied through sensitive `TF_VAR_gemini_api_key` in HCP Terraform and `GEMINI_API_KEY` in the app. Restrict access to the workspace, state, and app settings; preserve the encryption key when restoring the installation.

The Terraform identity has Contributor only on `data_genie`. The separate DevOps identity has Reader on that resource group and Website Contributor only on this app, with federation limited to its deployment service connection. That identity can deploy code and read app settings, which gives application-level access to data and credentials. Authorize the service connection only for this pipeline. SQL firewall rules permit only the app's reviewed outbound addresses, with TLS and database authentication still required.

Deployment bundles exclude desktop accounts, databases, keys, backups, and `.env` files. Existing desktop data is not transferred automatically. Sign up on the [hosted site](https://data-genie-blueray321.azurewebsites.net/signup) and upload only the SQLite files you want to move.
