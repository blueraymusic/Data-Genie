"""Allow only this web app's actual egress addresses to reach its Azure SQL DB."""
import ipaddress
import json
import os
import re
import subprocess


def azure(*arguments):
    return subprocess.check_output(["az", *arguments, "--output", "json", "--only-show-errors"], text=True)


def configured_sql_server(group, name):
    # Query only the host setting, never the app's API keys or SQL password.
    host = json.loads(azure("webapp", "config", "appsettings", "list",
                            "--resource-group", group, "--name", name,
                            "--query", "[?name=='GENIE_SQL_HOST'].value | [0]"))
    suffix = ".database.windows.net"
    if not isinstance(host, str) or not host.endswith(suffix):
        raise SystemExit("The web app must have a valid GENIE_SQL_HOST setting.")
    server = host[:-len(suffix)]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", server):
        raise SystemExit("The configured Azure SQL server name is invalid.")
    return server


def main(check_only=False):
    group, name = os.environ["GENIE_RESOURCE_GROUP"], os.environ["GENIE_APP_NAME"]
    app = json.loads(azure("webapp", "show", "--resource-group", group, "--name", name))
    # Match the reviewed tier and OS; Windows B1 has a different price.
    plan = json.loads(azure("appservice", "plan", "show", "--ids", app["serverFarmId"]))
    expected_sku = os.environ.get("GENIE_APP_SERVICE_SKU", "F1")
    if expected_sku not in {"F1", "B1"} or plan.get("sku", {}).get("name") != expected_sku or plan.get("reserved") is not True:
        raise SystemExit("Deployment requires the explicitly selected Linux F1 or single-instance B1 plan.")
    if expected_sku == "B1" and plan.get("sku", {}).get("capacity") != 1:
        raise SystemExit("The budgeted B1 plan must have exactly one instance.")
    server = configured_sql_server(group, name)
    database = json.loads(azure("sql", "db", "show", "--resource-group", group,
                                "--server", server, "--name", "data-genie-state"))
    if database.get("useFreeLimit") is not True or database.get("freeLimitExhaustionBehavior") != "AutoPause":
        raise SystemExit("The database must confirm useFreeLimit=true and AutoPause before deployment.")
    addresses = sorted({str(ipaddress.IPv4Address(value.strip()))
                        for value in app.get("outboundIpAddresses", "").split(",") if value.strip()})
    if not addresses:
        raise SystemExit("No web-app egress addresses were returned.")
    if check_only:
        rules = json.loads(azure("sql", "server", "firewall-rule", "list",
                                 "--resource-group", group, "--server", server))
        if any(rule["startIpAddress"] != rule["endIpAddress"] or rule["startIpAddress"] == "0.0.0.0"
               for rule in rules):
            raise SystemExit("SQL must not allow address ranges or the broad Allow Azure services rule.")
        allowed = {rule["startIpAddress"] for rule in rules}
        if set(addresses) - allowed:
            raise SystemExit("The app's current egress addresses need reviewed SQL firewall rules before deployment.")
        print("Hosting budget, SQL free-offer safeguards and current egress rules verified.")
        return
    for address in addresses:
        azure("sql", "server", "firewall-rule", "create", "--resource-group", group,
              "--server", server, "--name", "genie-web-" + address.replace(".", "-"),
              "--start-ip-address", address, "--end-ip-address", address)
    print("Hosting budget and SQL free-offer safeguards verified; web-app egress rules configured.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify existing rules without changing SQL network access.")
    main(check_only=parser.parse_args().check)
