"""Cloud boundaries: durable recovery, HTTPS, private-network blocking and packaging."""
from io import BytesIO
from pathlib import Path
import tempfile
import json
import unittest
from unittest.mock import patch
import zipfile

from backend import cloud_state
from backend import settings
from backend import wsgi
from backend.connections.network import public_address
from scripts.package_cloud import package
from scripts.configure_cloud_firewall import configured_sql_server, main as configure_firewall


class FakeStore:
    revision = 0
    payload = None
    pending = None
    fail_commit = False

    def cursor(self): return self
    def execute(self, sql, params=()):
        if sql.startswith("UPDATE"):
            self.pending = params[0]
    def fetchone(self): return self.revision, self.payload
    def commit(self):
        if self.fail_commit:
            raise OSError("private connection detail must not be exposed")
        if self.pending is not None:
            self.payload = self.pending
            self.pending = None
            self.revision += 1
    def rollback(self): self.pending = None
    def close(self): pass


class CloudStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="genie-cloud-test-")
        self.root = Path(self.temp.name) / "data-genie"
        self.environment = patch.dict("os.environ", {
            "GENIE_DATA_DIR": str(self.root), "GENIE_PUBLIC_URL": "https://genie.example.test",
            "GENIE_CONNECTION_KEY": "fixture-key-not-used-to-encrypt",
        })
        self.environment.start()
        self.store = FakeStore()
        cloud_state._version = None
        self.connection = patch.object(cloud_state, "connect", return_value=self.store)
        self.connection.start()
        # Keep storage/rollback tests runnable without optional Azure packages.
        self.binary = patch.object(cloud_state, "binary_payload", side_effect=lambda payload: payload)
        self.binary.start()

    def tearDown(self):
        self.binary.stop()
        self.connection.stop()
        self.environment.stop()
        cloud_state._version = None
        self.temp.cleanup()

    def test_committed_data_recovers_after_scratch_disk_is_lost(self):
        with cloud_state.transaction():
            (self.root / "account.sqlite3").write_bytes(b"saved account and history")
        (self.root / "account.sqlite3").unlink()
        cloud_state._version = None  # A replacement worker has no local cache.
        with cloud_state.transaction():
            self.assertEqual((self.root / "account.sqlite3").read_bytes(), b"saved account and history")

    def test_unacknowledged_write_is_rolled_back_and_error_is_sanitized(self):
        with cloud_state.transaction():
            (self.root / "account.sqlite3").write_bytes(b"before")
        self.store.fail_commit = True
        with self.assertLogs("backend.cloud_state", level="ERROR") as logged, \
                self.assertRaises(cloud_state.StateUnavailable) as failure:
            with cloud_state.transaction():
                (self.root / "account.sqlite3").write_bytes(b"after")
        self.assertNotIn("private connection", str(failure.exception))
        self.assertFalse(failure.exception.retry_safe)
        self.assertIn("Check History", str(failure.exception))
        self.assertIn("stage=commit", logged.output[0])
        self.assertNotIn("private connection", logged.output[0])
        self.assertEqual((self.root / "account.sqlite3").read_bytes(), b"before")

    def test_connection_failure_does_not_run_user_work_and_can_be_retried(self):
        with patch.object(cloud_state, "connect", side_effect=OSError("private password detail")), \
                self.assertLogs("backend.cloud_state", level="ERROR") as logged, \
                self.assertRaises(cloud_state.StateUnavailable) as failure:
            with cloud_state.transaction():
                self.fail("A failed connection must not run user work.")
        self.assertTrue(failure.exception.retry_safe)
        self.assertIn("No request was run", str(failure.exception))
        self.assertNotIn("paused", str(failure.exception))
        self.assertIn("stage=connect", logged.output[0])
        self.assertIn("error_types=OSError", logged.output[0])
        self.assertNotIn("private password", logged.output[0])

    def test_load_failure_logs_numeric_sql_code_without_erasing_cached_state(self):
        class FixtureSqlError(Exception):
            msg_no = 40613
            number = "private non-numeric value"
        cloud_state.scratch_root(self.root)
        cached = self.root / "account.sqlite3"
        cached.write_bytes(b"previous cached workspace")
        with patch.object(self.store, "fetchone", side_effect=FixtureSqlError("private SQL text")), \
                self.assertLogs("backend.cloud_state", level="ERROR") as logged, \
                self.assertRaises(cloud_state.StateUnavailable) as failure:
            with cloud_state.transaction():
                self.fail("An unavailable saved workspace must not run user work.")
        self.assertTrue(failure.exception.retry_safe)
        self.assertEqual(cached.read_bytes(), b"previous cached workspace")
        self.assertIn("stage=load", logged.output[0])
        self.assertIn("sql_codes=40613", logged.output[0])
        self.assertNotIn("private", logged.output[0])

    def test_request_failure_is_not_replayed_and_remains_uncertain(self):
        attempts = []
        with self.assertLogs("backend.cloud_state", level="ERROR") as logged, \
                self.assertRaises(cloud_state.StateUnavailable) as failure:
            with cloud_state.transaction():
                attempts.append("external database edit")
                raise OSError("private remote database details")
        self.assertEqual(attempts, ["external database edit"])
        self.assertFalse(failure.exception.retry_safe)
        self.assertIn("could not confirm", str(failure.exception))
        self.assertIn("Check History", str(failure.exception))
        self.assertIn("stage=request", logged.output[0])
        self.assertNotIn("private", logged.output[0])

    def test_quota_failure_preserves_committed_data(self):
        with cloud_state.transaction():
            (self.root / "account.sqlite3").write_bytes(b"before")
        with patch.object(cloud_state, "MAX_STATE_BYTES", 1024), self.assertRaises(cloud_state.StateLimit):
            with cloud_state.transaction():
                (self.root / "large.sqlite3").write_bytes(b"x" * 2048)
        self.assertFalse((self.root / "large.sqlite3").exists())
        self.assertEqual((self.root / "account.sqlite3").read_bytes(), b"before")

    def test_read_without_changes_does_not_rewrite_cloud_snapshot(self):
        with cloud_state.transaction():
            (self.root / "account.sqlite3").write_bytes(b"before")
        revision = self.store.revision
        with cloud_state.transaction():
            self.assertEqual((self.root / "account.sqlite3").read_bytes(), b"before")
        self.assertEqual(self.store.revision, revision)

    def test_invalid_archive_cannot_escape_or_remove_existing_state(self):
        cloud_state.scratch_root(self.root)
        (self.root / "keep").write_bytes(b"safe")
        malicious = BytesIO()
        with zipfile.ZipFile(malicious, "w") as archive:
            archive.writestr("../escape", "bad")
        with self.assertRaises(cloud_state.StateUnavailable):
            cloud_state.restore(self.root, malicious.getvalue())
        self.assertEqual((self.root / "keep").read_bytes(), b"safe")
        self.assertFalse((self.root.parent / "escape").exists())

    def test_unmarked_directory_is_never_overwritten(self):
        self.root.mkdir()
        (self.root / "private.txt").write_text("user data")
        with self.assertRaises(cloud_state.StateUnavailable):
            cloud_state.restore(self.root, None)
        self.assertEqual((self.root / "private.txt").read_text(), "user data")

    def test_rejects_symlink_in_snapshot(self):
        cloud_state.scratch_root(self.root)
        (self.root / "escape").symlink_to(self.root.parent)
        with self.assertRaises(cloud_state.StateLimit):
            cloud_state.snapshot(self.root)

    def test_hosted_account_and_confirmed_table_survive_a_worker_restart(self):
        from backend import workbench
        with patch.multiple(workbench, REPOSITORY_PATH=self.root/"repository.sqlite3",
                            DEFAULT_DB_PATH=self.root/"demo.sqlite3", SHOP_DB_PATH=self.root/"shop.sqlite3",
                            DATABASE_DIRECTORY=self.root/"databases", UPLOAD_DIRECTORY=self.root/"uploads"):
            cookie = csrf = ""
            def request(method, path, payload=None, session=None):
                nonlocal cookie, csrf
                body = json.dumps(payload).encode() if payload is not None else b""
                environ = {"REQUEST_METHOD":method,"PATH_INFO":path,"HTTP_HOST":"genie.example.test",
                           "HTTP_ORIGIN":"https://genie.example.test","CONTENT_TYPE":"application/json",
                           "CONTENT_LENGTH":str(len(body)),"wsgi.input":BytesIO(body),"HTTP_COOKIE":cookie,
                           "HTTP_X_CSRF_TOKEN":csrf,"REMOTE_ADDR":"192.0.2.1"}
                if session: environ["HTTP_X_SESSION_ID"] = session
                response = {}
                def start(status, headers): response.update(status=status,headers=dict(headers))
                result = json.loads(b"".join(wsgi.application(environ,start)))
                self.assertTrue(response["status"].startswith(("200","201")),(response["status"],result))
                if "Set-Cookie" in response["headers"]:
                    self.assertIn("Secure",response["headers"]["Set-Cookie"])
                    cookie = response["headers"]["Set-Cookie"].split(";",1)[0]
                csrf = result.get("csrf_token",csrf)
                return result
            request("POST","/api/auth/register",{"first_name":"Cloud","last_name":"Fixture","email":"cloud@example.test","password":"a long cloud fixture password"})
            session = request("POST","/api/sessions",{"database_mode":"create","database_name":"cloud","starter":False})["session_id"]
            pending = request("POST","/api/query",{"sql":"CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT)"},session)
            request("POST","/api/commands/confirm",{"command_id":pending["command_id"],"confirmation_token":pending["confirmation_token"]},session)
            cloud_state.restore(self.root,None)
            cloud_state._version = None
            restored = request("GET","/api/schema",session=session)
            self.assertEqual([table["name"] for table in restored["tables"]],["tasks"])


