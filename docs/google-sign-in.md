# Google sign-in

The hosted account pages offer **Sign up with Google** and **Continue with Google** alongside email and password. Self-hosted installations can enable it with server-side OAuth configuration. It uses Google's OpenID Connect authorization-code flow on the existing Python server. This setup does not enable Google Cloud Billing, Firebase Authentication, Identity Platform, or any paid Google API. Existing Azure hosting and Key Vault metering remain unchanged.

## Create the OAuth client

In [Google Auth Platform](https://console.cloud.google.com/auth/overview), select a project you manage. Keep it separate from Azure deployment identities. A university or company account can restrict project creation or third-party apps; use an account with the required project permissions rather than purchasing an upgrade.

1. Configure **Branding** with the Data Genie name, a support email you control, and developer contact details. Add `data-genie.space` as an authorized domain and `https://data-genie.space/` as the homepage. Provide the site's accurate public privacy policy before publishing branding. Verify domain ownership through Google Search Console if Google requests it. Do not invent a policy URL.
2. Set **Audience** to **External** for personal and Google Workspace accounts. **Internal** limits sign-in to the project's organization. For public rollout, review the **In production** publishing status and complete any requested brand verification. Google distinguishes publishing the app from verifying and publishing its displayed brand.
3. Under **Data Access**, request only `openid`, `email`, and `profile`. Do not request Gmail, Drive, Calendar, offline access, or cloud-resource permissions. These authentication scopes are non-sensitive. Google's documented testing restrictions have an exception for this exact authentication-only scope set; adding other scopes can introduce test-user limits, warnings, expiring authorizations, and additional verification.
4. Under **Clients**, create a **Web application** client named **Data Genie sign-in**. Add this exact **Authorized redirect URI**:

   ```text
   https://data-genie.space/api/auth/google/callback
   ```

   This is a server redirect flow, not a browser token flow. No JavaScript origin or Google frontend script is required by this implementation. Do not add wildcards or a trailing slash to the callback.
5. Save the client ID and client secret privately. The ID ends in `.apps.googleusercontent.com`. Google may show the secret only at creation; save it directly into your secret manager or sensitive deployment configuration. Do not paste it into chat, Git, a command line, or frontend configuration.

Use [Google's current audience rules](https://support.google.com/cloud/answer/15549945) and [brand verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) when reviewing production availability. Non-sensitive sign-in scopes do not require sensitive/restricted-scope verification. Brand verification can still be required to display the app name or logo. Workspace administrators and Advanced Protection can independently block an app.

## Configure the server

Use these **Terraform-category variables** in the existing HCP Terraform `Data-Genie` workspace:

| Terraform variable | Azure app setting | Value |
| --- | --- | --- |
| `google_client_id` | `GENIE_GOOGLE_CLIENT_ID` | Web application client ID |
| `google_client_secret` | `GENIE_GOOGLE_CLIENT_SECRET` | Client secret; mark **Sensitive** |
| `google_redirect_uri` | `GENIE_GOOGLE_REDIRECT_URI` | `https://data-genie.space/api/auth/google/callback` |

Alternatively use a sensitive `TF_VAR_google_client_secret` environment variable. Choose one variable category per setting. Keep auto apply disabled and inspect the infrastructure plan before applying. Preserve `sql_state_tier=basic`, the existing SQL password, and the connection encryption key. Enabling sign-in must not recreate databases or change the hosting tier.

Terraform stores the Google secret in the existing Key Vault under `google-secret`; the app setting contains its versionless Key Vault reference. Sensitive Terraform variables still live in private state. Restrict workspace, state, and app-setting access. Setting Azure app settings manually requires matching Terraform variables before its next apply, otherwise Terraform can remove them. App-setting changes restart the application.

Microsoft sign-in is retired. Its old Terraform inputs and historical `microsoft-secret` resource remain only to avoid deleting secrets from existing state. They no longer produce Microsoft runtime app settings. No Azure deployment identity or Microsoft-based agent connection is removed by this change.

`GET /api/auth/providers` reports whether Google is configured, without exposing credentials. A working Google button requires valid server configuration. The local signup page shows when Google is unavailable, and email/password continues to work.

## Accounts and linking

A Google identity is matched by its signed issuer and stable subject, never automatically by an email match. New Google accounts require a verified Gmail address or a verified managed Google Workspace address. A third-party email merely registered as a Google Account does not satisfy that new-account rule. Disposable-domain and optional organization-allowlist rules also apply to new accounts.

If Data Genie already has a password account with the same email, continue signing in with its password. The Account page has no Google linking control. Previously linked Google identities continue to open the same account, even if the Google email changes. Google-only accounts sign in through Google. Signing out ends the Data Genie browser session.

## Verify locally and after deployment

Use a separate development Web client when possible. Register `http://localhost:8000/api/auth/google/callback` exactly and set the three `GENIE_GOOGLE_` values privately in `.env`. Open the same `localhost` origin. The Python server handles the callback; a frontend-only Vite server cannot exchange the authorization code. If a different port is used, register and configure that exact callback.

Before public rollout, complete a real Google redirect and callback with a test account. Verify first signup, logout and repeat login, cancellation, rejected or unverified email, and an email collision with an existing password account. Confirm password login still works, the same saved workspace returns, and no Google access/ID tokens appear in browser storage or app logs. Automated boundary tests do not replace this real provider test.

## References

- [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect)
- [OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Manage app audience and publishing](https://support.google.com/cloud/answer/15549945)
- [OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
