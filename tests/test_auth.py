"""Authentication, browser security, and isolation across real HTTP routes."""

from unittest.mock import patch
import unittest
import sqlite3
import time

import authentication
import workbench
from repository import Repository
from tests.test_http import HttpHarness


class AccountTests(HttpHarness, unittest.TestCase):
    def test_credentials_are_hashed_and_cookie_is_http_only(self):
        self.request("POST", "/api/auth/login", {"email":"ADA@example.com", "password":self.password})
        self.assertIn("HttpOnly", self.last_headers)
        self.assertIn("SameSite=Strict", self.last_headers)
        self.assertNotIn("password", self.account)
        with sqlite3.connect(workbench.REPOSITORY_PATH, factory=workbench.Conn) as connection:
            encoded = connection.execute("SELECT password_hash FROM accounts").fetchone()[0]
            stored_tokens = [row[0] for row in connection.execute("SELECT token_hash FROM browser_logins")]
        self.assertTrue(encoded.startswith("pbkdf2_sha256$600000$"))
        self.assertNotIn(self.password, encoded)
        self.assertNotIn(self.cookie.split("=", 1)[1], stored_tokens)

    def test_registration_validation_and_login_errors(self):
        payload = {"first_name":"Test", "last_name":"Reader", "email":"ADA@example.com", "password":self.password}
        self.assertEqual(self.request("POST", "/api/auth/register", payload)[0], 400)
        self.assertEqual(self.request("POST", "/api/auth/register", {**payload, "email":"new@example.com", "password":"short"})[0], 400)
        status, response = self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":"incorrect password"})
        self.assertEqual(status, 401)
        self.assertEqual(response["error"], "Email or password is incorrect.")
        status, response = self.request("POST", "/api/auth/login", {"email":"missing@example.com", "password":"incorrect password"})
        self.assertEqual(status, 401)
        self.assertEqual(response["error"], "Email or password is incorrect.")

    def test_logout_and_missing_auth_block_all_data_routes(self):
        old_cookie, old_csrf = self.cookie, self.csrf
        self.assertEqual(self.request("POST", "/api/auth/logout", {})[0], 200)
        for route in ("/api/status", "/api/history", "/api/schema", "/api/sessions", "/api/download?session_id=" + self.session_id):
            self.assertEqual(self.request("GET", route, session_id=self.session_id, extra_headers={"Cookie":old_cookie})[0], 401)
        status, data = self.request("GET", "/api/auth/session")
        self.assertEqual(data, {"user":None})
        self.assertEqual(self.request("POST", "/api/sessions", {"database_mode":"create"}, extra_headers={"Cookie":old_cookie,"X-CSRF-Token":old_csrf})[0], 401)

    def test_csrf_and_cross_origin_requests_are_blocked(self):
        for headers in ({"X-CSRF-Token":""}, {"X-CSRF-Token":"wrong"}, {"X-CSRF-Token":"é"}, {"Origin":"http://other.example"}, {"Sec-Fetch-Site":"cross-site"}):
            self.assertEqual(self.request("POST", "/api/ask", {"question":"count notes"}, self.session_id, headers)[0], 403)
        self.assertEqual(self.request("POST", "/api/auth/login", {}, extra_headers={"Content-Type":"text/plain"})[0], 400)
        self.assertEqual(self.request("GET", "/api/status", extra_headers={"Host":"evil.example"})[0], 403)

    def test_another_account_cannot_read_change_download_or_resume_a_session(self):
        target = self.session_id
        self.request("POST", "/api/auth/register", {"first_name":"Other", "last_name":"Reader", "email":"other@example.com", "password":self.password}, extra_headers={"Cookie":""})
        for route in ("/api/status", "/api/schema", "/api/history", "/api/sample?table=notes", "/api/download?session_id=" + target):
            self.assertEqual(self.request("GET", route, session_id=target)[0], 403, route)
        for route, payload in (("/api/ask", {"question":"count notes"}), ("/api/query", {"sql":"SELECT * FROM notes"}), ("/api/databases", {"name":"bad"}), ("/api/reset", {}), ("/api/conversation/reset", {}), ("/api/sessions/end", {}), ("/api/commands/confirm", {"command_id":1}), ("/api/connect", {}), ("/api/sessions/resume", {"session_id":target})):
            self.assertEqual(self.request("POST", route, payload, target)[0], 403, route)
        _, listed = self.request("GET", "/api/sessions")
        self.assertEqual(listed["sessions"], [])

    def test_identity_cannot_be_spoofed_and_history_checks_ownership(self):
        _, created = self.request("POST", "/api/sessions", {"database_mode":"create", "database_name":"owned", "email":"victim@example.com", "first_name":"Forged"})
        self.assertEqual(created["email"], self.account["email"])
        legacy = workbench.start_session("Ada", "Lovelace", "ada@example.com", path=workbench.DEFAULT_DB_PATH)
        self.assertEqual(self.request("GET", "/api/history?history_session_id=" + legacy["session_id"], session_id=created["session_id"])[0], 403)
        _, listed = self.request("GET", "/api/sessions")
        self.assertNotIn(legacy["session_id"], [item["session_id"] for item in listed["sessions"]])

    def test_password_change_revokes_other_logins_and_old_password(self):
        old_cookie = self.cookie
        other_token = authentication.Accounts(workbench.get_repository()).issue_login(self.account["account_id"])
        new_password = "a different long passphrase 84"
        self.assertEqual(self.request("POST", "/api/auth/password", {"current_password":"wrong", "new_password":new_password})[0], 400)
        self.assertEqual(self.request("POST", "/api/auth/password", {"current_password":self.password, "new_password":new_password})[0], 200)
        valid_cookie = self.cookie
        self.assertNotEqual(valid_cookie, old_cookie)
        for cookie in (old_cookie, authentication.COOKIE_NAME + "=" + other_token):
            self.assertEqual(self.request("GET", "/api/status", session_id=self.session_id, extra_headers={"Cookie":cookie})[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":self.password})[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":new_password})[0], 200)

    def test_idle_and_absolute_expiry_are_enforced_on_server(self):
        accounts = authentication.Accounts(workbench.get_repository())
        now = int(time.time())
        for seconds in (authentication.IDLE_LIFETIME + 1, authentication.LOGIN_LIFETIME + 1):
            with patch.object(authentication.time, "time", return_value=now):
                token = accounts.issue_login(self.account["account_id"])
            if seconds > authentication.LOGIN_LIFETIME:
                with sqlite3.connect(workbench.REPOSITORY_PATH, factory=workbench.Conn) as connection:
                    connection.execute("UPDATE browser_logins SET last_seen=? WHERE token_hash=?", (now + seconds - 10, authentication.token_hash(token)))
            with patch.object(authentication.time, "time", return_value=now + seconds):
                with self.assertRaises(authentication.LoginRequired):
                    accounts.authenticate(token)

    def test_login_attempts_are_throttled(self):
        for _ in range(authentication.MAX_ATTEMPTS):
            self.assertEqual(self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":"wrong"})[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":self.password})[0], 429)
        with patch.object(authentication.time, "time", return_value=time.time() + authentication.ATTEMPT_WINDOW + 1):
            self.assertEqual(self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":self.password})[0], 200)

    def test_saved_database_can_be_reopened_after_end_and_login(self):
        self.request("POST", "/api/ask", {"question":"count notes"}, self.session_id)
        self.request("POST", "/api/sessions/end", {}, self.session_id)
        self.request("POST", "/api/auth/logout", {})
        self.request("POST", "/api/auth/login", {"email":"ada@example.com", "password":self.password})
        status, reopened = self.request("POST", "/api/sessions/resume", {"session_id":self.session_id})
        self.assertEqual(status, 200)
        self.assertNotEqual(reopened["session_id"], self.session_id)
        _, history = self.request("GET", "/api/history?history_session_id=" + self.session_id, session_id=reopened["session_id"])
        self.assertEqual(history["requests"][0]["text"], "count notes")

    def test_sample_databases_are_separate_and_preserve_owner_when_switching(self):
        _, first = self.request("POST", "/api/sessions", {"database_mode":"sample"})
        self.request("POST", "/api/auth/register", {"first_name":"Other", "last_name":"Reader", "email":"other@example.com", "password":self.password}, extra_headers={"Cookie":""})
        _, second = self.request("POST", "/api/sessions", {"database_mode":"sample"})
        self.assertNotEqual(first["path"], second["path"])
        _, changed = self.request("POST", "/api/databases", {"name":"next"}, second["session_id"])
        self.assertEqual(changed["account_id"], second["account_id"])

    def test_legacy_repository_migration_preserves_data_without_claiming_history(self):
        path = self.root / "legacy.sqlite3"
        with sqlite3.connect(path, factory=workbench.Conn) as connection:
            connection.executescript("""CREATE TABLE users(user_id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,email TEXT UNIQUE);
                CREATE TABLE databases(database_id INTEGER PRIMARY KEY,database_name TEXT,path TEXT UNIQUE);
                CREATE TABLE sessions(session_id TEXT PRIMARY KEY,user_id INTEGER,database_id INTEGER,started_at TEXT,ended_at TEXT);
                INSERT INTO users VALUES(1,'Legacy','Owner','legacy@example.com');
                INSERT INTO sessions VALUES('old',1,1,'2026-01-01T00:00:00+00:00',NULL);""")
            connection.execute("INSERT INTO databases VALUES(1,'legacy.sqlite3',?)", (str(workbench.DEFAULT_DB_PATH),))
        repository = Repository(path)
        original = repository.get_session("old")
        self.assertEqual(original["email"], "legacy@example.com")
        self.assertIsNone(original["account_id"])
        account = authentication.Accounts(repository).register("Legacy", "Owner", "legacy@example.com", self.password)
        self.assertEqual(repository.list_sessions(account_id=account["account_id"]), [])
        self.assertEqual(repository.get_session("old")["session_id"], "old")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
