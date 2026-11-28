"""Removed Microsoft routes remain unavailable, even with old settings."""
import unittest
from unittest.mock import patch
from backend import microsoft_auth
from tests.test_http import HttpHarness


class RemovedMicrosoftRoutes(HttpHarness, unittest.TestCase):
    def test_microsoft_routes_do_not_start_a_provider_flow(self):
        with patch.object(microsoft_auth, "configuration", return_value={"client_id": "legacy"}), \
                patch.object(microsoft_auth, "begin") as begin:
            for path in ("/api/auth/microsoft/start", "/api/auth/microsoft/callback?code=unused&state=unused"):
                self.assertEqual(self.request("GET", path)[0], 404)
            self.assertEqual(self.request("POST", "/api/auth/microsoft/link", {"password": self.password})[0], 404)
        begin.assert_not_called()
