# Azure hosting with free services and student credit

Target: HCP Terraform organization `blueray321`, project `Blueray`, workspace `Data-Genie`, and the existing Azure resource group `data_genie`.

The configured deployment uses **France Central**, app `data-genie-blueray321`, one **Linux B1** instance, and SQL server `data-genie-blueray321-fr-sql` / database `data-genie-state`. The site is [data-genie-blueray321.azurewebsites.net](https://data-genie-blueray321.azurewebsites.net/). The [manual deployment pipeline](https://dev.azure.com/as4dc/blueray/_build?definitionId=1) is in `as4dc/blueray`; select `appServiceSku=B1` when running it.

The workspace already has the four OIDC environment variables listed below and sensitive `TF_VAR_gemini_api_key`. Its Terraform-category values are `location=francecentral`, `app_service_sku=B1`, and `sql_server_name=data-genie-blueray321-fr-sql`. No client secret or additional Gemini variable is needed. Future hosting changes still require a reviewed plan.

This is a small development/demo deployment. Hosting defaults to **App Service Linux F1**, with **Azure SQL's free offer** for durable state. An explicitly selected **single Linux B1 instance** can use student credit when F1 cannot run the app. It does not create a VM, registry, Key Vault or paid logging workspace. There is no automatic tier upgrade or paid SQL fallback.

Azure for Students credit is separate from free-service allowances. Keep the student spending limit enabled. Select the Terraform variable `app_service_sku=B1` only after reviewing its cost. The SQL resource explicitly requests `useFreeLimit=true` and `freeLimitExhaustionBehavior=AutoPause`. Reaching free limits can make the site unavailable; do not switch to `BillOverUsage` to keep it online.

The agreed spending target is around **US$15/month**. Microsoft’s retail pricing API lists Linux B1 in France Central at **$0.018/hour**, approximately **$13.14 for 730 hours**, before taxes, checked on November 2, 2026. SQL remains on the free offer. This estimate is not a billing cap. B1 charges continue while its app is stopped; downgrade or remove the plan to stop that charge. Keep the separate Azure student spending limit enabled.

## 1. Connect Terraform to Azure

A Terraform login is not an Azure credential. Use an Entra application or user-assigned managed identity with OIDC trust for this workspace. An SSH key is not needed.

Open the HCP workspace's **Overview** and follow its project link to find the exact HCP project name. `Data-Genie` is the workspace name; the project name can be different. An Azure portal deployment-history link does not identify either an HCP project or an Azure DevOps project.

The reviewed bootstrap script is [setup_terraform_azure.py](../scripts/setup_terraform_azure.py). In **Azure Cloud Shell**, get the code, sign into the subscription, and inspect its preview:

```bash
git clone --branch dev https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
python scripts/setup_terraform_azure.py --subscription "YOUR SUBSCRIPTION ID" --terraform-project "Blueray"
```

Use the exact project name shown for the workspace, including spaces and capitalization. After reviewing the printed permissions, running with `--apply` creates an application, service principal, a Contributor assignment **only on this resource group**, and separate `plan`/`apply` federated trusts. It creates no client secret. Review the script before granting these permissions. University tenants can require an administrator to create or approve this identity.

If app registration is disabled by the university tenant, add `--managed-identity` to the preview and apply commands. This explicitly creates a user-assigned managed identity **inside `data_genie`**, using Azure resource permissions. Managed identities have no additional charge. The Contributor scope, exact two Terraform subjects, environment variables, and absence of client secrets stay the same. This does not change the tenant's app-registration policy. Do not grant a subscription-wide role to resolve an error.

Azure for Students can restrict resource locations even when a resource group exists in another region. Inspect `az policy assignment list --scope /subscriptions/YOUR-SUBSCRIPTION-ID` for `listOfAllowedLocations`. Pass an allowed region using `--location REGION` for the managed identity and set the Terraform-category variable `location` to an allowed region supporting both free offers. Do not remove the subscription policy or upgrade the SKU to resolve a location error.

In **Terraform → Data-Genie → Variables**, add these under **Environment variables**:

| Key | Value | Sensitive? |
| --- | --- | --- |
| `ARM_SUBSCRIPTION_ID` | Your Azure for Students subscription ID | No |
| `ARM_TENANT_ID` | Your subscription's tenant ID; the bootstrap prints it | No |
| `TFC_AZURE_PROVIDER_AUTH` | `true` | No |
| `TFC_AZURE_RUN_CLIENT_ID` | The bootstrap's Application (client) ID | No |

Do not set `ARM_CLIENT_SECRET` when using this OIDC setup. Do not create `tfc_azure_dynamic_credentials` manually; HCP Terraform supplies it. Terraform generates the SQL password and connection-encryption key. They are sensitive values in the private Terraform state and Azure app settings: restrict workspace/state access and preserve the key when restoring the app.

To supply Gemini as an **environment variable**, use `TF_VAR_gemini_api_key` and enable **Sensitive**. Terraform maps it to the application's `GEMINI_API_KEY`. Use either this environment variable or the Terraform-category `gemini_api_key`, not both.

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
| `resource_group_name` | `data_genie` | Existing group; it is not recreated or owned by this configuration. |
| `app_name` | `data-genie-blueray321` | Must be globally available; also use this value in the deployment pipeline. |
| `location` | Existing group's region | Override when another allowed region offers the selected host and free SQL. |
| `app_service_sku` | `F1` | Select `B1` explicitly for one budgeted Linux instance; larger tiers are rejected. Match this value when running the pipeline. |
| `sql_server_name` | App name plus `-sql` | Optional globally unique name if an earlier failed deployment reserved the original name in another region. Deployment reads this server from the app's configured SQL host. |
| `gemini_api_key` | Empty | Sensitive. Keywords mode is the default; AI billing/free quotas are separate. |
| `gemini_model` | `gemini-3.5-flash-lite` | Only used when a key is supplied. |

Confirm the plan contains only the selected F1 or B1 Linux service plan with one instance, SQL logical server, free SQL database, web app, and generated secrets. The database uses the ARM API through AzAPI because AzureRM's database resource does not expose the free-limit safeguards. The API must report both safeguards back. The database has deletion protection. The hosting plan’s original Azure name ends in `-free`; it is retained for in-place upgrades, so check the SKU itself when reviewing cost.

The SQL server initially permits **no client IPs**. After reviewing network access, an administrator runs `GENIE_RESOURCE_GROUP=data_genie GENIE_APP_NAME=data-genie-blueray321 GENIE_APP_SERVICE_SKU=B1 python scripts/configure_cloud_firewall.py` to allow only the web app's current egress IPs. Use `F1` instead when that is the reviewed tier. These can be shared Azure addresses; SQL still requires verified TLS and the private database credentials. The script never enables the broad "Allow Azure services" rule. No VNet or paid private endpoint is created.

In Azure Quotas, check the actual **F1 VMs** entry. The **Total Regional VMs** counter is informational and its zero value alone does not show whether F1 can be created. Provider validation can pass while an actual deployment still fails on capacity. For `ProvisioningDisabled`, try another subscription-policy-allowed region. If a failed SQL creation reserved a name in the original region, set `sql_server_name` to a new globally unique name before replanning. Inspect the plan for any replacement of an existing database; do not remove its deletion protection.

## 3. Deploy with Azure DevOps

Open your project at `https://dev.azure.com/YOUR-ORGANIZATION/YOUR-PROJECT`. This is a separate service from the Azure portal. If you have only created a DevOps organization, create a project before setting up its pipeline.

Create a separate deployment managed identity with **Reader on `data_genie`** and **Website Contributor only on the Data Genie web app**. It can deploy code and read the app's settings, so it has application-level access to data and credentials. It has no Azure management role to change the hosting plan, SQL firewall, or Terraform identity. Create a workload-identity Azure Resource Manager service connection named `data-genie-azure`, scoped to `data_genie`, using this identity. Authorize only this pipeline. Creating this connection grants access; review its scope. This is a separate trust from Terraform's OIDC trust.

Create an environment named `data-genie`, then import [azure-pipelines.yml](../azure/azure-pipelines.yml) into the project's Azure Repos repository and create a pipeline from that file. The pipeline is **manual only**. It clones the public GitHub `dev` branch for each build, records the exact commit, and deploys that tested artifact. GitHub remains the source of truth; no GitHub account permissions or duplicate application-source pushes are needed. Copy changes to the pipeline definition itself into Azure Repos when updating it.

Microsoft-hosted free parallelism may need to be requested for a new DevOps organization; if no free grant is available, the job should remain queued rather than purchasing capacity.

After Terraform has created the infrastructure, run the pipeline with the same app name and the selected `appServiceSku` (`B1` for the credit-funded deployment). It:

1. Runs the frontend and backend checks and builds React.
2. Creates an allowlisted ZIP with app code, runtime dependencies, and built assets.
3. Verifies the selected Linux tier, one B1 instance when selected, `useFreeLimit=true`, and `AutoPause` in Azure before deployment.
4. Checks the existing SQL firewall rules without changing network access, then deploys using the service connection. A changed egress address needs administrator review before the pipeline can continue.
5. Verifies HTTPS, built frontend assets, and the cloud-backed anonymous session endpoint.

The ZIP does **not** contain `.env`, local accounts/databases, keys, Git history, or the laptop's development packages. This deploys a fresh hosted installation. Existing desktop accounts and data remain on the desktop; they are not uploaded automatically. Sign up at the new URL and upload only the database files you want to move.

## Storage and free-tier limits

App Service's shared `/home` mount cannot safely provide the SQLite locking this app needs. Hosted SQLite runs in `/tmp/data-genie` instead. `backend/cloud_state.py` stores bounded snapshots in the free Azure SQL database, locks the state during an API request, and commits it before releasing the response. A replacement worker restores it before handling account/data requests. A storage error never silently falls back to an empty ephemeral database.

This adapter serializes requests and limits the whole installation to **64 MiB of expanded app state and 256 files**, including accounts, history, and uploaded databases. It is intended for a small student demo. Larger workloads need a relational repository/object-storage redesign and a separate capacity/cost decision. External PostgreSQL changes and app-history storage are separate transactions; after a connection/storage error, inspect History and the external database before repeating a change.

Uploaded SQLite files use working copies. Hosted PostgreSQL requires a public hostname with verified TLS; private, loopback, and cloud-metadata addresses are blocked. A PostgreSQL database on your laptop is not directly reachable from this hosted site. Local mode keeps supporting local PostgreSQL connections.

Azure F1 has a daily CPU allowance and cold starts; SQL can take time to resume. `/healthz` checks liveness without waking SQL. The deployment script checks `/api/auth/session` to verify durable storage separately. This configuration does not promise continuous availability or an SLA. SQL’s free offer and AutoPause must remain enabled. Hosting is restricted to F1 or one explicitly selected Linux B1 instance; do not enable SQL overages or a larger hosting tier.

Accounts, history, and working data live where the app is hosted, with password hashing and HTTPS cookies. SQL transport verifies the server's certificate chain and hostname. The current python-tds release needs the small `backend/cloud_tls.py` compatibility adapter for pyOpenSSL 26; keep `service-identity` installed and hostname verification enabled. Durable ZIP snapshots are bound as `pytds.Binary`, not text. Azure SQL backs up its state; the Terraform-managed connection key must also be retained to unlock saved PostgreSQL connections after recovery. A snapshot must be treated as private user data.

## References

- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [App Service Linux pricing and F1 quotas](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/)
- [Azure SQL free offer and AutoPause](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier?view=azuresql)
- [HCP Terraform Azure dynamic credentials](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/azure-configuration)
- [Azure Pipelines free parallel-job grants](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops)

- [Microsoft Azure retail pricing API](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20App%20Service%27%20and%20armRegionName%20eq%20%27francecentral%27%20and%20skuName%20eq%20%27B1%27%20and%20priceType%20eq%20%27Consumption%27)