class HostingTests(unittest.TestCase):
    def request(self, path="/healthz", host="genie.example.test", method="GET", origin=None):
        environ = {"REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": "",
                   "HTTP_HOST": host, "REMOTE_ADDR": "192.0.2.1", "wsgi.input": BytesIO()}
        if origin: environ["HTTP_ORIGIN"] = origin
        response = {}
        def start(status, headers): response.update(status=status, headers=dict(headers))
        response["body"] = b"".join(wsgi.application(environ, start))
        return response

    def test_https_liveness_does_not_wake_or_require_sql(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL": "https://genie.example.test"}), \
                patch.object(cloud_state, "connect", side_effect=AssertionError("warm-up probes must not connect")), \
                patch.object(wsgi.Request, "accounts", side_effect=AssertionError("warm-up probes must not access accounts")), \
                patch.object(Path, "read_bytes", return_value=b"<!doctype html><html>Data Genie</html>"):
            for path in ("/healthz", "/"):
                with self.subTest(path=path):
                    response = self.request(path)
                    self.assertEqual(response["status"], "200 OK")
                    self.assertIn("max-age", response["headers"]["Strict-Transport-Security"])

    def test_unknown_non_api_paths_are_not_found_without_account_or_sql_access(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL": "https://genie.example.test"}), \
                patch.object(wsgi.Request, "accounts", side_effect=AssertionError("unknown routes must not access accounts")), \
                patch.object(cloud_state, "connect", side_effect=AssertionError("unknown routes must not connect")):
            for path in ("/does-not-exist", "/.env", "/.git/config", "/backend/settings.py"):
                with self.subTest(path=path):
                    response = self.request(path)
                    self.assertEqual(response["status"], "404 Not Found")
                    self.assertEqual(json.loads(response["body"]), {"error": "Not found."})

    def test_foreign_host_and_cross_origin_requests_do_not_touch_cloud_sql(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL": "https://genie.example.test"}), patch.object(cloud_state, "connect", side_effect=AssertionError("rejected requests must not connect")):
            self.assertEqual(self.request("/api/status", host="evil.example.test")["status"], "403 Forbidden")
            self.assertEqual(self.request("/api/auth/login", method="POST", origin="http://genie.example.test")["status"], "403 Forbidden")

    def test_cloud_cookies_are_secure_and_default_host_is_discovered(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL":"", "GENIE_CLOUD_STATE":"azure_sql", "WEBSITE_HOSTNAME":"genie.azurewebsites.net"}):
            self.assertEqual(settings.public_url(), "https://genie.azurewebsites.net")
            request = wsgi.Request({"wsgi.input": BytesIO()})
            request.set_login_cookie("fixture-token")
            self.assertIn("; Secure", request.response_cookie)
            self.assertIn("HttpOnly", request.response_cookie)

    def test_old_azure_hostname_redirects_gets_but_never_accepts_writes(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL": "https://genie.example.test",
                                       "WEBSITE_HOSTNAME": "genie.azurewebsites.net"}), \
                patch.object(cloud_state, "connect", side_effect=AssertionError("aliases must not connect")):
            response = self.request("/app", host="genie.azurewebsites.net")
            self.assertEqual(response["status"], "308 Permanent Redirect")
            self.assertEqual(response["headers"]["Location"], "https://genie.example.test/app")
            self.assertEqual(self.request("/api/auth/login", host="genie.azurewebsites.net",
                                          method="POST")["status"], "403 Forbidden")
            self.assertEqual(self.request("/app", host="other.azurewebsites.net")["status"], "403 Forbidden")
            response = self.request("//evil.example/path", host="genie.azurewebsites.net")
            self.assertEqual(response["headers"]["Location"], "https://genie.example.test/evil.example/path")

    def test_invalid_cloud_origin_fails_closed(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL":"http://genie.example.test"}):
            self.assertEqual(self.request()["status"], "500 Internal Server Error")

    def test_cloud_runtime_never_falls_back_to_local_data(self):
        with patch.dict("os.environ", {"GENIE_PUBLIC_URL":"", "GENIE_CLOUD_STATE":"azure_sql", "WEBSITE_HOSTNAME":""}):
            self.assertEqual(self.request("/api/auth/session")["status"], "503 Service Unavailable")

    def test_unavailable_cloud_storage_returns_retry_safe_error(self):
        for retry_safe in (True, False):
            with self.subTest(retry_safe=retry_safe), \
                    patch.dict("os.environ", {"GENIE_PUBLIC_URL":"https://genie.example.test"}), \
                    patch.object(cloud_state, "transaction", side_effect=cloud_state.StateUnavailable("Storage unavailable.", retry_safe=retry_safe)):
                response = self.request("/api/auth/session")
            self.assertEqual(response["status"], "503 Service Unavailable")
            payload = json.loads(response["body"])
            self.assertEqual(payload["code"], "cloud_storage_unavailable")
            self.assertEqual(payload["retry_safe"], retry_safe)
            self.assertEqual(payload["recovery"], "retry" if retry_safe else "check_history")

    def test_public_connector_blocks_metadata_and_dns_rebinding(self):
        for address in ("localhost", "127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "fd00::1"):
            with self.subTest(address=address), self.assertRaises(ValueError):
                public_address(address, 5432)
        with patch("socket.getaddrinfo", return_value=[(2,1,6,"",("8.8.8.8",5432)),(2,1,6,"",("10.0.0.1",5432))]), self.assertRaises(ValueError):
            public_address("mixed.example.test",5432)

    def test_public_connector_pins_the_checked_address(self):
        with patch("socket.getaddrinfo", return_value=[(2,1,6,"",("8.8.8.8",5432))]):
            self.assertEqual(public_address("public.example.test",5432), "8.8.8.8")

    def test_deployment_bundle_excludes_local_credentials_and_databases(self):
        with tempfile.TemporaryDirectory(prefix="genie-package-test-") as temporary:
            archive = package(Path(temporary)/"app.zip")
            with zipfile.ZipFile(archive) as bundle:
                names = bundle.namelist()
                self.assertIn("backend/wsgi.py", names)
                self.assertTrue(any(name.startswith("frontend/dist/assets/") for name in names))
                self.assertFalse(any(name.startswith(("db/", ".git/", ".env")) or name.endswith((".sqlite3", ".key")) for name in names))
                self.assertEqual(bundle.read("requirements.txt"), b"-r azure/requirements.txt\n-r backend/requirements-postgres.txt\n")


class DeploymentFirewallTests(unittest.TestCase):
    def test_only_the_reviewed_linux_tier_and_instance_count_are_accepted(self):
        for expected, actual, linux, count in (("F1", "B1", True, 1), ("B1", "B1", False, 1),
                                                ("B1", "B1", True, 2), ("B1", "B1", True, True),
                                                ("B1", "B1", True, "1"), ("P1v3", "P1v3", True, 1)):
            replies = [json.dumps({"serverFarmId": "/plans/fixture"}),
                       json.dumps({"sku": {"name": actual, "capacity": count}, "reserved": linux})]
            with self.subTest(expected=expected, actual=actual, linux=linux, count=count), \
                    patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie", "GENIE_APP_SERVICE_SKU": expected}), \
                    patch("scripts.configure_cloud_firewall.azure", side_effect=replies), \
                    self.assertRaises(SystemExit):
                configure_firewall(check_only=True)

    def test_raw_arm_linux_f1_and_b1_plans_accept_existing_network_rules(self):
        for tier, flattened in (("F1", {}), ("B1", {}), ("B1", {"reserved": None})):
            replies = [
                json.dumps({"serverFarmId": "/plans/fixture", "outboundIpAddresses": "192.0.2.5"}),
                json.dumps({"id": "/plans/fixture", "kind": "linux", "properties": {"reserved": True}, **flattened,
                            "sku": {"name": tier, "capacity": 1}}),
                json.dumps("genie-custom-sql.database.windows.net"),
                json.dumps({"useFreeLimit": True, "freeLimitExhaustionBehavior": "AutoPause"}),
                json.dumps([{"startIpAddress": "192.0.2.5", "endIpAddress": "192.0.2.5"}]),
            ]
            with self.subTest(tier=tier, flattened=flattened), \
                    patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie", "GENIE_APP_SERVICE_SKU": tier}), \
                    patch("scripts.configure_cloud_firewall.azure", side_effect=replies) as command:
                configure_firewall(check_only=True)
            self.assertFalse(any("create" in call.args or "delete" in call.args for call in command.call_args_list))

    def test_missing_malformed_and_windows_os_flags_fail_before_sql_access(self):
        invalid_plans = [
            {"properties": {}},
            {"kind": "windows", "properties": {"reserved": False}},
            {"properties": {"reserved": None}},
            {"properties": {"reserved": "true"}},
            {"properties": {"reserved": 1}},
            {"properties": {"reserved": True}, "reserved": False},
            {"properties": {"reserved": False}, "reserved": True},
            {"properties": None, "reserved": True},
            {"properties": [], "reserved": True},
            {"reserved": "true"},
            {"properties": {"reserved": True}, "sku": None},
            [],
        ]
        for invalid in invalid_plans:
            plan = {"sku": {"name": "B1", "capacity": 1}, **invalid} if isinstance(invalid, dict) else invalid
            replies = [json.dumps({"serverFarmId": "/plans/fixture"}), json.dumps(plan)]
            with self.subTest(plan=plan), \
                    patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie", "GENIE_APP_SERVICE_SKU": "B1"}), \
                    patch("scripts.configure_cloud_firewall.azure", side_effect=replies) as command, \
                    self.assertRaises(SystemExit):
                configure_firewall(check_only=True)
            self.assertEqual(command.call_count, 2)

    def test_budgeted_b1_accepts_free_sql_and_existing_network_rules(self):
        replies = [
            json.dumps({"serverFarmId": "/plans/fixture", "outboundIpAddresses": "192.0.2.5"}),
            json.dumps({"sku": {"name": "B1", "capacity": 1}, "reserved": True}),
            json.dumps("genie-custom-sql.database.windows.net"),
            json.dumps({"useFreeLimit": True, "freeLimitExhaustionBehavior": "AutoPause"}),
            json.dumps([{"startIpAddress": "192.0.2.5", "endIpAddress": "192.0.2.5"}]),
        ]
        with patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie", "GENIE_APP_SERVICE_SKU": "B1"}), \
                patch("scripts.configure_cloud_firewall.azure", side_effect=replies):
            configure_firewall(check_only=True)

    def test_custom_sql_server_is_used_for_validation_and_firewall_rules(self):
        replies = [
            json.dumps({"serverFarmId": "/plans/fixture", "outboundIpAddresses": "192.0.2.5",
                        "possibleOutboundIpAddresses": "192.0.2.5,192.0.2.99"}),
            json.dumps({"sku": {"name": "F1", "capacity": 1}, "reserved": True}),
            json.dumps("genie-custom-sql.database.windows.net"),
            json.dumps({"useFreeLimit": True, "freeLimitExhaustionBehavior": "AutoPause"}),
            "{}",
        ]
        with patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie"}), \
                patch("scripts.configure_cloud_firewall.azure", side_effect=replies) as command:
            configure_firewall()
        sql_calls = [call.args for call in command.call_args_list if call.args[0] == "sql"]
        self.assertEqual(len(sql_calls), 2)
        for arguments in sql_calls:
            self.assertEqual(arguments[arguments.index("--server") + 1], "genie-custom-sql")
        self.assertNotIn("192.0.2.99", str(command.call_args_list))
        settings_arguments = command.call_args_list[2].args
        self.assertEqual(settings_arguments[settings_arguments.index("--query") + 1],
                         "[?name=='GENIE_SQL_HOST'].value | [0]")

    def test_missing_or_invalid_configured_host_fails_without_guessing_a_server(self):
        for host in (None, "", "not-azure.example.test", "bad/name.database.windows.net"):
            with self.subTest(host=host), \
                    patch("scripts.configure_cloud_firewall.azure", return_value=json.dumps(host)), \
                    self.assertRaises(SystemExit):
                configured_sql_server("fixture", "genie")

    def test_ci_checks_rules_without_permission_to_modify_them(self):
        replies = [
            json.dumps({"serverFarmId": "/plans/fixture", "outboundIpAddresses": "192.0.2.5"}),
            json.dumps({"sku": {"name": "F1", "capacity": 1}, "reserved": True}),
            json.dumps("genie-custom-sql.database.windows.net"),
            json.dumps({"useFreeLimit": True, "freeLimitExhaustionBehavior": "AutoPause"}),
            json.dumps([{"startIpAddress": "192.0.2.5", "endIpAddress": "192.0.2.5"}]),
        ]
        with patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie"}), \
                patch("scripts.configure_cloud_firewall.azure", side_effect=replies) as command:
            configure_firewall(check_only=True)
        self.assertFalse(any("create" in call.args or "delete" in call.args for call in command.call_args_list))

    def test_ci_refuses_missing_rules_and_broad_azure_service_access(self):
        for rules in ([], [{"startIpAddress": "0.0.0.0", "endIpAddress": "0.0.0.0"}],
                      [{"startIpAddress": "192.0.2.1", "endIpAddress": "192.0.2.255"}]):
            replies = [
                json.dumps({"serverFarmId": "/plans/fixture", "outboundIpAddresses": "192.0.2.5"}),
                json.dumps({"sku": {"name": "F1", "capacity": 1}, "reserved": True}),
                json.dumps("genie-custom-sql.database.windows.net"),
                json.dumps({"useFreeLimit": True, "freeLimitExhaustionBehavior": "AutoPause"}),
                json.dumps(rules),
            ]
            with self.subTest(rules=rules), \
                    patch.dict("os.environ", {"GENIE_RESOURCE_GROUP": "fixture", "GENIE_APP_NAME": "genie"}), \
                    patch("scripts.configure_cloud_firewall.azure", side_effect=replies), \
                    self.assertRaises(SystemExit):
                configure_firewall(check_only=True)
