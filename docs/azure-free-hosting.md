# Azure hosting within free allowances

Target: HCP Terraform organization `blueray321`, project `Blueray`, workspace `Data-Genie`, and the existing Azure resource group `data_genie`.

This is a small development/demo deployment. It uses **App Service Linux F1** and **Azure SQL's free offer**. It does not create a VM, registry, Key Vault, paid logging workspace, or paid app-service tier. There is no automatic upgrade. If a region, subscription, quota, or policy cannot provide these offers, deployment must fail.

Azure for Students includes credit, but using that credit was not authorized for this deployment. Keep the student spending limit enabled. The SQL resource explicitly requests `useFreeLimit=true` and `freeLimitExhaustionBehavior=AutoPause`. Reaching free limits can make the site unavailable; do not switch to `BillOverUsage` to keep it online.

## 1. Connect Terraform to Azure

A Terraform login is not an Azure credential. Use an Entra application with OIDC trust for this workspace. An SSH key is not needed.

Open the HCP workspace's **Overview** and follow its project link to find the exact HCP project name. `Data-Genie` is the workspace name; the project name can be different. An Azure portal deployment-history link does not identify either an HCP project or an Azure DevOps project.

The reviewed bootstrap script is [setup_terraform_azure.py](../scripts/setup_terraform_azure.py). In **Azure Cloud Shell**, get the code, sign into the subscription, and inspect its preview:

```bash
git clone --branch dev https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
python scripts/setup_terraform_azure.py --subscription "YOUR SUBSCRIPTION ID" --terraform-project "Blueray"
```

Use the exact project name shown for the workspace, including spaces and capitalization. After reviewing the printed permissions, running with `--apply` creates an application, service principal, a Contributor assignment **only on this resource group**, and separate `plan`/`apply` federated trusts. It creates no client secret. Review the script before granting these permissions. University tenants can require an administrator to create or approve this identity.

In **Terraform → Data-Genie → Variables**, add these under **Environment variables**:

| Key | Value | Sensitive? |
| --- | --- | --- |
| `ARM_SUBSCRIPTION_ID` | Your Azure for Students subscription ID | No |
| `ARM_TENANT_ID` | Your subscription's tenant ID; the bootstrap prints it | No |
| `TFC_AZURE_PROVIDER_AUTH` | `true` | No |
| `TFC_AZURE_RUN_CLIENT_ID` | The bootstrap's Application (client) ID | No |

Do not set `ARM_CLIENT_SECRET` when using this OIDC setup. Do not create `tfc_azure_dynamic_credentials` manually; HCP Terraform supplies it. Terraform generates the SQL password and connection-encryption key. They are sensitive values in the private Terraform state and Azure app settings: restrict workspace/state access and preserve the key when restoring the app.

If you already have a scoped service principal that uses a secret, an alternative is `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`, `ARM_CLIENT_ID`, and **sensitive** `ARM_CLIENT_SECRET`. Do not combine this with the OIDC variables. Never put secrets in Git or chat.

## 2. Configure the workspace

- Connect the workspace to this repository's `dev` branch.
- Set **Terraform Working Directory** to `infra/azure`.
- Keep **Auto apply disabled**. Run a plan and inspect it first.
- Use Terraform 1.9 or later, below 2.0.
- The subscription owner must register `Microsoft.Web` and `Microsoft.Sql` resource providers. The app identity cannot register subscription-wide providers with only resource-group permissions.

Optional **Terraform-category variables**:

| Key | Default | Notes |
| --- | --- | --- |
| `resource_group_name` | `data_genie` | Existing group; it is not recreated or owned by this configuration. |
| `app_name` | `data-genie-blueray321` | Must be globally available; also use this value in the deployment pipeline. |
| `location` | Existing group's region | Override only if another allowed region offers both free services. |
| `gemini_api_key` | Empty | Sensitive. Keywords mode is the default; AI billing/free quotas are separate. |
| `gemini_model` | `gemini-3.5-flash-lite` | Only used when a key is supplied. |

