# Azure hosting

[Main README](../README.md) · [Backend](../backend/README.md) · [Deployment guide](../docs/azure-free-hosting.md)

The live site is [data-genie.space](https://data-genie.space/). It uses the existing Azure App Service B1 plan and cloud-backed application state. The MCP/OAuth endpoint shares that app; it does not create another hosting instance or authentication subscription.

The managed deployment uses one Linux B1 instance and fixed **Azure SQL Basic, 5 DTUs and 2 GiB**. Keep `sql_state_tier=basic` for this installation. The Terraform default for a new installation uses F1 and free SQL with `AutoPause`. The deployment guard verifies the selected tier and existing SQL firewall rules.

- `main.tf` and related Terraform files describe infrastructure.
- `azure-pipelines.yml` tests, packages, deploys, and checks the application.
- `requirements.txt` pins the hosted Python runtime, including MCP and OAuth support.
- `gunicorn.conf.py` keeps the deployment on one worker with bounded threads.

The pipeline runs manually and fetches GitHub's `dev` branch. Use the reviewed `appServiceSku=B1` parameter for the current deployment. Terraform manages infrastructure. The pipeline tests and deploys code and records the exact GitHub revision in `commit.txt`.

## Direct PostgreSQL and pooled connections

Linux App Service disables outbound IPv6 by default. Terraform sets `WEBSITE_NETWORK_LINUX_OUTBOUND_DISABLE_IPV6=false` on the existing app to opt into outbound IPv6 for endpoints such as Supabase direct connections. This App Service preview feature is available on the existing tier. See [Microsoft's outbound IPv6 instructions](https://techcommunity.microsoft.com/blog/appsonazureblog/announcing-app-service-outbound-ipv6-support-in-public-preview/4423368).

For an existing app, apply the setting through Terraform or set that exact application setting in Azure's **Environment variables**, then apply the change. Azure restarts the app when application settings change. Test both direct and Session pooler URLs through Data Genie's **Test connection** afterward. An inbound `ipMode` change alone does not enable outbound IPv6. App Service's preview does not support IPv6 through a VNet with Route All; do not disable existing network isolation to work around that limitation.

On 2026-11-24, the France Central B1 worker returned `Network is unreachable` for public IPv6 addresses despite the opt-in and an IPv6 default route. Replacing the worker through **App Service → Instances → Repair → Replace instance** restored outbound IPv6. From the new application container, a public IPv6 TCP probe succeeded, and both the Supabase IPv6 direct endpoint and the IPv4 Session pooler passed PostgreSQL TLS and hostname verification on port `5432`. Verify IPv6 from the application container after any repair. Data Genie's **Test connection** also checks database authentication and schema access without saving credentials.

Read the [deployment guide](../docs/azure-free-hosting.md) for variables, identity setup, storage durability, firewall checks, and rollback considerations. Do not commit cloud credentials or automatically upload local accounts and databases.

After deployment, run:

```bash
python3 -B scripts/verify_cloud.py https://data-genie.space
```

For MCP releases, also verify public OAuth discovery and that unauthenticated `/mcp` requests are rejected. See [agent setup](../docs/agents.md) and [security](../SECURITY.md).

## Service secrets in Key Vault

Terraform provisions a dedicated Standard Key Vault and `data-genie-runtime` managed identity. The app receives **Get** permission only for this vault. Terraform's existing identity manages secrets in that vault. SQL password, the existing connection encryption key, AI provider key, Google client secret, and Brevo key are stored there; app settings contain versionless Key Vault references. The connection key and SQL password are migrated unchanged, so existing connections and accounts remain usable.

For optional [Google sign-in](../docs/google-sign-in.md), set `google_client_id`, sensitive `google_client_secret`, and `google_redirect_uri`. The secret is referenced through the existing Key Vault. Retired Microsoft sign-in settings are no longer sent to the app; the historical secret resource is preserved without deletion.

Set `brevo_api_key` as a **sensitive Terraform variable**, and `brevo_sender_email` to a verified sender address. Restrict the Brevo key to Transactional email only. Brevo requires its All level to send; it also permits transactional templates, logs, and blocking, so other resource categories must remain disabled. Signup delivery is capped at 200 messages per installation per 24-hour window, in addition to per-IP/email limits. Hosted registration fails closed if sending is unavailable; existing logins still work. Local development skips verification unless `GENIE_VERIFY_EMAIL=true` and a private `BREVO_API_KEY` are configured. Never commit service keys or paste them into chat.

Key Vault is billed separately from App Service. Review the Terraform plan before applying. Register `Microsoft.KeyVault` if needed. After apply, check App Service's Key Vault reference statuses, then HTTPS and cloud storage with `scripts/verify_cloud.py`. Do not rotate the connection key as part of migration. Terraform still retains managed secret values in its sensitive, access-controlled state and workspace variables; Key Vault does not erase old state versions. Restrict Terraform access and rotate exposed keys separately.

User passwords and signup codes are hashed; agent credentials are stored as hashes. Saved external database credentials stay encrypted in the application database, with their encryption key held in Key Vault. They are not plain-text app configuration.
