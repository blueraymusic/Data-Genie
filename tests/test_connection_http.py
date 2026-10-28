"""Connection testing stays behind the app's existing authentication boundary."""

import unittest
from unittest.mock import patch
from tests.test_http import HttpHarness
import workbench


class ConnectionHttpTests(HttpHarness, unittest.TestCase):
    def test_probe_requires_login_and_csrf_without_contacting_the_database(self):
        cookie, csrf = self.cookie, self.csrf
        with patch.object(workbench, "test_postgres_connection") as probe:
            self.cookie = ""
            self.assertEqual(self.request("POST", "/api/connections/test", {})[0],401)
            self.cookie = cookie
            self.csrf = "incorrect"
            self.assertEqual(self.request("POST", "/api/connections/test", {})[0],403)
            probe.assert_not_called()
        self.csrf = csrf

    def test_probe_returns_only_connection_summary(self):
        summary = {"connected": True, "provider": "postgresql", "database": "shop", "tables": ["customers"], "table_count": 1}
        with patch.object(workbench, "test_postgres_connection", return_value=summary):
            status, result = self.request("POST", "/api/connections/test", {"connection_url":"postgresql://user:private-password@host/shop"})
        self.assertEqual(status,200)
        self.assertEqual(result,summary)
        self.assertNotIn("private-password", str(result))
