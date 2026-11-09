# Workspace invitation email

Workspace owners can email a private invitation when creating it. The recipient signs in or creates an account using the invited email address, then accepts the invitation. Copying the private link remains available when email is unavailable.

Email is optional and disabled in Terraform by default. It uses Azure Communication Services and the pinned Python SDK `azure-communication-email==1.1.0`. No Microsoft sign-in registration or mailbox access is needed; the server authenticates with its Communication Service resource key. [SDK reference](https://pypi.org/project/azure-communication-email/1.1.0/)

## Enable in Azure

1. The subscription owner registers the `Microsoft.Communication` resource provider if it is not registered. The resource-group-scoped Terraform identity cannot register subscription providers; retain `resource_provider_registrations = "none"`.
2. In the HCP Terraform `Data-Genie` workspace, keep auto apply disabled and set the Terraform-category variable `invitation_email_enabled = true`. Review the plan before applying it.
3. The plan adds an Email Communication Service, an `AzureManagedDomain`, a Communication Service, and their domain association inside the existing `data_genie` resource group. Both global services use the `Europe` data geography. The managed domain supplies sender authentication; activation needs no DNS changes to `data-genie.space`. [Managed domains](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email/email-domain-and-sender-authentication), [domain association](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/connect-email-communication-resource)
4. After the reviewed infrastructure change, deploy the application through the existing pipeline. The runtime dependency is included in the existing deployment package. Send a test invitation to a mailbox you control and inspect its inbox and spam folder.

The App Service tier, SQL free-offer safeguards, public URL, custom domain and Microsoft sign-in configuration are independent of email. Review the plan for changes to those existing resources before applying it.

| Terraform variable | Default | Purpose |
| --- | --- | --- |
| `invitation_email_enabled` | `false` | Creates the four email resources only when explicitly enabled. |
| `invitation_email_daily_limit` | `100` | Application-wide invitation email attempts in a 24-hour period; whole numbers from 1 to 1000. |
| `invitation_email_reply_to` | empty | Optional mailbox chosen by the operator for replies. Empty omits Reply-To. |

Terraform configures these server-only app settings after linking the domain:

| App setting | Source |
| --- | --- |
| `GENIE_EMAIL_CONNECTION_STRING` | Communication Service primary connection string; secret. |
| `GENIE_EMAIL_SENDER` | `DoNotReply@` plus the generated Azure-managed sender domain. |
| `GENIE_EMAIL_REPLY_TO` | Optional operator-selected reply mailbox. |
| `GENIE_EMAIL_DAILY_LIMIT` | Configured limit as a string. |

All four settings are empty when email is disabled. The only new Terraform outputs are the enabled flag and sender address. The connection string still exists in private Terraform state and Azure app settings: restrict access and never copy it into frontend variables, Git, chat or public outputs. No additional Entra application or role assignment is required for this key-based sender.

The server also needs a valid HTTPS public origin, through `GENIE_PUBLIC_URL` or Azure's actual `WEBSITE_HOSTNAME`, to build invitation links. For this deployment, keep `public_url = "https://data-genie.space"`. Local development remains email-free unless configured explicitly; see the commented settings in [`.env.example`](../.env.example).

## Status and limits

`sent` means Azure accepted the email for sending. It does not confirm inbox delivery. `failed` means sending failed or its outcome could not be confirmed; check with the recipient before another attempt. `not_configured` means the sender is unavailable and the owner should copy the link. The application does not automatically resend after a timeout. Microsoft documents final delivery status separately through Monitor or Event Grid; this setup does not add those services. [Send status](https://learn.microsoft.com/en-us/rest/api/communication/email/email/send?view=rest-communication-email-2025-09-01)

The server limits sends to 20 attempts per owner per hour, one attempt per recipient per minute, and the configured application-wide 24-hour cap. Azure quotas also apply. Email content contains the invitation details and private acceptance link, without database contents.

Sending is metered by email count and data transferred. [Domain provisioning has no charge](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/add-azure-managed-domains); consult [Azure Communication Services pricing](https://azure.microsoft.com/en-us/pricing/details/communication-services/) for the subscription's current rates. The application limit is not an Azure billing cap; retain the student spending limit.

For local infrastructure checks, run `terraform fmt -check`, `terraform validate`, and `terraform test -filter=tests/email.tftest.hcl` from `azure`. The email tests mock all providers and run plans only; they do not send email or create Azure resources.
