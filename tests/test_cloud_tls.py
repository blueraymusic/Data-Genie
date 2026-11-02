"""Real certificates and TLS handshakes for the hosted SQL compatibility hook."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    from OpenSSL import SSL, crypto
    import pytds
    import pytds.tls
    from backend.cloud_tls import install_hostname_verifier, validate_hostname
except ImportError:
    TLS_AVAILABLE = False
else:
    TLS_AVAILABLE = True


@unittest.skipUnless(TLS_AVAILABLE, "Install the optional Azure runtime dependencies for SQL TLS checks.")
class SqlTlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.root = cls.certificate("Fixture CA", [], ca=True)

    @classmethod
    def certificate(cls, common_name, dns_names, ca=False):
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
        now = datetime.now(timezone.utc)
        builder = (x509.CertificateBuilder().subject_name(subject)
                   .issuer_name(subject if ca else cls.root.subject)
                   .public_key((cls.root_key if ca else cls.server_key).public_key())
                   .serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=5))
                   .not_valid_after(now + timedelta(days=1))
                   .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True))
        if dns_names:
            builder = builder.add_extension(x509.SubjectAlternativeName([x509.DNSName(name) for name in dns_names]), critical=False)
        return builder.sign(cls.root_key, hashes.SHA256())

    def wrapped_certificate(self, common_name="unrelated.example.test", dns_names=None):
        return crypto.X509.from_cryptography(self.certificate(common_name, dns_names or []))

    def test_exact_case_insensitive_and_single_label_wildcard_sans(self):
        for dns, host in (("genie.database.windows.net", b"genie.database.windows.net"),
                          ("GENIE.database.windows.net", b"genie.database.windows.net"),
                          ("*.database.windows.net", b"genie.database.windows.net")):
            with self.subTest(dns=dns, host=host):
                self.assertTrue(validate_hostname(self.wrapped_certificate(dns_names=[dns]), host))

    def test_wrong_hosts_wildcard_depth_cn_fallback_and_invalid_names_are_rejected(self):
        cases = [
            ("genie.database.windows.net", ["different.database.windows.net"], b"genie.database.windows.net"),
            ("genie.database.windows.net", [], b"genie.database.windows.net"),
            ("unrelated", ["*.database.windows.net"], b"nested.genie.database.windows.net"),
            ("unrelated", ["*.database.windows.net"], b"database.windows.net"),
            ("unrelated", ["gen*.database.windows.net"], b"genie.database.windows.net"),
            ("unrelated", ["*.*.windows.net"], b"genie.database.windows.net"),
            ("unrelated", ["genie.database.windows.net"], b"genie.database.windows.net\x00.attacker.test"),
            ("unrelated", ["genie.database.windows.net"], b"\xff.database.windows.net"),
            ("127.0.0.1", ["genie.database.windows.net"], b"127.0.0.1"),
        ]
        for common_name, dns, host in cases:
            with self.subTest(common_name=common_name, dns=dns, host=host):
                self.assertFalse(validate_hostname(self.wrapped_certificate(common_name, dns), host))
        self.assertFalse(validate_hostname(None, b"genie.database.windows.net"))
        certificate = self.wrapped_certificate(dns_names=["genie.database.windows.net"])
        with patch.object(certificate, "to_cryptography", side_effect=ValueError("malformed certificate")):
            self.assertFalse(validate_hostname(certificate, b"genie.database.windows.net"))

    def handshake(self, trust_certificate, server_certificate):
        with tempfile.TemporaryDirectory(prefix="genie-tls-ca-") as temporary:
            ca_file = Path(temporary) / "ca.pem"
            ca_file.write_bytes(trust_certificate.public_bytes(serialization.Encoding.PEM))
            client_context = pytds.tls.create_context(str(ca_file))
        self.assertEqual(client_context.get_verify_mode(), SSL.VERIFY_PEER)
        server_context = SSL.Context(SSL.TLS_SERVER_METHOD)
        server_context.use_certificate(server_certificate)
        server_context.use_privatekey(self.server_key)
        client, server = SSL.Connection(client_context), SSL.Connection(server_context)
        client.set_connect_state()
        server.set_accept_state()
        finished = set()
        for _ in range(50):
            for peer in (client, server):
                try:
                    peer.do_handshake()
                    finished.add(peer)
                except SSL.WantReadError:
                    pass
            for sender, receiver in ((client, server), (server, client)):
                while True:
                    try:
                        receiver.bio_write(sender.bio_read(65536))
                    except SSL.WantReadError:
                        break
            if len(finished) == 2:
                return client
        self.fail("TLS handshake did not finish")

    def test_driver_still_checks_the_trusted_certificate_chain(self):
        install_hostname_verifier()
        certificate = self.certificate("unrelated", ["genie.database.windows.net"])
        connection = self.handshake(self.root, certificate)
        self.assertTrue(pytds.tls.validate_host(connection.get_peer_certificate(), b"genie.database.windows.net"))
        self.assertFalse(pytds.tls.validate_host(connection.get_peer_certificate(), b"wrong.database.windows.net"))
        wrong_ca = self.certificate("Different CA", [], ca=True)
        with self.assertRaises(SSL.Error):
            self.handshake(wrong_ca, certificate)

    def test_cloud_connect_keeps_ca_hostname_and_full_stream_encryption_enabled(self):
        import certifi
        from backend import cloud_state
        with patch.dict("os.environ", {"GENIE_SQL_HOST": "genie.database.windows.net"}), \
                patch.object(pytds, "connect") as connect:
            cloud_state.connect()
        self.assertIs(pytds.tls.validate_host, validate_hostname)
        self.assertTrue(connect.call_args.kwargs["validate_host"])
        self.assertFalse(connect.call_args.kwargs["enc_login_only"])
        self.assertEqual(connect.call_args.kwargs["cafile"], certifi.where())
