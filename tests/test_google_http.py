"""OAuth browser boundaries using real route parsing and isolated accounts."""
from contextlib import contextmanager
from http.cookies import SimpleCookie
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode, urlsplit

from backend import authentication, cloud_state, google_auth, server, workbench, wsgi
from tests.test_http import HttpHarness, QuietHandler, Socket


CONFIG = {
    "client_id": "123-fixture.apps.googleusercontent.com", "secret": "fixture-only",
    "redirect_uri": "http://127.0.0.1:8000/api/auth/google/callback",
}
IDENTITY = {"issuer": "https://accounts.google.com",
            "subject": "google-subject", "email": "google@example.com",
            "first_name": "Google", "last_name": "Reader", "email_verified": True, "email_authoritative": True}


class GoogleHttpTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.jar = SimpleCookie()
        self.jar.load(self.cookie)
        self.config_patch = patch.object(google_auth, "configuration", return_value=CONFIG)
        self.config_patch.start()
        self.flow = {"state": "a-valid-state", "nonce": "a-valid-nonce", "code_verifier": "pkce-secret",
                     "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth?state=a-valid-state",
                     "genie_config": [CONFIG["client_id"], CONFIG["redirect_uri"]]}
        self.begin = patch.object(google_auth, "begin", return_value=self.flow).start()
        self.finish = patch.object(google_auth, "finish", return_value=IDENTITY).start()
        self.addCleanup(patch.stopall)

    def oauth(self, method, path, payload=None, *, cookie=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else b""
        combined = {"Host": "127.0.0.1:8000", "Content-Type": "application/json",
                    "Content-Length": str(len(data)), "X-CSRF-Token": self.csrf,
                    "Cookie": cookie if cookie is not None else "; ".join(
                        key + "=" + value.value for key, value in self.jar.items())}
        combined.update(headers or {})
        wire = (f"{method} {path} HTTP/1.0\r\n" + "".join(
            f"{key}: {value}\r\n" for key, value in combined.items()) + "\r\n").encode() + data
        sock = Socket(wire)
        QuietHandler(sock, ("127.0.0.1", 9000), None)
        head, body = bytes(sock.outgoing).split(b"\r\n\r\n", 1)
        headers_out = {}
        self.cookies_out = []
        for line in head.decode().split("\r\n")[1:]:
            name, sep, value = line.partition(":")
            if not sep:
                continue
            headers_out[name.lower()] = value.strip()
            if name.lower() == "set-cookie":
                self.jar.load(value.strip())
                self.cookies_out.append(value.strip())
        return int(head.split(b" ")[1]), headers_out, json.loads(body) if body else None

    def start(self):
        status, headers, _ = self.oauth("GET", "/api/auth/google/start")
        self.assertEqual(status, 303)
        self.assertTrue(headers["location"].startswith("https://accounts.google.com/"))
        self.assertIn("SameSite=Lax", self.cookies_out[0])
        self.assertIn("HttpOnly", self.cookies_out[0])
        return google_auth.COOKIE_NAME + "=" + self.jar[google_auth.COOKIE_NAME].value

    def callback(self, cookie, state="a-valid-state", **query):
        return self.oauth("GET", google_auth.CALLBACK_PATH + "?" + urlencode(
            {"code": "authorization-code", "state": state, **query}), cookie=cookie)

    def test_discovery_is_public_disabled_config_preserves_local_login(self):
        self.assertEqual(self.oauth("GET", "/api/auth/providers", cookie="")[2], {"google": {"enabled": True}})
        with patch.object(google_auth, "configuration", return_value=None):
            self.assertEqual(self.oauth("GET", "/api/auth/providers", cookie="")[2], {"google": {"enabled": False}})
            self.assertEqual(self.oauth("GET", "/api/auth/google/start")[1]["location"], "/signin?google_error=unavailable")
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": self.account["email"], "password": self.password})[0], 200)

    def test_start_callback_creates_normal_app_login_and_consumes_flow(self):
        browser = self.start()
        self.assertEqual(self.callback(browser)[1]["location"], "/databases")
        self.assertEqual(len(self.cookies_out), 2)
        self.assertIn("SameSite=Strict", self.cookies_out[0])
        self.assertIn("Max-Age=0", self.cookies_out[1])
        status, _, data = self.oauth("GET", "/api/auth/session")
        self.assertTrue(data["user"]["google_linked"])
        self.assertFalse(data["user"]["password_enabled"])
        self.assertNotEqual(data["user"]["account_id"], self.account["account_id"])
        self.assertEqual(self.oauth("GET", "/api/auth/session", cookie=self.cookie)[2], {"user": None})
        self.assertEqual(self.callback(browser)[1]["location"], "/signin?google_error=invalid")
        self.assertEqual(self.finish.call_count, 1)
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM google_auth_flows").fetchone()[0], 0)

    def test_forged_state_missing_cookie_and_duplicate_query_cannot_log_in(self):
        browser = self.start()
        self.assertIn("invalid", self.callback(browser, state="wrong")[1]["location"])
        self.assertIn("invalid", self.callback("")[1]["location"])
        self.assertIn("invalid", self.oauth("GET", google_auth.CALLBACK_PATH + "?state=a-valid-state&state=duplicate&code=x", cookie=browser)[1]["location"])
        self.finish.assert_not_called()
        # The wrong-state request did not consume the real flow.
        self.assertEqual(self.callback(browser)[1]["location"], "/databases")

    def test_expired_and_cancelled_flows_do_not_create_a_login(self):
        browser = self.start()
        with workbench.get_repository()._connection(write=True) as connection:
            connection.execute("UPDATE google_auth_flows SET expires_at=0")
        self.assertIn("invalid", self.callback(browser)[1]["location"])
        browser = self.start()
        self.finish.side_effect = google_auth.GoogleError("cancelled")
        self.assertEqual(self.callback(browser, error="access_denied")[1]["location"], "/signin?google_error=cancelled")
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 1)

    def test_existing_email_cannot_claim_local_account(self):
        self.finish.return_value = {**IDENTITY, "email": self.account["email"]}
        browser = self.start()
        self.assertEqual(self.callback(browser)[1]["location"], "/signin?google_error=account_exists")
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM google_identities").fetchone()[0], 0)

    def test_explicit_link_requires_csrf_password_same_login_then_works_without_strict_callback_cookie(self):
        path = "/api/auth/google/link"
        self.assertEqual(self.oauth("POST", path, {"password": self.password}, headers={"X-CSRF-Token": ""})[0], 403)
        self.assertEqual(self.oauth("POST", path, {"password": "wrong"})[0], 400)
        self.assertEqual(self.oauth("GET", "/api/auth/google/start?intent=link")[1]["location"], "/signin?google_error=link_expired")
        status, _, data = self.oauth("POST", path, {"password": self.password})
        self.assertEqual(data["url"], "/api/auth/google/start?intent=link")
        self.assertEqual(self.oauth("GET", data["url"])[0], 303)
        browser = google_auth.COOKIE_NAME + "=" + self.jar[google_auth.COOKIE_NAME].value
        self.assertEqual(self.callback(browser)[1]["location"], "/account?google=linked")
        user = self.oauth("GET", "/api/auth/session")[2]["user"]
        self.assertEqual(user["account_id"], self.account["account_id"])
        self.assertTrue(user["password_enabled"])
        self.assertTrue(user["google_linked"])
        self.assertEqual(self.oauth("GET", "/api/auth/session", cookie=self.cookie)[2], {"user": None})

    def test_logout_after_grant_revokes_link_without_changing_account(self):
        self.oauth("POST", "/api/auth/google/link", {"password": self.password})
        self.oauth("GET", "/api/auth/google/start?intent=link")
        browser = google_auth.COOKIE_NAME + "=" + self.jar[google_auth.COOKIE_NAME].value
        self.oauth("POST", "/api/auth/logout", {})
        self.assertIn("link_expired", self.callback(browser)[1]["location"])
        with workbench.get_repository()._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM google_identities").fetchone()[0], 0)

    def test_flow_start_is_throttled_and_cross_origin_link_remains_blocked(self):
        with patch.object(authentication.Accounts, "_reserve_attempt", side_effect=authentication.TooManyAttempts(60)):
            self.assertIn("rate_limited", self.oauth("GET", "/api/auth/google/start")[1]["location"])
        self.assertEqual(self.oauth("POST", "/api/auth/google/link", {"password": self.password},
                                    headers={"Origin": "https://other.test"})[0], 403)

    def test_cookie_secure_and_local_request_logging_never_records_codes(self):
        with patch.object(server.settings, "public_url", return_value="https://genie.test"), \
                patch.object(google_auth, "configuration", return_value={**CONFIG, "redirect_uri": "https://genie.test" + google_auth.CALLBACK_PATH}):
            self.oauth("GET", "/api/auth/google/start", headers={"Host": "genie.test"})
            self.assertIn("Secure", self.cookies_out[0])
        handler = server.Handler.__new__(server.Handler)
        handler.path, handler.command, handler.request_version = google_auth.CALLBACK_PATH + "?code=private&state=private", "GET", "HTTP/1.1"
        with patch.object(handler, "log_message") as log:
            handler.log_request(303)
        self.assertNotIn("private", str(log.call_args))


