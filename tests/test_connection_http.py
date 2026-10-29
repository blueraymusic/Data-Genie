"""Connection testing stays behind the app's existing authentication boundary."""

import unittest
import importlib.util
from unittest.mock import patch
from tests.test_http import HttpHarness
import workbench
from connections import ConnectionFailure


class ConnectionHttpTests(HttpHarness, unittest.TestCase):
    def test_resume_errors_have_recovery_actions_and_keep_the_current_session(self):
        for failure in (
            ConnectionFailure("Database server is offline.", "postgres_unavailable"),
            ConnectionFailure("Saved connection details are missing.", "connection_missing", "reconnect", 409),
            ConnectionFailure("Connector packages are missing.", "postgres_support_missing", "restart_server"),
        ):
            with self.subTest(code=failure.code), patch.object(workbench, "resume_session", side_effect=failure):
                status, result = self.request("POST", "/api/sessions/resume", {"session_id":self.session_id}, self.session_id)
                self.assertEqual(status, failure.status)
                self.assertEqual(result["code"], failure.code)
                self.assertEqual(result["recovery"], failure.recovery)
                self.assertIsNone(workbench.get_repository().get_session(self.session_id)["ended_at"])

    def test_switch_to_an_existing_database_ends_the_previous_session_after_success(self):
        status, target = self.request("POST", "/api/sessions", {"database_mode":"create", "database_name":"second.sqlite3"})
        self.assertEqual(status,201)
        status, result = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(result["session_id"],target["session_id"])
        self.assertIsNotNone(workbench.get_repository().get_session(self.session_id)["ended_at"])
        self.assertIsNone(workbench.get_repository().get_session(target["session_id"])["ended_at"])

    def test_switch_checks_ownership_of_the_current_session_too(self):
        import authentication
        repository = workbench.get_repository()
        other = authentication.Accounts(repository).register("Other", "Reader", "other@example.test", "another long fixture password")
        other_session = workbench.start_session("Other", "Reader", "other@example.test", path=workbench.DEFAULT_DB_PATH, account_id=other["account_id"])
        with patch.object(workbench, "resume_session") as resume:
            status, _ = self.request("POST", "/api/sessions/resume", {"session_id":self.session_id}, other_session["session_id"])
        self.assertEqual(status,403)
        resume.assert_not_called()
        self.assertIsNone(repository.get_session(other_session["session_id"])["ended_at"])

    def test_an_ended_current_session_does_not_block_opening_another_saved_database(self):
        status, target = self.request("POST", "/api/sessions", {"database_mode":"create", "database_name":"another.sqlite3"})
        self.assertEqual(status,201)
        workbench.end_session(self.session_id)
        status, result = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(result["session_id"],target["session_id"])

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


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Optional PostgreSQL dependencies are not installed")
class SavedPostgresHttpTests(HttpHarness, unittest.TestCase):
    def saved_postgres(self):
        with patch.object(workbench.PostgresConnector, "schema", return_value=[]):
            status, target = self.request("POST", "/api/sessions", {
                "database_mode":"postgresql", "connection_url":"postgresql://reader:fixture-password@localhost/shop",
            })
        self.assertEqual(status,201)
        workbench.end_session(target["session_id"])
        return target

    def test_missing_key_is_not_replaced_or_treated_as_an_empty_database(self):
        target = self.saved_postgres()
        key = workbench.CredentialVault(workbench.get_repository().path).key_path
        key.unlink()
        status, result = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,409)
        self.assertEqual(result["code"],"connection_key_missing")
        self.assertEqual(result["recovery"],"reconnect")
        self.assertFalse(key.exists())
        self.assertIsNone(workbench.get_repository().get_session(self.session_id)["ended_at"])

    def test_missing_saved_configuration_offers_reconnection(self):
        target = self.saved_postgres()
        repository = workbench.get_repository()
        with repository._connection(write=True) as connection:
            connection.execute("DELETE FROM external_connections WHERE connection_id=?", (target["connection_id"],))
        status, result = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,409)
        self.assertEqual(result["code"],"connection_missing")
        self.assertIsNone(repository.get_session(self.session_id)["ended_at"])

    def test_failed_reopen_does_not_leave_an_active_ghost_session(self):
        target = self.saved_postgres()
        failure = ConnectionFailure("Database server stopped.", "postgres_unavailable")
        with patch.object(workbench.PostgresConnector, "schema", side_effect=[[], failure]):
            status, _ = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,503)
        sessions = workbench.get_repository().list_sessions(account_id=target["account_id"])
        self.assertTrue(all(item["ended_at"] for item in sessions if item["connection_id"]))
        self.assertIsNone(workbench.get_repository().get_session(self.session_id)["ended_at"])

    def test_reopening_saved_postgres_preserves_the_connection_id(self):
        target = self.saved_postgres()
        with patch.object(workbench.PostgresConnector, "schema", return_value=[]):
            status, result = self.request("POST", "/api/sessions/resume", {"session_id":target["session_id"]}, self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(result["connection_id"],target["connection_id"])
        self.assertIsNotNone(workbench.get_repository().get_session(self.session_id)["ended_at"])
