"""Hostname verification for python-tds 1.17.1 with current pyOpenSSL.

The released driver still calls the removed X509.get_extension API. Only its
hostname callback is replaced; its trusted-CA handshake and full-session TLS
remain enabled. Remove this adapter when a compatible driver is released.
"""
from service_identity import CertificateError, VerificationError
from service_identity.cryptography import verify_certificate_hostname


def validate_hostname(cert, name: bytes) -> bool:
    if cert is None:
        return False
    try:
        verify_certificate_hostname(cert.to_cryptography(), name.decode("ascii"))
    except (CertificateError, VerificationError, ValueError, UnicodeError):
        return False
    return True


def install_hostname_verifier():
    import pytds.tls
    # This process uses pytds only for hosted Azure SQL. Assignment is idempotent
    # and permanent, so concurrent connects never restore an obsolete callback.
    pytds.tls.validate_host = validate_hostname
