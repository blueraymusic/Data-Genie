# Azure hosting with free services and student credit

[Main README](../README.md) · [All guides](README.md) · [Azure overview](../azure/README.md) · [Hosted MCP](agents.md)

The public site runs on one **Linux B1** App Service instance with Always On enabled and **Azure SQL Basic** for durable state (5 DTUs and 2 GiB). The App Service retrieves runtime secrets through Key Vault. Use the existing HCP Terraform workspace and manual Azure Pipelines release for this deployment. Select `appServiceSku=B1` when releasing. Use the resource names in your authorized deployment tools.

New-installation defaults remain **App Service Linux F1** and **Azure SQL's free offer** with `AutoPause`. Switching a free-offer database to Basic permanently removes that database's free offer and requires a reviewed cost decision. Keep `sql_state_tier=basic` for this existing deployment; never enable General Purpose serverless overages as a substitute. There is no automatic hosting upgrade or paid SQL fallback.

## 1. Connect Terraform to Azure

A Terraform login is not an Azure credential. Use an Entra application or user-assigned managed identity with OIDC trust for this workspace. An SSH key is not needed.

Open the HCP workspace's **Overview** and follow its project link to find the exact project name. The bootstrap is configured for the existing HCP organization and workspace. For a separate deployment, use the [HCP OIDC setup guide](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/azure-configuration) to configure trust for its organization and workspace.

The reviewed bootstrap script is [setup_terraform_azure.py](../scripts/setup_terraform_azure.py). In **Azure Cloud Shell**, get the code, sign into the subscription, and inspect its preview:

```bash
git clone --branch dev https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
python scripts/setup_terraform_azure.py --subscription "YOUR SUBSCRIPTION ID" --terraform-project "YOUR HCP PROJECT" --resource-group "YOUR RESOURCE GROUP"
```

Use the exact project name shown for the workspace, including spaces and capitalization. After reviewing the printed permissions, running with `--apply` creates an application, service principal, a Contributor assignment **only on this resource group**, and separate `plan`/`apply` federated trusts. It creates no client secret. Review the script before granting these permissions. University tenants can require an administrator to create or approve this identity.

If app registration is disabled by the university tenant, add `--managed-identity` to the preview and apply commands. This explicitly creates a user-assigned managed identity in the selected resource group, using Azure resource permissions. Managed identities have no additional charge. The Contributor scope, exact two Terraform subjects, environment variables, and absence of client secrets stay the same. This does not change the tenant's app-registration policy. Do not grant a subscription-wide role to resolve an error.

Azure for Students can restrict resource locations even when a resource group exists in another region. Inspect `az policy assignment list --scope /subscriptions/YOUR-SUBSCRIPTION-ID` for `listOfAllowedLocations`. Pass an allowed region using `--location REGION` for the managed identity and set the Terraform-category variable `location` to an allowed region supporting both free offers. Do not remove the subscription policy or upgrade the SKU to resolve a location error.

In the HCP workspace's **Variables** page, add these under **Environment variables**:

| Key | Value | Sensitive? |
| --- | --- | --- |
| `ARM_SUBSCRIPTION_ID` | Your Azure for Students subscription ID | No |
| `ARM_TENANT_ID` | Your subscription's tenant ID; the bootstrap prints it | No |
| `TFC_AZURE_PROVIDER_AUTH` | `true` | No |
| `TFC_AZURE_RUN_CLIENT_ID` | The bootstrap's Application (client) ID | No |

Do not set `ARM_CLIENT_SECRET` when using this OIDC setup. Do not create `tfc_azure_dynamic_credentials` manually; HCP Terraform supplies it. Terraform generates the SQL password and connection-encryption key. Restrict access to Terraform state and Key Vault. The production app settings reference the secrets in Key Vault. Preserve the existing encryption key when restoring the app.

To enable Data Genie AI with an **environment variable**, use `TF_VAR_gemini_api_key` and enable **Sensitive**. Terraform maps it to the application's `GEMINI_API_KEY`. Use either this environment variable or the Terraform-category `gemini_api_key`, not both.

The product calls this feature **Data Genie AI**. The existing environment-variable, model, and Terraform identifiers below are configuration names; keep their exact spelling when configuring the deployment.

