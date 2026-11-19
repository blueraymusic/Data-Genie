"""Spoof-resistant identity selection for direct Azure App Service hosting."""

import unittest
from io import BytesIO
from unittest.mock import patch

from backend.client_ip import UNKNOWN_CLIENT, azure_app_service, client_ip, normalize_ip
from backend.wsgi import Request


class ClientIPTests(unittest.TestCase):
    def test_wsgi_auth_identity_uses_normalized_azure_header_not_proxy_peer(self):
        with patch.dict("os.environ", {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": "genie.azurewebsites.net"}):
            request = Request({"wsgi.input": BytesIO(), "REMOTE_ADDR": "169.254.130.1",
                               "HTTP_CLIENT_IP": "[::ffff:192.0.2.4]:48230",
                               "HTTP_X_FORWARDED_FOR": "198.51.100.5"})
            self.assertEqual(request.client_address[0], "192.0.2.4")

    def test_ip_and_socket_formats_normalize_to_one_identity(self):
        samples = {
            "192.0.2.4": "192.0.2.4",
            " 192.0.2.4:48230 ": "192.0.2.4",
            "2001:0DB8:0:0::1": "2001:db8::1",
            "[2001:db8::1]": "2001:db8::1",
            "[2001:db8::1]:65535": "2001:db8::1",
            "2001:db8::1:443": "2001:db8::1:443",
            "::ffff:192.0.2.4": "192.0.2.4",
            "[::ffff:c000:204]:1234": "192.0.2.4",
        }
        for raw, expected in samples.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_ip(raw), expected)

    def test_invalid_or_ambiguous_values_are_never_identities(self):
        for raw in (None, 4, True, "", "unknown", "example.com", "192.0.2.4, 192.0.2.5",
                    "192.0.2.4:0", "192.0.2.4:65536", "192.0.2.4:http", "[192.0.2.4]:1234",
                    "[2001:db8::1]:", "[2001:db8::1]:99999", "fe80::1%eth0", "192.0.2.4\n",
                    "0192.0.2.4", "192.0.2.4\x00", "a" * 129):
            with self.subTest(raw=raw):
                self.assertIsNone(normalize_ip(raw))

    def test_local_and_other_hosting_ignore_every_forwarded_header(self):
        request = {"REMOTE_ADDR": "::ffff:192.0.2.4", "HTTP_CLIENT_IP": "198.51.100.5",
                   "HTTP_X_CLIENT_IP": "198.51.100.6", "HTTP_X_FORWARDED_FOR": "198.51.100.7",
                   "HTTP_WEBSITE_HOSTNAME": "genie.azurewebsites.net", "HTTP_GENIE_CLOUD_STATE": "azure_sql"}
        for config in ({"GENIE_CLOUD_STATE": "", "WEBSITE_HOSTNAME": ""},
                       {"GENIE_CLOUD_STATE": "", "WEBSITE_HOSTNAME": "genie.azurewebsites.net"},
                       {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": "genie.example.test"}):
            with self.subTest(config=config), patch.dict("os.environ", config):
                self.assertFalse(azure_app_service())
                self.assertEqual(client_ip(request), "192.0.2.4")

    def test_azure_uses_only_the_platform_owned_client_ip(self):
        with patch.dict("os.environ", {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": "genie.azurewebsites.net"}):
            self.assertTrue(azure_app_service())
            self.assertEqual(client_ip({"REMOTE_ADDR": "169.254.130.1", "HTTP_CLIENT_IP": "192.0.2.4:48230",
                                        "HTTP_X_CLIENT_IP": "198.51.100.5", "HTTP_X_FORWARDED_FOR": "198.51.100.6"}),
                             "192.0.2.4")

    def test_azure_missing_or_invalid_header_fails_closed_to_one_shared_bucket(self):
        with patch.dict("os.environ", {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": "genie.azurewebsites.net"}):
            for header in (None, "", "unknown", "192.0.2.4, 198.51.100.5", "192.0.2.4:70000"):
                with self.subTest(header=header):
                    self.assertEqual(client_ip({"REMOTE_ADDR": "169.254.130.1", "HTTP_CLIENT_IP": header,
                                                "HTTP_X_FORWARDED_FOR": "192.0.2.4"}), UNKNOWN_CLIENT)

    def test_runtime_marker_must_be_an_actual_azure_hostname(self):
        for hostname in ("azurewebsites.net", "evilazurewebsites.net", "genie.azurewebsites.net.evil.test",
                         "https://genie.azurewebsites.net", "genie.azurewebsites.net:443", "genie..azurewebsites.net",
                         "-genie.azurewebsites.net", "genie.azurewebsites.net/path"):
            with self.subTest(hostname=hostname), patch.dict("os.environ", {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": hostname}):
                self.assertFalse(azure_app_service())
        with patch.dict("os.environ", {"GENIE_CLOUD_STATE": "azure_sql", "WEBSITE_HOSTNAME": "genie-hash.francecentral-01.azurewebsites.net"}):
            self.assertTrue(azure_app_service())

    def test_invalid_peer_is_one_bucket_and_never_falls_back_to_forwarded_headers(self):
        with patch.dict("os.environ", {"GENIE_CLOUD_STATE": "", "WEBSITE_HOSTNAME": ""}):
            self.assertEqual(client_ip({"REMOTE_ADDR": "garbage", "HTTP_CLIENT_IP": "192.0.2.4"}), UNKNOWN_CLIENT)