Confirm the plan contains only the F1 service plan, SQL logical server, free SQL database, web app, and generated secrets. The database uses the ARM API through AzAPI because AzureRM's database resource does not expose the free-limit safeguards. The API must report both safeguards back. The database has deletion protection.

The SQL server initially permits **no client IPs**. The pipeline adds only the web app's possible egress IPs after the app exists. It never enables the broad "Allow Azure services" rule. No VNet or paid private endpoint is created.

## 3. Deploy with Azure DevOps

Open your project at `https://dev.azure.com/YOUR-ORGANIZATION/YOUR-PROJECT`. This is a separate service from the Azure portal. If you have only created a DevOps organization, create a project before setting up its pipeline.

Create a workload-identity Azure Resource Manager service connection named `data-genie-azure`, scoped to `data_genie`. Authorize only this pipeline. Creating this connection grants access; review its scope. This is a separate trust from Terraform's OIDC trust.

Create an environment named `data-genie-free`, then import [azure-pipelines.yml](../azure-pipelines.yml) from the repository. The pipeline is **manual only**. Microsoft-hosted free parallelism may need to be requested for a new DevOps organization; if no free grant is available, the job should remain queued rather than purchasing capacity.

After Terraform has created the infrastructure, run the pipeline with the same app name. It:

1. Runs the frontend and backend checks and builds React.
2. Creates an allowlisted ZIP with app code, runtime dependencies, and built assets.
3. Verifies F1, `useFreeLimit=true`, and `AutoPause` in Azure before deployment.
4. Adds the app's SQL egress firewall rules and deploys using the service connection.
5. Verifies HTTPS, built frontend assets, and the cloud-backed anonymous session endpoint.

The ZIP does **not** contain `.env`, local accounts/databases, keys, Git history, or the laptop's development packages. This deploys a fresh hosted installation. Existing desktop accounts and data remain on the desktop; they are not uploaded automatically. Sign up at the new URL and upload only the database files you want to move.

## Storage and free-tier limits

App Service's shared `/home` mount cannot safely provide the SQLite locking this app needs. Hosted SQLite runs in `/tmp/data-genie` instead. `cloud_state.py` stores bounded snapshots in the free Azure SQL database, locks the state during an API request, and commits it before releasing the response. A replacement worker restores it before handling account/data requests. A storage error never silently falls back to an empty ephemeral database.

This adapter serializes requests and limits the whole installation to **64 MiB of expanded app state and 256 files**, including accounts, history, and uploaded databases. It is intended for a small student demo. Larger workloads need a relational repository/object-storage redesign and a separate capacity/cost decision. External PostgreSQL changes and app-history storage are separate transactions; after a connection/storage error, inspect History and the external database before repeating a change.

Uploaded SQLite files use working copies. Hosted PostgreSQL requires a public hostname with verified TLS; private, loopback, and cloud-metadata addresses are blocked. A PostgreSQL database on your laptop is not directly reachable from this hosted site. Local mode keeps supporting local PostgreSQL connections.

Azure F1 has a daily CPU allowance and cold starts; SQL can take time to resume. `/healthz` checks liveness without waking SQL. The deployment script checks `/api/auth/session` to verify durable storage separately. This configuration does not promise continuous availability or an SLA. Free allowances and eligibility must remain enabled; do not enable paid overages or manually upgrade the resources.

Accounts, history, and working data live where the app is hosted, with password hashing and HTTPS cookies. SQL transport verifies the server's TLS certificate. Azure SQL backs up its state; the Terraform-managed connection key must also be retained to unlock saved PostgreSQL connections after recovery. A snapshot must be treated as private user data.

## References

- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [App Service Linux pricing and F1 quotas](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/)
- [Azure SQL free offer and AutoPause](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-tier?view=azuresql)
- [HCP Terraform Azure dynamic credentials](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/azure-configuration)
- [Azure Pipelines free parallel-job grants](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops)
