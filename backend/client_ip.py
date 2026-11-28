"""Resolve auth-limit identities at the deployment's explicit proxy boundary.

App Service's Front End overwrites ``Client-IP`` before forwarding a request:
https://github.com/Azure/app-service-linux-docs/blob/master/Things_You_Should_Know/headers.md
This guarantee does not apply to a local server or an arbitrary reverse proxy.
Gunicorn's forwarded_allow_ips controls scheme headers, not REMOTE_ADDR.
"""

import ipaddress
import os
import re


UNKNOWN_CLIENT = "unknown"
_AZURE_HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+azurewebsites\.net", re.I)


def normalize_ip(value):
    """Normalize one IP or IP:port, never a forwarded list or scoped address."""
    if not isinstance(value, str) or not value or len(value) > 128:
        return None
    if any(char in value for char in "\r\n\x00,%"):
        return None
    value = value.strip()
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        # Brackets disambiguate an IPv6 port. A bare IPv6 address is always
        # parsed as an address above; never guess that its final group is a port.
        bracketed = re.fullmatch(r"\[([0-9a-fA-F:.]+)\](?::([0-9]{1,5}))?", value)
        ipv4_port = re.fullmatch(r"([^:]+):([0-9]{1,5})", value)
        match = bracketed or ipv4_port
        if not match:
            return None
        if match.group(2) is not None and not 1 <= int(match.group(2)) <= 65535:
            return None
        try:
            address = ipaddress.ip_address(match.group(1))
        except ValueError:
            return None
        if (bracketed and address.version != 6) or (ipv4_port and address.version != 4):
            return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return str(address)


def azure_app_service():
    """Only deployment-owned process variables enable the Azure header trust."""
    return (os.environ.get("GENIE_CLOUD_STATE") == "azure_sql"
            and bool(_AZURE_HOST.fullmatch(os.environ.get("WEBSITE_HOSTNAME", ""))))


def client_ip(environ):
    """Return a bounded, canonical limiter key; invalid Azure headers fail closed.

    All missing/invalid Azure-owned headers share UNKNOWN_CLIENT rather than
    falling back to a proxy address or accepting caller-controlled XFF entries.
    Forwarded headers are ignored outside the explicit App Service runtime.
    Keep IPs/keys out of public responses. Production verification can exercise
    limits from two controlled network sources while forging Client-IP and XFF;
    the forged values must not produce new buckets, and the second real source
    must retain its own allowance. No diagnostic endpoint is necessary.
    """
    field = "HTTP_CLIENT_IP" if azure_app_service() else "REMOTE_ADDR"
    return normalize_ip(environ.get(field)) or UNKNOWN_CLIENT
