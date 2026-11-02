"""Allow only this web app's actual egress addresses to reach its Azure SQL DB."""
import ipaddress
import json
import os
import subprocess


def azure(*arguments):
    return subprocess.check_output(["az", *arguments, "--output", "json", "--only-show-errors"], text=True)


def main():
    group, name = os.environ["GENIE_RESOURCE_GROUP"], os.environ["GENIE_APP_NAME"]
    app = json.loads(azure("webapp", "show", "--resource-group", group, "--name", name))
    # Block deployment if someone has changed the infrastructure to a paid plan.
    plan = json.loads(azure("appservice", "plan", "show", "--ids", app["serverFarmId"]))
    if plan.get("sku", {}).get("name") != "F1":
        raise SystemExit("Deployment requires the F1 free plan.")
    database = json.loads(azure("sql", "db", "show", "--resource-group", group,
                                "--server", name + "-sql", "--name", "data-genie-state"))
    if database.get("useFreeLimit") is not True or database.get("freeLimitExhaustionBehavior") != "AutoPause":
        raise SystemExit("The database must confirm useFreeLimit=true and AutoPause before deployment.")
    addresses = sorted({str(ipaddress.IPv4Address(value.strip()))
                        for value in app["possibleOutboundIpAddresses"].split(",") if value.strip()})
    if not addresses:
        raise SystemExit("No web-app egress addresses were returned.")
    for address in addresses:
        azure("sql", "server", "firewall-rule", "create", "--resource-group", group,
              "--server", name + "-sql", "--name", "genie-web-" + address.replace(".", "-"),
              "--start-ip-address", address, "--end-ip-address", address)
    print("Free-tier safeguards verified; web-app egress rules configured.")


if __name__ == "__main__":
    main()