If you already have a scoped service principal that uses a secret, an alternative is `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`, `ARM_CLIENT_ID`, and **sensitive** `ARM_CLIENT_SECRET`. Do not combine this with the OIDC variables. Never put secrets in Git or chat.

## 2. Configure the workspace

- Connect the workspace to this repository's `dev` branch.
- Set **Terraform Working Directory** to `azure`.
- Keep **Auto apply disabled**. Run a plan and inspect it first.
- Use Terraform 1.9 or later, below 2.0.
- The subscription owner must register `Microsoft.Web` and `Microsoft.Sql` resource providers. The app identity cannot register subscription-wide providers with only resource-group permissions.

Optional **Terraform-category variables**:

| Key | Default | Notes |
| --- | --- | --- |
| `resource_group_name` | See [variables.tf](../azure/variables.tf) | Specify the existing resource group for your deployment. |
| `app_name` | See [variables.tf](../azure/variables.tf) | Choose a globally available name and use it in the deployment pipeline. |
| `location` | Existing group's region | Override when another allowed region offers the selected host and free SQL. |
| `public_url` | empty | Set to `https://data-genie.space` for this deployment, after DNS and HTTPS are ready. Empty uses the Azure hostname. |
| `app_service_sku` | `F1` | Select `B1` explicitly for one budgeted Linux instance; larger tiers are rejected. Match this value when running the pipeline. |
| `sql_state_tier` | `free` | Existing live deployment uses approved `basic`: fixed 5 DTUs / 2 GiB. Changing from the free offer permanently removes it. |
| `sql_server_name` | App name plus `-sql` | Optional globally unique name if an earlier failed deployment reserved the original name in another region. Deployment reads this server from the app's configured SQL host. |
| `gemini_api_key` | Empty | Sensitive. Without a key, use SQL or Structure; AI billing/free quotas are separate. |
| `gemini_model` | `gemini-3.5-flash-lite` | Only used when a key is supplied. |
| `google_client_id` | Empty | Optional Google Web OAuth client ID; separate from Azure deployment identities. |
| `google_client_secret` | Empty | Sensitive. Google Web OAuth client secret, stored in the existing Key Vault. |
| `google_redirect_uri` | Empty | Exact registered callback, `https://data-genie.space/api/auth/google/callback`. |

Confirm the plan contains only the selected F1 or B1 Linux service plan with one instance, SQL logical server, selected free or Basic SQL database, web app, existing Key Vault and runtime identity, and generated secrets. The database uses the ARM API through AzAPI to preserve the selected billing safeguards. Free SQL must report `useFreeLimit=true` and `AutoPause`; Basic must report 5 DTUs and 2 GiB. Inspect any secret updates and reject unrelated replacements. The database has deletion protection. Review the actual hosting SKU when checking costs.

The SQL server initially permits **no client IPs**. After reviewing network access, an administrator runs `GENIE_RESOURCE_GROUP=YOUR_RESOURCE_GROUP GENIE_APP_NAME=YOUR_APP_NAME GENIE_APP_SERVICE_SKU=B1 python scripts/configure_cloud_firewall.py` to allow only the web app's current egress IPs. Use `F1` instead when that is the reviewed tier. These can be shared Azure addresses; SQL still requires verified TLS and the private database credentials. The script never enables the broad "Allow Azure services" rule. No VNet or paid private endpoint is created.

In Azure Quotas, check the actual **F1 VMs** entry. The **Total Regional VMs** counter is informational and its zero value alone does not show whether F1 can be created. Provider validation can pass while an actual deployment still fails on capacity. For `ProvisioningDisabled`, try another subscription-policy-allowed region. If a failed SQL creation reserved a name in the original region, set `sql_server_name` to a new globally unique name before replanning. Inspect the plan for any replacement of an existing database; do not remove its deletion protection.

## 3. Deploy with Azure DevOps

Use the existing Data Genie pipeline in your authorized Azure DevOps project. The steps below describe how to recreate its connection when needed.

