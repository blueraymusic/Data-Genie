"""Durable admission limits across auth identities, windows and concurrent callers."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend import authentication, workbench
from backend.repository import Repository
from tests.test_http import HttpHarness


class AuthAdmissionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="genie-auth-limits-")
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "repository.sqlite3"
        self.repository = Repository(self.path)
        self.accounts = authentication.Accounts(self.repository)
        self.now = 2_000_000_000
        clock = patch.object(authentication.time, "time", return_value=self.now)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        hasher = patch.object(authentication, "password_hash", return_value="fixture-password-hash")
        self.hasher = hasher.start()
        self.addCleanup(hasher.stop)

    def register(self, email="ada@example.test", client="192.0.2.10", accounts=None):
        return (accounts or self.accounts).register("Ada", "Reader", email,
                                                   "a long fixture passphrase", client)

    def bucket(self, action, client):
        with self.repository._connection() as connection:
            return dict(connection.execute("SELECT * FROM auth_rate_limits WHERE bucket_key=?",
                                           (authentication.token_hash(action + ":ip:" + client),)).fetchone())

    def test_five_registrations_per_ip_are_reserved_before_hashing(self):
        self.assertEqual(authentication.MAX_REGISTER_IP_ATTEMPTS, 5)
        for index in range(5):
            self.register(f"reader-{index}@example.test")
        self.assertEqual(self.hasher.call_count, 5)
        with self.assertRaises(authentication.TooManyAttempts):
            self.register("another@example.test")
        self.assertEqual(self.hasher.call_count, 5)
        self.assertEqual(self.bucket("register", "192.0.2.10")["attempts"], 5)
        self.register("another@example.test", client="192.0.2.11")

    def test_invalid_and_duplicate_registrations_still_consume_capacity(self):
        for names, email in (("", "bad"), ("Ada", "bad")):
            with self.assertRaises(ValueError):
                self.accounts.register(names, "Reader", email, "unused", "192.0.2.10")
        self.hasher.assert_not_called()
        self.register()
        with self.assertRaises(ValueError) as duplicate:
            self.register("ADA@example.test")
        self.assertNotIn("already", str(duplicate.exception).lower())
        with self.assertRaises(ValueError):
            self.accounts.register("", "Reader", "unused@example.test", "unused", "192.0.2.10")
        self.assertEqual(self.hasher.call_count, 2)
        with self.assertRaises(authentication.TooManyAttempts):
            self.register("another@example.test")
        self.assertEqual(self.hasher.call_count, 2)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 1)

    def test_thirty_rotated_login_emails_exhaust_one_ip_before_password_work(self):
        self.assertEqual(authentication.MAX_LOGIN_IP_ATTEMPTS, 30)
        with patch.object(authentication, "password_matches", return_value=False) as verify:
            for index in range(30):
                with self.assertRaises(authentication.LoginRequired):
                    self.accounts.login(f"guess-{index}@example.test", "wrong", "192.0.2.10")
            with self.assertRaises(authentication.TooManyAttempts):
                self.accounts.login("another@example.test", "wrong", "192.0.2.10")
            self.assertEqual(verify.call_count, 30)
            with self.assertRaises(authentication.LoginRequired):
                self.accounts.login("another@example.test", "wrong", "192.0.2.11")
            self.assertEqual(verify.call_count, 31)

    def test_existing_five_attempt_pair_limit_is_preserved(self):
        self.assertEqual(authentication.MAX_ATTEMPTS, 5)
        user = self.register(client="seed")
        with patch.object(authentication, "password_matches", return_value=False) as verify:
            for _ in range(5):
                with self.assertRaises(authentication.LoginRequired):
                    self.accounts.login(" ADA@example.test ", "wrong", "192.0.2.10")
            verify.reset_mock()
            verify.return_value = True
            with self.assertRaises(authentication.TooManyAttempts):
                self.accounts.login("ada@example.test", "correct", "192.0.2.10")
            verify.assert_not_called()
            self.assertEqual(self.accounts.login("ada@example.test", "correct", "192.0.2.11"), user)
        # A pair-denied request still spends the shared budget for its source IP.
        self.assertEqual(self.bucket("login", "192.0.2.10")["attempts"], 6)

    def test_successful_logins_do_not_reset_the_shared_ip_budget(self):
        user = self.register(client="seed")
        with patch.object(authentication, "password_matches", return_value=True) as verify:
            for _ in range(30):
                self.assertEqual(self.accounts.login(user["email"], "correct", "192.0.2.10"), user)
            with self.assertRaises(authentication.TooManyAttempts):
                self.accounts.login(user["email"], "correct", "192.0.2.10")
            self.assertEqual(verify.call_count, 30)
            self.assertEqual(self.accounts.login(user["email"], "correct", "192.0.2.11"), user)

    def test_registration_exhaustion_does_not_block_login_budget(self):
        for _ in range(5):
            with self.assertRaises(ValueError):
                self.accounts.register("", "Reader", "bad", "unused", "192.0.2.10")
        with patch.object(authentication, "password_matches", return_value=False) as verify:
            with self.assertRaises(authentication.LoginRequired):
                self.accounts.login("missing@example.test", "wrong", "192.0.2.10")
        verify.assert_called_once()

    def test_retry_after_counts_down_without_extending_and_expires_at_exact_boundary(self):
        self.assertEqual(authentication.ATTEMPT_WINDOW, 900)
        for index in range(5):
            self.register(f"reader-{index}@example.test")
        for elapsed, remaining in ((37, 863), (899, 1)):
            self.clock.return_value = self.now + elapsed
            with self.assertRaises(authentication.TooManyAttempts) as denied:
                self.register("after-window@example.test")
            self.assertEqual(denied.exception.retry_after, remaining)
        self.clock.return_value = self.now + 900
        self.register("after-window@example.test")
        row = self.bucket("register", "192.0.2.10")
        self.assertEqual((row["started_at"], row["attempts"]), (self.now + 900, 1))

    def test_repository_recreation_preserves_registration_and_login_lockouts(self):
        for index in range(5):
            self.register(f"reader-{index}@example.test")
        with patch.object(authentication, "password_matches", return_value=False):
            for _ in range(5):
                with self.assertRaises(authentication.LoginRequired):
                    self.accounts.login("missing@example.test", "wrong", "192.0.2.10")
        reopened = authentication.Accounts(Repository(self.path))
        with self.assertRaises(authentication.TooManyAttempts):
            self.register("new@example.test", accounts=reopened)
        with patch.object(authentication, "password_matches") as verify:
            with self.assertRaises(authentication.TooManyAttempts):
                reopened.login("missing@example.test", "wrong", "192.0.2.10")
            verify.assert_not_called()

    def test_persisted_legacy_pair_lockout_remains_effective(self):
        key = authentication.token_hash("192.0.2.10:ada@example.test")
        with self.repository._connection(write=True) as connection:
            connection.execute("INSERT INTO login_attempts VALUES(?,?,?)", (key, self.now - 123, 5))
        with patch.object(authentication, "password_matches") as verify:
            with self.assertRaises(authentication.TooManyAttempts) as denied:
                self.accounts.login(" ADA@example.test ", "unused", "192.0.2.10")
            self.assertEqual(denied.exception.retry_after, 777)
            verify.assert_not_called()
        self.assertEqual(self.bucket("login", "192.0.2.10")["attempts"], 1)

    def test_concurrent_registrations_cannot_over_admit_before_password_hashing(self):
        # Only the five admitted calls may reach this barrier. A limit checked
        # after hashing, or under a lock held during hashing, fails this test.
        self.repository._initialize()
        start = threading.Barrier(12)
        hashing = threading.Barrier(5)

        def hash_after_admission(password):
            hashing.wait(timeout=5)
            return "fixture-password-hash"

        def attempt(index):
            start.wait(timeout=5)
            try:
                self.register(f"concurrent-{index}@example.test")
                return "created"
            except authentication.TooManyAttempts:
                return "limited"

        with patch.object(authentication, "password_hash", side_effect=hash_after_admission) as hash_password:
            with ThreadPoolExecutor(max_workers=12) as executor:
                outcomes = list(executor.map(attempt, range(12)))
        self.assertEqual(outcomes.count("created"), 5)
        self.assertEqual(outcomes.count("limited"), 7)
        self.assertEqual(hash_password.call_count, 5)

    def test_concurrent_login_pair_cannot_over_admit_before_password_verification(self):
        self.register(client="seed")
        start = threading.Barrier(12)
        verifying = threading.Barrier(5)

        def wrong_password(password, encoded):
            verifying.wait(timeout=5)
            return False

        def attempt(index):
            start.wait(timeout=5)
            try:
                self.accounts.login("ada@example.test", "wrong", "192.0.2.10")
            except authentication.TooManyAttempts:
                return "limited"
            except authentication.LoginRequired:
                return "wrong"
            return "unexpected success"

        with patch.object(authentication, "password_matches", side_effect=wrong_password) as verify:
            with ThreadPoolExecutor(max_workers=12) as executor:
                outcomes = list(executor.map(attempt, range(12)))
        self.assertEqual(outcomes.count("wrong"), 5)
        self.assertEqual(outcomes.count("limited"), 7)
        self.assertEqual(verify.call_count, 5)


class AuthLimitHttpTests(HttpHarness, unittest.TestCase):
    def test_malformed_auth_bodies_and_content_types_cannot_bypass_ip_limits(self):
        for route, action, limit_name in (("/api/auth/register", "register", "MAX_REGISTER_IP_ATTEMPTS"),
                                           ("/api/auth/login", "login", "MAX_LOGIN_IP_ATTEMPTS")):
            with self.subTest(route=route), patch.object(authentication, limit_name, 2), \
                    patch.object(authentication, "password_hash") as hash_password, \
                    patch.object(authentication, "password_matches") as verify:
                # The harness has already spent one registration slot creating its fixture.
                with workbench.get_repository()._connection(write=True) as connection:
                    connection.execute("DELETE FROM auth_rate_limits")
                self.assertEqual(self.request("POST", route, b"{")[0], 400)
                self.assertEqual(self.request("POST", route, {}, extra_headers={"Content-Type": "text/plain"})[0], 400)
                self.assertEqual(self.request("POST", route, b"{")[0], 429)
                hash_password.assert_not_called()
                verify.assert_not_called()

    def test_registration_429_has_valid_status_line_retry_after_and_no_login_cookie(self):
        with workbench.get_repository()._connection() as connection:
            started = connection.execute("SELECT started_at FROM auth_rate_limits WHERE bucket_key=?",
                                         (authentication.token_hash("register:ip:127.0.0.1"),)).fetchone()[0]
        with patch.object(authentication, "MAX_REGISTER_IP_ATTEMPTS", 1), \
                patch.object(authentication.time, "time", return_value=started + 60), \
                patch.object(authentication, "password_hash") as hash_password:
            status, body = self.request("POST", "/api/auth/register", {
                "first_name": "Another", "last_name": "Reader", "email": "another@example.test",
                "password": self.password,
            })
        self.assertEqual(status, 429)
        self.assertTrue(self.last_headers.startswith("HTTP/1.0 429 "))
        self.assertIn("\r\nRetry-After: 840\r\n", self.last_headers)
        self.assertIn("\r\nContent-Type: application/json; charset=utf-8", self.last_headers)
        self.assertNotIn("Set-Cookie:", self.last_headers)
        self.assertEqual(body["retry_after"], 840)
        hash_password.assert_not_called()

    def test_login_shared_ip_429_has_retry_after_across_rotated_emails(self):
        with patch.object(authentication, "MAX_LOGIN_IP_ATTEMPTS", 2), \
                patch.object(authentication.time, "time", return_value=2_000_000_000), \
                patch.object(authentication, "password_matches", return_value=False) as verify:
            for email in ("guess-one@example.test", "guess-two@example.test"):
                self.assertEqual(self.request("POST", "/api/auth/login", {"email": email, "password": "wrong"})[0], 401)
            status, body = self.request("POST", "/api/auth/login", {"email": "guess-three@example.test", "password": "wrong"})
        self.assertEqual(status, 429)
        self.assertTrue(self.last_headers.startswith("HTTP/1.0 429 "))
        self.assertIn("\r\nRetry-After: 900\r\n", self.last_headers)
        self.assertEqual(body["retry_after"], 900)
        self.assertEqual(verify.call_count, 2)
