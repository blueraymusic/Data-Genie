# Microsoft sign-in

Data Genie can offer **Continue with Microsoft** alongside email and password. This is optional and requires a Microsoft Entra app registration plus server configuration. It uses the existing App Service plan; no hosting-tier upgrade is needed.

## Register the application

In **Microsoft Entra ID → App registrations → New registration**:

1. Name the application **Data Genie sign-in**. Use a separate registration from the Terraform and DevOps deployment identities.
2. For personal and work/school accounts, select **Accounts in any organizational directory and personal Microsoft accounts** (`AzureADandPersonalMicrosoftAccount`). This matches the `common` authority. For a directory-only app, select that directory and use its tenant UUID instead.
3. Add a **Web** redirect URI: `https://data-genie.space/api/auth/microsoft/callback`. It must match the configured URI exactly. Do not choose SPA, enable implicit grants, or enable public-client flows.
4. Under **Certificates & secrets**, create a client secret. Save its **Value**, not the secret ID, directly in the sensitive configuration below. Note its expiry and rotate it before that date.
5. The application requests only `openid`, `profile`, and `email`. It does not need Graph `User.Read`, mail access, directory roles, or Azure resource permissions. Remove the default `User.Read` permission if the registration added it.

Your directory can require an administrator to register applications or approve sign-in. Azure subscription ownership does not override that directory policy. No tenant-wide admin consent or broad Graph permission is required by Data Genie itself; follow your organization's consent policy.

## Set the server variables

For HCP Terraform, use these **Terraform-category variables** in the `Data-Genie` workspace. Keep auto apply disabled, inspect the plan, and apply the reviewed app-setting change.

| Terraform variable | Azure app setting | Value |
| --- | --- | --- |
| `microsoft_client_id` | `GENIE_MICROSOFT_CLIENT_ID` | Application (client) ID from the new registration |
| `microsoft_client_secret` | `GENIE_MICROSOFT_CLIENT_SECRET` | Client secret **Value**; mark **Sensitive** |
| `microsoft_tenant` | `GENIE_MICROSOFT_TENANT` | `common`, or a specific directory's tenant UUID |
| `microsoft_redirect_uri` | `GENIE_MICROSOFT_REDIRECT_URI` | `https://data-genie.space/api/auth/microsoft/callback` |

Alternatively, use sensitive `TF_VAR_microsoft_client_secret` under **Environment variables**. Choose one variable category for each value. Never put the secret in a frontend `VITE_` variable, Git, chat, a command line, or a public output. Sensitive Terraform values still live in private state; restrict state, workspace, and Azure app-setting access.

If setting Azure app settings directly, preserve matching values in Terraform before the next apply. Otherwise, an infrastructure update can remove the manual configuration. App-setting changes restart the app; finish them before deploying code.

The button stays unavailable when the required configuration is missing or invalid. Current email/password login continues to work. The public `/api/auth/providers` endpoint exposes provider availability, never secrets.

## Accounts and linking

Microsoft identities are matched using their verified issuer and subject, not their email address. An existing Data Genie account is never claimed automatically because an email matches.

To add Microsoft to an existing password account, log in normally, open **Account**, and use the Microsoft linking form. Confirm your current password before continuing to Microsoft. Microsoft-only accounts use Microsoft to sign in and do not receive a generated local password. Logging out of Data Genie ends its browser login; it does not sign you out of Microsoft everywhere.

## Test locally and after deployment

For local development, install the optional library in the server's virtual environment:

```bash
pip install msal==1.39.0 'PyJWT[crypto]==2.15.1'
```

Use a separate development registration when possible. Add `http://localhost:8000/api/auth/microsoft/callback` as an exact **Web** redirect URI, set the four `GENIE_MICROSOFT_` variables privately in `.env`, and open the app using that same `localhost` origin. If using another local port, register and configure its exact callback. The Python server handles the callback; a frontend-only Vite server does not.

On the hosted [Log in](https://data-genie.space/signin) and [Sign up](https://data-genie.space/signup) pages, verify that the button appears, cancellation returns a useful message, and existing password login still works. Use a test Microsoft account to complete first sign-in, log out, and sign in again. Confirm it opens the same saved workspace. Test linking separately with a password account, and confirm that an unlinked email collision does not open that account.

Automated tests exercise the application boundary with controlled provider responses. A successful real Microsoft redirect and callback still need an interactive account test after registration and deployment.

## References

- [Register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Supported account types and authority](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration)
- [OpenID Connect scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)
- [MSAL Python authorization-code flow](https://learn.microsoft.com/en-us/entra/msal/python/getting-started/acquiring-tokens)