Create a separate deployment managed identity with **Reader on the deployed resource group** and **Website Contributor only on the Data Genie web app**. It can deploy code and read the app's settings, so it has application-level access to data and credentials. It has no Azure management role to change the hosting plan, SQL firewall, or Terraform identity. Create a workload-identity Azure Resource Manager service connection named `data-genie-azure`, scoped to that resource group, using this identity. Authorize only this pipeline. Creating this connection grants access; review its scope. This is a separate trust from Terraform's OIDC trust.

Create an environment named `data-genie`, then import [azure-pipelines.yml](../azure/azure-pipelines.yml) into the project's Azure Repos repository and create a pipeline from that file. The pipeline is **manual only**. It clones the public GitHub `dev` branch for each build, records the exact commit, and deploys that tested artifact. GitHub remains the source of truth; no GitHub account permissions or duplicate application-source pushes are needed. Copy changes to the pipeline definition itself into Azure Repos when updating it.

Microsoft-hosted free parallelism may need to be requested for a new DevOps organization; if no free grant is available, the job should remain queued rather than purchasing capacity.

After Terraform has created the infrastructure, run the pipeline with the same app name and the selected `appServiceSku` (`B1` for the credit-funded deployment). It:

1. Fetches the current GitHub `dev` commit, runs the frontend and backend checks, and builds React.
2. Creates an allowlisted ZIP with app code, runtime dependencies, and built assets.
3. Verifies the selected Linux tier, one B1 instance when selected, and either free SQL with `AutoPause` or bounded Basic SQL in Azure before deployment.
4. Checks the existing SQL firewall rules without changing network access, then deploys using the service connection. A changed egress address needs administrator review before the pipeline can continue.
5. Verifies HTTPS, built frontend assets, process health, sign-in provider discovery, and the cloud-backed anonymous session endpoint. Check the artifact's `commit.txt` against the intended GitHub commit.

The ZIP does **not** contain `.env`, local accounts/databases, keys, Git history, or the laptop's development packages. Deploying code reuses the hosted application state. Existing desktop accounts and data remain on the desktop; they are not uploaded automatically. Use [Sign up](https://data-genie.space/signup) and upload only the database files you want to move in [Databases](https://data-genie.space/databases).

## If login reports unavailable storage

For the live Basic SQL deployment, check database availability, the app's Key Vault references, and its SQL firewall rules. On a separate free-offer deployment, inspect database status and the `free_amount_remaining` and `free_amount_consumed` metrics for a quota pause. The app's connection retry checks the session endpoint without resubmitting a login, signup, or SQL change.

