"""Regressions for history availability, result integrity, and startup errors."""

import errno
import io
import sqlite3
import unittest
from unittest.mock import patch

from tests.test_http import HttpHarness
import server
import workbench
import authentication
import settings
from scripts import start_server


class AppAuditTests(HttpHarness, unittest.TestCase):
    def test_an_explicitly_empty_environment_key_disables_the_local_file_key(self):
        with patch.dict("os.environ",{"GEMINI_API_KEY":""}), patch.object(settings,"_local_values",return_value={"GEMINI_API_KEY":"fixture-key"}):
            self.assertEqual(settings.gemini_settings()["api_key"],"")
            self.assertFalse(settings.public_ai_settings()["enabled"])

    def test_expired_responses_do_not_delete_a_newer_browser_cookie(self):
        old_cookie, old_csrf = self.cookie, self.csrf
        accounts = authentication.Accounts(workbench.get_repository())
        accounts.logout(old_cookie.split("=",1)[1])
        newer = accounts.issue_login(self.account["account_id"])
        for method, path in (("GET","/api/auth/session"),("GET","/api/status"),("POST","/api/sessions/end")):
            self.cookie, self.csrf = old_cookie, old_csrf
            status, _ = self.request(method,path,{} if method == "POST" else None,self.session_id)
            self.assertIn(status,(200,401))
            self.assertNotIn("Set-Cookie:",self.last_headers)
        self.cookie = authentication.COOKIE_NAME + "=" + newer
        self.assertEqual(self.request("GET","/api/auth/session")[1]["user"]["account_id"],self.account["account_id"])

    def test_history_is_available_after_ending_the_only_session(self):
        self.request("POST", "/api/ask", {"question":"count notes"}, self.session_id)
        workbench.end_session(self.session_id)
        status, data = self.request("GET", "/api/history?history_session_id=" + self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(data["requests"][0]["commands"][0]["result"]["payload"]["rows"],[{"row_count":2}])

    def test_history_snapshot_does_not_need_a_live_database_even_for_pending_changes(self):
        self.request("POST", "/api/query", {"sql":"INSERT INTO notes(body) VALUES ('pending')"}, self.session_id)
        with patch.object(workbench,"session_scope",side_effect=AssertionError("A snapshot must not open its database")):
            status, data = self.request("GET", "/api/history?history_session_id=" + self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(data["requests"][0]["commands"][0]["status"],"pending")

    def test_history_without_a_live_session_still_checks_account_ownership(self):
        original = self.session_id
        self.request("POST", "/api/auth/register", {"first_name":"Other","last_name":"Reader","email":"audit-other@example.test","password":"another long fixture password"})
        status, _ = self.request("GET", "/api/history?history_session_id=" + original)
        self.assertEqual(status,403)

    def test_sqlite_preserves_large_integers_and_duplicate_join_labels(self):
        sql = "SELECT 9007199254740993 AS value,id AS item,id+1 AS item,id+2 AS item_2 FROM notes ORDER BY notes.id LIMIT 1"
        status, result = self.request("POST", "/api/query", {"sql":sql}, self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(result["rows"],[{"value":"9007199254740993","item":1,"item_3":2,"item_2":3}])

    def test_committed_table_change_stays_executed_if_schema_refresh_fails(self):
        _, pending = self.request("POST", "/api/query", {"sql":"CREATE TABLE widgets(id INTEGER PRIMARY KEY)"}, self.session_id)
        with patch.object(workbench,"_sync",side_effect=ValueError("The structure is unavailable")):
            status, result = self.request("POST", "/api/commands/confirm", {"command_id":pending["command_id"],"confirmation_token":pending["confirmation_token"]}, self.session_id)
        self.assertEqual(status,200)
        self.assertEqual(result["status"],"executed")
        self.assertIn("change was applied",result["schema_warning"])
        with sqlite3.connect(self.session["path"],factory=workbench.Conn) as db:
            self.assertIsNotNone(db.execute("SELECT name FROM sqlite_master WHERE name='widgets'").fetchone())
        command = workbench.get_repository().get_command(pending["command_id"],self.session_id)
        self.assertEqual(command["status"],"executed")

    def test_timed_out_sqlite_write_rolls_back(self):
        path = self.root / "bounded.sqlite3"
        with sqlite3.connect(path,factory=workbench.Conn) as db:
            db.execute("CREATE TABLE numbers(value INTEGER)")
        with patch.object(workbench,"SQLITE_QUERY_TIMEOUT",0), self.assertRaisesRegex(ValueError,"timed out"):
            with sqlite3.connect(path,factory=workbench.Conn) as db:
                db.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000) INSERT INTO numbers SELECT x FROM n")
        with sqlite3.connect(path,factory=workbench.Conn) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM numbers").fetchone()[0],0)

    def test_startup_does_not_claim_success_when_the_port_is_busy(self):
        output = io.StringIO()
        with patch.dict("os.environ",{"PORT":"8000"}), patch.object(server,"ThreadingHTTPServer",side_effect=OSError(errno.EADDRINUSE,"busy")), patch("sys.stdout",output):
            with self.assertRaisesRegex(SystemExit,"already in use"):
                server.main()
        self.assertNotIn("running at",output.getvalue())

    def test_startup_reports_invalid_ports_without_a_traceback(self):
        with patch.dict("os.environ",{"PORT":"not-a-port"}), self.assertRaisesRegex(SystemExit,"between 1 and 65535"):
            server.main()

    def test_launcher_forwards_a_requested_port(self):
        with patch("sys.argv",["start_server.py","8001"]), patch.object(start_server.os,"execv") as launch:
            start_server.main()
        self.assertEqual(launch.call_args.args[1][-1],"8001")
