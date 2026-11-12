# Azure hosting

[Main README](../README.md) · [Backend](../backend/README.md) · [Deployment guide](../docs/azure-free-hosting.md)

The live site is [data-genie.space](https://data-genie.space/). It uses the existing Azure App Service B1 plan and cloud-backed application state. The MCP/OAuth endpoint shares that app; it does not create another hosting instance or authentication subscription.

The current hosting plan is funded through student credit. It is not a free Azure tier. Existing usage allowances, AI quotas, and spending limits still apply.

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