Use [Log in](https://data-genie.space/signin), choose **Retry connection** if offered, then submit the form explicitly. Form details stay in place. If saving a database change could not be confirmed, inspect [History](https://data-genie.space/history) before repeating it. Server diagnostics record the failure stage, exception types, and numeric SQL codes without recording passwords, query text, or snapshot contents.

Keep the approved SQL plan while diagnosing an error. Basic does not pause at a free serverless quota. A new paid SQL tier or serverless overages require a separate cost decision; enabling them is not a remedy for a translation, certificate, or snapshot error. See the [Azure SQL free-offer FAQ](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer-faq).

## Storage and free-tier limits

App Service's shared `/home` mount cannot safely provide the SQLite locking this app needs. Hosted SQLite runs in `/tmp/data-genie` instead. `backend/cloud_state.py` stores bounded snapshots in Azure SQL, locks the state during an API request, and commits it before releasing the response. A replacement worker restores it before handling account/data requests. A storage error never silently falls back to an empty ephemeral database.

This adapter serializes requests and limits the whole installation to **64 MiB of expanded app state and 256 files**, including accounts, history, and uploaded databases. It is intended for a small student demo. Larger workloads need a relational repository/object-storage redesign and a separate capacity/cost decision. External PostgreSQL changes and app-history storage are separate transactions; after a connection/storage error, inspect History and the external database before repeating a change.

Uploaded SQLite files use working copies. Hosted PostgreSQL requires a public hostname with verified TLS; private, loopback, and cloud-metadata addresses are blocked. A PostgreSQL database on your laptop is not directly reachable from this hosted site. Local mode keeps supporting local PostgreSQL connections.

Azure F1 has a daily CPU allowance and cold starts. B1 uses its included Always On capability to keep the web app loaded. The production Basic SQL database does not use the serverless pause policy. For new deployments using the free SQL offer, retain `AutoPause`. `/healthz` checks process liveness. The deployment script checks `/api/auth/session` separately to verify durable storage. The supported tiers are F1 and one explicitly selected Linux B1 instance.

Accounts, history, and working data live where the app is hosted, with password hashing and HTTPS cookies. SQL transport verifies the server's certificate chain and hostname. The current python-tds release needs the small `backend/cloud_tls.py` compatibility adapter for pyOpenSSL 26; keep `service-identity` installed and hostname verification enabled. Durable ZIP snapshots are bound as `pytds.Binary`, not text. Azure SQL backs up its state; the Terraform-managed connection key must also be retained to unlock saved PostgreSQL connections after recovery. A snapshot must be treated as private user data.

## References

- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [App Service Linux pricing and F1 quotas](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/)
- [Azure SQL free offer and AutoPause](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier?view=azuresql)
- [HCP Terraform Azure dynamic credentials](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/azure-configuration)
- [Azure Pipelines free parallel-job grants](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops)

- [Microsoft Azure retail pricing API](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20App%20Service%27%20and%20armRegionName%20eq%20%27francecentral%27%20and%20skuName%20eq%20%27B1%27%20and%20priceType%20eq%20%27Consumption%27)

## Custom domain

The public site is [data-genie.space](https://data-genie.space/). Populate the following apex records using the values on the App Service **Custom domains** page:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | The web app's current inbound IPv4 address |
| TXT | `asuid` | The web app's custom-domain verification ID |

Keep the verification TXT record to protect domain ownership. Leave email records intact. The apex domain is bound to the existing B1 app with a free App Service managed certificate and SNI HTTPS. No paid certificate or larger plan is required. `www` is not configured.

DNS, the hostname binding, and the managed certificate were configured separately from Terraform. Keep them when applying the existing infrastructure. If recreating or moving the app, retrieve its new inbound IP and ownership ID, update DNS, add the hostname binding, create the managed certificate, and bind it with SNI before setting the canonical origin. Azure renews the managed certificate while its validation requirements remain satisfied. See [Azure's domain and certificate guide](https://learn.microsoft.com/en-us/azure/app-service/tutorial-secure-domain-certificate).

HCP Terraform's `public_url` sets `GENIE_PUBLIC_URL` on the app. This is an origin, without a trailing slash or path. It controls host validation, secure login cookies and same-origin requests. Do not switch it to a domain before HTTPS is working. Existing Azure-hostname GET links redirect to the canonical domain after the application update; POST requests on the old hostname are rejected. Users must log in again on the new domain because login cookies remain scoped to their original host. Accounts and saved data stay in the same Azure SQL database.

The deployment pipeline verifies the configured public origin, including frontend assets, health and the cloud-backed session endpoint. To check manually:

```sh
python scripts/verify_cloud.py https://data-genie.space
```

Finish Terraform applies and app-setting or logging changes before starting a code deployment. Those changes can restart Azure's containers and interrupt the remote build. The pipeline waits for publishing with a ten-minute timeout, then uses the public-origin checks above instead of Azure CLI's Linux startup tracker, which can continue polling after the app is already healthy.

## Authentication limits and proxy verification

Auth limits are saved in the same durable repository as accounts: five signup submissions per IP, 30 login submissions per IP across emails, and three failed password checks per account email across client addresses, each over 15 minutes. Counters are reserved atomically before password work; successful login never clears the IP budget. Password recovery shares registration's IP limit and uses a separate per-address request budget. HTTP 429 includes the remaining window in `Retry-After`. See [account lifecycle and recovery configuration](account-lifecycle.md).

The WSGI adapter takes the rate-limit identity from Azure's overwritten `Client-IP` header when `GENIE_CLOUD_STATE=azure_sql` and the platform's `WEBSITE_HOSTNAME` identifies App Service. It never uses arbitrary XFF entries. Gunicorn's `REMOTE_ADDR` is the proxy peer; its forwarded-header trust setting does not rewrite that value. Keep direct App Service ingress for this trust boundary. See [Azure's maintained header documentation](https://github.com/Azure/app-service-linux-docs/blob/master/Things_You_Should_Know/headers.md).

Use the client-IP and authentication integration tests to check the configured trust boundary and rate limits before releasing changes to them.
