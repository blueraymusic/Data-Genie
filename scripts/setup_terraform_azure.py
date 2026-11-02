"""One-time, explicit setup of a resource-group-scoped HCP Terraform identity.

Run in Azure Cloud Shell after reviewing this file. --apply creates an Entra app,
service principal, Contributor assignment on one resource group, and two OIDC
trusts. It never creates a client secret or paid Azure resource.
"""
import argparse
import json
import subprocess


def az(*arguments):
    return json.loads(subprocess.check_output(["az", *arguments, "--output", "json", "--only-show-errors"], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--terraform-project", required=True, help="Exact project name shown in HCP Terraform")
    parser.add_argument("--subscription", required=True, help="Your Azure subscription ID")
    parser.add_argument("--resource-group", default="data_genie")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    scope = f"/subscriptions/{args.subscription}/resourceGroups/{args.resource_group}"
    print("Identity: data-genie-terraform; Contributor scope:", scope)
    for phase in ("plan", "apply"):
        print("OIDC subject:", f"organization:blueray321:project:{args.terraform_project}:workspace:Data-Genie:run_phase:{phase}")
    if not args.apply:
        print("Preview only. Review these permissions before running again with --apply.")
        return
    subprocess.run(["az", "account", "set", "--subscription", args.subscription], check=True)
    group = az("group", "show", "--name", args.resource_group)
    account = az("account", "show")
    matches = az("ad", "app", "list", "--display-name", "data-genie-terraform")
    if matches:
        raise SystemExit("An app with this name exists. Reuse or inspect it manually; this script won't grant access to an unknown identity.")
    app = az("ad", "app", "create", "--display-name", "data-genie-terraform")
    principal = az("ad", "sp", "create", "--id", app["appId"])
    az("role", "assignment", "create", "--assignee-object-id", principal["id"],
       "--assignee-principal-type", "ServicePrincipal", "--role", "Contributor", "--scope", group["id"])
    for phase in ("plan", "apply"):
        trust = {"name": "terraform-" + phase, "issuer": "https://app.terraform.io",
                 "subject": f"organization:blueray321:project:{args.terraform_project}:workspace:Data-Genie:run_phase:{phase}",
                 "audiences": ["api://AzureADTokenExchange"]}
        az("ad", "app", "federated-credential", "create", "--id", app["appId"], "--parameters", json.dumps(trust))
    # These four values are identifiers/configuration, not passwords or tokens.
    print("\nTerraform workspace environment variables:")
    print("ARM_SUBSCRIPTION_ID=" + args.subscription)
    print("ARM_TENANT_ID=" + account["tenantId"])
    print("TFC_AZURE_PROVIDER_AUTH=true")
    print("TFC_AZURE_RUN_CLIENT_ID=" + app["appId"])


if __name__ == "__main__":
    main()
