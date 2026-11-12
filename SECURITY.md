# Security

Security fixes target the latest code on the `dev` branch.

The public installation is [Data Genie](https://data-genie.space/). See its [FAQ](https://data-genie.space/faq) for account, data-storage, and connection behavior.

## Report a vulnerability

Please use **Security and quality → Advisories → Report a vulnerability** on [GitHub](https://github.com/blueraymusic/Data-Genie/security/advisories) to report an issue privately. Include the affected commit, steps to reproduce it, and the possible impact.

If private reporting is unavailable, open an issue asking for a private contact without publishing vulnerability details. Never include real passwords, API keys, or database records in a report.

## Accounts, data, and AI

- Accounts, History, and saved result rows belong to the Data Genie installation you use. Hosted accounts are separate from accounts on your laptop.
- Passwords are salted and hashed; the original password is not stored. Login expires after 30 minutes of inactivity or 12 hours in total. Changing a password signs out the other browser logins. This version has no email-based password recovery.
- Optional Microsoft sign-in identifies accounts by the verified issuer and subject. A matching email never links an existing account automatically; linking requires the current password from an authenticated account. Microsoft-only accounts have no usable local password. See [Microsoft sign-in setup](docs/microsoft-sign-in.md).
- Microsoft sign-in uses single-use, ten-minute state bound to a separate HttpOnly, SameSite=Lax browser cookie, PKCE, and signed ID-token validation (Microsoft signing key and issuer, audience, timestamps, and nonce). The normal app login stays SameSite=Strict. Provider tokens are discarded after verification, and request logs exclude query strings. Starts have a separate 30-attempt IP budget per 15 minutes; first-time Microsoft registrations also consume the registration budget.
- Account attempts use durable, atomic 15-minute budgets: five registrations per IP, 30 logins per IP across all emails, and five unsuccessful logins per IP/email pair. Valid, invalid and duplicate signup submissions consume the registration budget before password hashing. Successful login resets only its pair budget. Throttled requests return HTTP 429 and `Retry-After`; another IP has its own allowance.
- Duplicate signup uses generic wording. Signup still immediately creates a login on success, so its success status and cookie can reveal whether an address is available. Full signup enumeration resistance would require a different flow, such as email verification; this version does not claim it.
- The application repository contains private data and is not encrypted as a whole by Data Genie. Saved PostgreSQL connection settings are separately encrypted with Fernet. Keep the repository and its encryption key private and preserve both for recovery.
- Review generated SQL before confirming a database change.
- PostgreSQL connections are read-only by default. If you enable changes, confirmed edits affect the connected database directly and must also be allowed by its database user.
- When you use Ask, Data Genie sends the configured AI service your database structure and recent request, SQL, and clarification context. Saved connection credentials and result rows are not included automatically. Values you type, files you attach to Ask, and source notes you submit for AI reports are sent to the configured AI service. Ask allows two PDF/image files up to 4 MB combined; file bytes are not persisted in History. Generated SQL and summaries may contain information derived from them. MIME/signature checks are format checks, not malware scanning; files are never executed. Provider retention follows its own settings and terms.

## Local setup

- Keep the local development server bound to `127.0.0.1`.
- Keep API keys in `.env` or server environment variables. Local databases, accounts, keys, and configuration are excluded from Git.
- Without `GENIE_CONNECTION_KEY`, saved PostgreSQL settings use the owner-readable `data_genie_repository.sqlite3.key` file beside the repository. If you supply that environment key instead, preserve it separately; copying only the repository is not enough to restore saved connections.
- Keep Python, Node.js, and npm dependencies up to date.

## Hosted development setup

Use the documented WSGI entry point and [Azure hosting configuration](docs/azure-free-hosting.md), rather than exposing the local development server. Hosted operation validates the public HTTPS hostname, rejects cross-origin writes, uses CSRF tokens and Secure, HttpOnly login cookies, and blocks PostgreSQL connections to private, loopback, or cloud-metadata addresses. Hosted PostgreSQL connections require `sslmode=verify-full` and a public hostname.

On direct Azure App Service hosting, the WSGI adapter uses the platform-overwritten `Client-IP` header for auth limits, only when Azure process settings identify that deployment. It normalizes IP addresses and ports, ignores caller-supplied `X-Forwarded-For`, and shares one closed bucket if the Azure header is missing or invalid. Other deployments use the socket peer and ignore forwarding headers; another reverse proxy requires its own reviewed trust boundary. Gunicorn's `forwarded_allow_ips` controls scheme headers, not `REMOTE_ADDR`, and is not widened. See [Azure's header guarantees](https://github.com/Azure/app-service-linux-docs/blob/master/Things_You_Should_Know/headers.md).

These limits protect account creation and password work. Hosted API requests still open Azure SQL before checking the durable budget; they are not an edge traffic or billing cap.

Hosted SQLite executes on dedicated temporary scratch disk. Private account, History, working-database, and encrypted-connection files are saved as bounded snapshots in Azure SQL before the API response is released. A replacement worker restores the committed state. SQL transport verifies the certificate chain and hostname; a storage failure returns an error instead of falling back to an empty temporary database. External PostgreSQL changes and the application snapshot are separate transactions: after a storage error, check History and the connected database before repeating a change.

This serialized adapter is for a small student demo, with 64 MiB of total application state and 256 files across all accounts. The selected hosting tier is one Linux B1 instance; SQL retains its free offer and AutoPause. Review persistence and cost before increasing capacity.

Terraform state and Azure app settings contain the generated SQL password and connection-encryption key. The AI key is supplied through sensitive `TF_VAR_gemini_api_key` in HCP Terraform and `GEMINI_API_KEY` in the app. Restrict access to the workspace, state, and app settings; preserve the encryption key when restoring the installation.

When Microsoft sign-in is enabled, its separate client secret also stays in sensitive Terraform configuration and server app settings. It is never a frontend variable. Restrict access to it and rotate it before expiry; no Graph data access or Azure resource role is needed for user sign-in.

The Terraform identity has Contributor only on `data_genie`. The separate DevOps identity has Reader on that resource group and Website Contributor only on this app, with federation limited to its deployment service connection. That identity can deploy code and read app settings, which gives application-level access to data and credentials. Authorize the service connection only for this pipeline. SQL firewall rules permit only the app's reviewed outbound addresses, with TLS and database authentication still required.

Deployment bundles exclude desktop accounts, databases, keys, backups, and `.env` files. Existing desktop data is not transferred automatically. Sign up on the [hosted site](https://data-genie.space/signup) and upload only the SQLite files you want to move.

## Workspace reports

The server checks current membership before listing, saving, or generating a report. Viewers receive only reports marked shared; members receive shared reports and their own drafts, and owners can review all drafts. Only the owner may publish. Report text is rendered as plain text. Version checks reject conflicting saves. Reports and their contents are included in the installation’s private application-state backup; deleting a workspace removes its reports. Revoking database access does not retract an already shared report snapshot; the owner must unshare it separately.
## Agent access

The hosted `/mcp` transport uses the official MCP SDK and first-party OAuth authorization-code flow with S256 PKCE. The browser consent page shows the self-reported client name and registered callback address, requires a signed-in account and CSRF token, and grants only explicitly selected scopes for one workspace. Callback URIs use HTTPS or loopback HTTP; no callback metadata is fetched from user-supplied hosts. Dynamic client registration is bounded and rate limited. Client secrets are encrypted using the existing credential vault. One-use authorization codes expire after 60 seconds, access tokens after one hour, and grants after 30 days. Access and refresh tokens are stored only as hashes; refresh rotates both and invalidates the old pair. Tokens are bound to the `/mcp` resource and cannot authenticate the separate key-based HTTP API. Existing agent revocation and password-change revocation invalidate OAuth connections too. Remote MCP and OAuth protocol routes do not use browser cookies as bearer credentials.

Agent API routes require workspace-scoped bearer keys; browser cookies are not accepted. Keys are randomly generated, stored only as SHA-256 hashes, shown once, and expire within 90 days. Creation requires a signed-in browser, CSRF protection, and password confirmation. Changing a password revokes all of that account's agent keys.

Scopes never override live membership or database grants. Agent reads use the existing read-only SQL validation and execution path. Change preparation returns no confirmation secrets; approval remains in the signed-in site. Agents can save their own unpublished report drafts, but cannot publish, change grants, invite members, or create other credentials. Report generation uses the existing account budget.

Database actions recheck the key's workspace after waiting for the database lock, and keep that check protected through execution. Agent draft updates check authorship and publication state inside the same transaction as the save, so a concurrent database move or report publication cannot widen agent access.

Requests are limited per key and per client IP. Origin/Host checks remain in place; no cross-origin browser access is enabled. The optional stdio MCP bridge requires HTTPS except for loopback development, verifies certificates, rejects embedded URL credentials, and refuses redirects to prevent leaking bearer tokens. Store agent keys in private client settings, not chat messages, URLs, or Git. Revocation blocks subsequent requests; already-running work may finish.
