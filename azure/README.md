# Azure hosting

[Main README](../README.md) · [Backend](../backend/README.md) · [Deployment guide](../docs/azure-free-hosting.md)

The live site is [data-genie.space](https://data-genie.space/). It uses the existing Azure App Service B1 plan and cloud-backed application state. The MCP/OAuth endpoint shares that app; it does not create another hosting instance or authentication subscription.

The current hosting plan is funded through student credit. It is not a free Azure tier. Existing usage allowances, AI quotas, and spending limits still apply.

The approved fixed SQL option is **Basic, 5 DTUs, 2 GiB**, bringing Linux B1 plus SQL to approximately $20/month in France Central before tax and small extras. Set Terraform variable `sql_state_tier=basic` in the existing HCP workspace before its next plan; leave auto apply disabled. This permanently removes this database's SQL free offer. Do not enable General Purpose serverless overages as a substitute. The default `free` value remains available for new free-offer installations. The code deployment check accepts free AutoPause or bounded Basic and does not change SQL billing or network permissions.

- `main.tf` and related Terraform files describe infrastructure.
- `azure-pipelines.yml` tests, packages, deploys, and checks the application.
- `requirements.txt` pins the hosted Python runtime, including MCP and OAuth support.
- `gunicorn.conf.py` keeps the deployment on one worker with bounded threads.

The pipeline runs manually and fetches GitHub's `dev` branch. Use the reviewed `appServiceSku=B1` parameter for the current deployment. Terraform manages infrastructure; the pipeline deploys code.

Read the [deployment guide](../docs/azure-free-hosting.md) for variables, identity setup, storage durability, firewall checks, and rollback considerations. Do not commit cloud credentials or automatically upload local accounts and databases.

After deployment, run:

```bash
python3 -B scripts/verify_cloud.py https://data-genie.space
```

For MCP releases, also verify public OAuth discovery and that unauthenticated `/mcp` requests are rejected. See [agent setup](../docs/agents.md) and [security](../SECURITY.md).

## Service secrets in Key Vault

Terraform provisions a dedicated Standard Key Vault and `data-genie-runtime` managed identity. The app receives **Get** permission only for this vault. Terraform's existing identity manages secrets in that vault. SQL password, the existing connection encryption key, AI provider key, Google client secret, and Brevo key are stored there; app settings contain versionless Key Vault references. The connection key and SQL password are migrated unchanged, so existing connections and accounts remain usable.

For optional [Google sign-in](../docs/google-sign-in.md), set `google_client_id`, sensitive `google_client_secret`, and `google_redirect_uri`. The secret is referenced through the existing Key Vault. Retired Microsoft sign-in settings are no longer sent to the app; the historical secret resource is preserved without deletion.

Set `brevo_api_key` as a **sensitive Terraform variable**, and `brevo_sender_email` to the verified `no-reply@data-genie.space`. The sender name is **Blueray Inc.** Restrict the Brevo key to Transactional email only. Brevo requires its All level to send; it also permits transactional templates, logs, and blocking, so other resource categories must remain disabled. Signup delivery is capped at 200 messages per installation per 24-hour window, in addition to per-IP/email limits. Hosted registration fails closed if sending is unavailable; existing logins still work. Local development skips verification unless `GENIE_VERIFY_EMAIL=true` and a private `BREVO_API_KEY` are configured. Never commit service keys or paste them into chat.

Key Vault is a metered service using the existing student subscription; this does not upgrade B1. Review the Terraform plan before applying. Register `Microsoft.KeyVault` if needed. After apply, check App Service's Key Vault reference statuses, then HTTPS and cloud storage with `scripts/verify_cloud.py`. Do not rotate the connection key as part of migration. Terraform still retains managed secret values in its sensitive, access-controlled state and workspace variables; Key Vault does not erase old state versions. Restrict Terraform access and rotate exposed keys separately.

User passwords and signup codes are hashed; agent credentials are stored as hashes. Saved external database credentials stay encrypted in the application database, with their encryption key held in Key Vault. They are not plain-text app configuration.
