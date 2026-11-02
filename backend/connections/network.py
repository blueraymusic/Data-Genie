"""Prevent hosted database connectors from reaching private cloud services."""
import ipaddress
import socket


def public_address(host, port):
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if host.lower() == "localhost" or (literal is not None and not literal.is_global):
        raise ValueError("Hosted Data Genie can connect only to public PostgreSQL addresses.")
    try:
        addresses = [item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
    except OSError:
        raise ValueError("The PostgreSQL hostname could not be resolved.") from None
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Hosted Data Genie cannot connect to private or internal network addresses.")
    # Pin the checked address so a second DNS lookup cannot redirect to a private IP.
    return addresses[0]
