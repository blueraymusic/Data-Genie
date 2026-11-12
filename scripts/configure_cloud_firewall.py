"""Allow only this web app's actual egress addresses to reach its Azure SQL DB."""
import ipaddress
import json
import os
import re
import subprocess


def azure(*arguments):
    return subprocess.check_output(["az", *arguments, "--output", "json", "--only-show-errors"], text=True)


def arm_value(document, name):
    """Azure CLI returns either its flattened SDK shape or ARM properties."""
    if not isinstance(document, dict) or not isinstance(document.get('properties', {}), dict):
        raise SystemExit('Azure returned malformed resource properties.')
    flattened, nested = document.get(name), document.get('properties', {}).get(name)
    if flattened is not None and nested is not None and (type(flattened) is not type(nested) or flattened != nested):
        raise SystemExit('Azure returned conflicting resource properties.')
    return flattened if flattened is not None else nested


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
    plan_id = arm_value(app, 'serverFarmId')
    if not isinstance(plan_id, str) or not plan_id:
        raise SystemExit('Azure did not return the web app hosting plan ID.')
    plan = json.loads(azure("appservice", "plan", "show", "--ids", plan_id))
    expected_sku = os.environ.get("GENIE_APP_SERVICE_SKU", "F1")
    if not isinstance(plan, dict) or not isinstance(plan.get("sku"), dict) or not isinstance(plan.get("properties", {}), dict):
        raise SystemExit("Azure did not return a usable hosting plan for validation.")
    sku = plan["sku"]
    # Azure CLI can return raw ARM properties or its older flattened shape.
    # A null flattened field can accompany the raw ARM shape; require an
    # explicit true flag and reject any non-null conflicting or malformed flag.
    reserved_flags = [owner["reserved"] for owner in (plan, plan.get("properties", {}))
                      if "reserved" in owner and owner["reserved"] is not None]
    if expected_sku not in {"F1", "B1"} or sku.get("name") != expected_sku or not reserved_flags or any(value is not True for value in reserved_flags):
        raise SystemExit("Deployment requires the explicitly selected Linux F1 or single-instance B1 plan.")
    if expected_sku == "B1" and (type(sku.get("capacity")) is not int or sku["capacity"] != 1):
        raise SystemExit("The budgeted B1 plan must have exactly one instance.")
    server = configured_sql_server(group, name)
    database = json.loads(azure("sql", "db", "show", "--resource-group", group,
                                "--server", server, "--name", "data-genie-state"))
    if arm_value(database, "useFreeLimit") is not True or arm_value(database, "freeLimitExhaustionBehavior") != "AutoPause":
        raise SystemExit("The database must confirm useFreeLimit=true and AutoPause before deployment.")
    outbound = arm_value(app, 'outboundIpAddresses')
    if not isinstance(outbound, str):
        raise SystemExit('Azure did not return usable web-app egress addresses.')
    addresses = sorted({str(ipaddress.IPv4Address(value.strip()))
                        for value in outbound.split(",") if value.strip()})
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
