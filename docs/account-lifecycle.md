# Accounts: signup, sign-in, and recovery

[All guides](README.md) · [Microsoft setup](microsoft-sign-in.md) · [Security](../SECURITY.md)

## What happens when someone creates an account

1. On **Sign up**, enter a first name, last name, email, and matching passwords. Passwords must contain 15–128 characters. Use a personal, work, or school email; common disposable email providers are blocked.
2. Hosted signup sends a six-digit verification code through the configured email provider. The page explains that existing account holders will be guided to login or password reset after verification. No account or browser login exists yet. Codes expire in five minutes, allow three incorrect attempts, and can be resent after a minute. A replacement code invalidates the old one.
3. A correct code creates an account in the installation's metadata repository. The repository keeps the name, normalized unique email, and a salted PBKDF2 password hash. It does not store the original password. A browser receives an HttpOnly login cookie and a CSRF token for account/data changes.
4. If that email already belongs to an account, successful mailbox verification displays **Log in** and **Reset password**. It does not replace the existing password, create another account, or sign into the existing account. The initial signup response does not disclose whether the email is registered.
5. The app opens **Choose your database**, or **Teams** if the person followed an invitation. A personal workspace is provisioned when workspace/database services first load. A new account starts without shared database permissions. Creating or uploading a database adds it to the selected workspace; joining a team requires the invitation's matching email and code.
6. The account, saved sessions, and request history remain in this installation. A locally created account is separate from a hosted account. Signing out ends the browser login without deleting saved databases or history.

For local development, verification is optional unless `GENIE_VERIFY_EMAIL=true` is set. Without verification, valid signup creates the account immediately. Do not use that mode for a hosted public registration flow.

## Password attempts and login lifetime

Three unsuccessful password checks lock further checks for that email for the remainder of a 15-minute window, including requests from another address. Password login, current-password confirmation, and Microsoft linking share this limit. Successful verification clears that account's failure counters. There is also a 30-request login budget per client address and a five-request registration budget per client address per 15 minutes; these IP budgets are not cleared by success. HTTP 429 includes `Retry-After`.

Browser login lasts up to 12 hours and expires after 30 minutes without activity. Changing a password revokes other browser logins and agent connections. API keys and MCP/OAuth permissions still depend on the account's current workspace role and database grants.

## Forgot password

Choose **Forgot password?** on **Log in**, enter the email, and submit. The app always returns the same generic message and HTTP 202 for a valid request, whether a password account exists, the address is unknown, Microsoft is the only sign-in method, or email delivery fails. Request throttling applies to every address without consulting account presence.

A password account receives a link to **Choose a new password**. The link expires in 15 minutes and works once. Requesting another link replaces the previous link. Reset secrets are stored only as hashes and travel in a URL fragment, which is removed from the address bar when the page opens. The new password must meet the normal policy and be entered twice. A successful reset signs out all browser logins, revokes agent connections, clears the account password lockout, and returns the person to ordinary login; it does not sign them in automatically. Microsoft-only accounts continue to sign in with Microsoft.

Recovery requires a functioning email provider. Delivery runs in a bounded background queue so email-provider latency does not expose whether an account exists. Workers never access the repository. The generic response deliberately does not reveal delivery failures to the requester. A server restart can discard queued messages; request a fresh link if instructions do not arrive, and check provider delivery logs. Tokens and full recovery links must never be logged or shared.

## Server configuration

Use the existing `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` settings for signup verification and recovery. Keep the key on the server. Hosted recovery links use `GENIE_PUBLIC_URL` (or the configured Azure hostname); local links use the server's validated local origin. Recovery does not require a second email service.

New registration rejects a small maintained list of common disposable providers, including the reported `aiqseo.com`. Add comma-separated domains in `GENIE_BLOCKED_EMAIL_DOMAINS`; subdomains are also blocked. For an organization-only deployment, set comma-separated exact domains in `GENIE_ALLOWED_EMAIL_DOMAINS`. Leave that setting empty to accept normal personal, business, and education addresses, including Gmail and Outlook. These rules apply to new password and Microsoft accounts; they do not block login or password recovery for an account created before the policy changed. A blocklist cannot recognize every newly created disposable provider; mailbox verification proves access rather than someone's employment or identity.

Microsoft sign-in is already supported on both signup and login, and account settings can link it to an existing password account. The button appears only when server-side Entra configuration is available. Follow [Microsoft sign-in](microsoft-sign-in.md) for the app registration, callback, secrets, and interactive verification steps.