class GoogleCloudBoundaries(unittest.TestCase):
    def test_wsgI_does_not_wrap_google_network_flow_in_global_transaction(self):
        inside = []
        @contextmanager
        def transaction():
            inside.append(True)
            try:
                yield
            finally:
                inside.pop()
        checks = []
        def run(request):
            checks.append(bool(inside))
            request.json({"ok": True})
        from io import BytesIO
        with patch.object(wsgi.settings, "public_url", return_value="https://genie.test"), \
                patch.object(wsgi.cloud_state, "transaction", side_effect=transaction), \
                patch.object(wsgi.Request, "run", run):
            for path in ("/api/auth/google/start", google_auth.CALLBACK_PATH, "/api/auth/session"):
                wsgi.application({"PATH_INFO": path, "HTTP_HOST": "genie.test", "REQUEST_METHOD": "GET", "wsgi.input": BytesIO()}, lambda *args: None)
        self.assertEqual(checks, [False, False, True])

    def test_expected_rejection_is_raised_after_durable_commit(self):
        events = []
        @contextmanager
        def transaction():
            events.append("begin")
            yield
            events.append("commit")
        with patch.object(google_auth.settings, "value", return_value="azure_sql"), \
                patch.object(cloud_state, "transaction", side_effect=transaction):
            with self.assertRaises(google_auth.GoogleError):
                with google_auth.durable():
                    raise google_auth.GoogleError()
        self.assertEqual(events, ["begin", "commit"])
