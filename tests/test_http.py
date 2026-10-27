"""Exercise actual HTTP parsing/routing without opening a network socket."""

from pathlib import Path
import io
import base64
import json
import re
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import server
import workbench
import authentication


class Socket:
    def __init__(self, incoming):
        self.incoming = io.BytesIO(incoming)
        self.outgoing = bytearray()

    def makefile(self, *args, **kwargs):
        return self.incoming

    def sendall(self, body):
        self.outgoing.extend(body)


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


class HttpHarness:
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="genie-http-test-")
        self.root = Path(self.temporary.name)
        self.old_repository = workbench.REPOSITORY_PATH
        self.old_demo = workbench.DEFAULT_DB_PATH
        self.old_uploads = workbench.UPLOAD_DIRECTORY
        self.old_databases = workbench.DATABASE_DIRECTORY
        workbench.REPOSITORY_PATH = self.root / "repository.sqlite3"
        workbench.DEFAULT_DB_PATH = self.root / "demo.sqlite3"
        workbench.UPLOAD_DIRECTORY = self.root / "uploads"
        workbench.DATABASE_DIRECTORY = self.root / "databases"
        with sqlite3.connect(workbench.DEFAULT_DB_PATH, factory=workbench.Conn) as connection:
            connection.executescript("CREATE TABLE notes(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO notes VALUES(1,'first'),(2,'second');")
        self.cookie = self.csrf = ""
        self.password = "a long test passphrase 42"
        status, auth = self.request("POST", "/api/auth/register", {"first_name":"Ada", "last_name":"Lovelace", "email":"ada@example.com", "password":self.password})
        self.assertEqual(status, 201)
        self.account = auth["user"]
        status, self.session = self.request("POST", "/api/sessions", {"database_mode":"upload", "name":"demo.sqlite3", "contents":base64.b64encode(workbench.DEFAULT_DB_PATH.read_bytes()).decode()})
        self.assertEqual(status, 201)
        self.session_id = self.session["session_id"]

    def tearDown(self):
        workbench.REPOSITORY_PATH = self.old_repository
        workbench.DEFAULT_DB_PATH = self.old_demo
        workbench.UPLOAD_DIRECTORY = self.old_uploads
        workbench.DATABASE_DIRECTORY = self.old_databases
        self.temporary.cleanup()

    def request(self, method, path, payload=None, session_id=None, extra_headers=None, raw=False):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode() if payload is not None else b""
        headers = {"Host": "127.0.0.1:8000", "Content-Type": "application/json", "Content-Length": str(len(body))}
        if session_id:
            headers["X-Session-ID"] = session_id
        if self.cookie:
            headers["Cookie"] = self.cookie
        if self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        headers.update(extra_headers or {})
        wire = (f"{method} {path} HTTP/1.0\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n").encode() + body
        socket = Socket(wire)
        QuietHandler(socket, ("127.0.0.1", 9000), None)
        head, body = bytes(socket.outgoing).split(b"\r\n\r\n", 1)
        status = int(head.split(b" ")[1])
        self.last_headers = head.decode()
        for line in head.decode().split("\r\n"):
            if line.lower().startswith("set-cookie:"):
                self.cookie = line.split(":", 1)[1].strip().split(";", 1)[0]
        result = body if raw else json.loads(body)
        if not raw and result.get("csrf_token"):
            self.csrf = result["csrf_token"]
        return status, result

class HttpTests(HttpHarness, unittest.TestCase):
    def test_session_required_for_data_routes_and_status_gate(self):
        self.assertEqual(self.request("GET", "/api/schema")[0], 403)
        status, response = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertTrue(response["session_required"])
        status, response = self.request("GET", "/api/status", session_id=self.session_id)
        self.assertEqual(response["session_id"], self.session_id)

    def test_request_confirm_history_and_end(self):
        status, response = self.request("POST", "/api/ask", {"question": "delete from notes where id=1"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertTrue(response["requires_confirmation"])
        status, done = self.request("POST", "/api/commands/confirm", {"command_id": response["command_id"], "confirmation_token": response["confirmation_token"]}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(done["changes"], 1)
        _, history = self.request("GET", "/api/history?operation=DELETE", session_id=self.session_id)
        command = history["requests"][0]["commands"][0]
        self.assertEqual(command["result"]["payload"]["changes"], 1)
        self.request("POST", "/api/sessions/end", {}, self.session_id)
        self.assertEqual(self.request("POST", "/api/ask", {"question": "count notes"}, self.session_id)[0], 400)

    def test_ask_forwards_gemini_interpreter(self):
        plan = [{"sql": 'SELECT COUNT(*) AS row_count FROM "notes"', "summary": "Counts notes.", "visualization": "table"}]
        with patch.object(workbench.gemini_provider, "generate_plans", return_value=plan):
            status, response = self.request("POST", "/api/ask", {"question": "how many notes?", "interpreter": "gemini"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(response["interpreter"], "gemini")
        self.assertEqual(response["rows"], [{"row_count": 2}])

    def test_incomplete_request_is_rejected_even_when_sent_directly_to_the_api(self):
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            status, response = self.request("POST", "/api/ask", {"question": "e", "interpreter": "gemini"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertFalse(response["matched"])
        self.assertTrue(response["needs_clarification"])
        self.assertNotIn("sql", response)
        generate.assert_not_called()
        _, history = self.request("GET", "/api/history", session_id=self.session_id)
        self.assertEqual(history["requests"][0]["commands"], [])

    def test_selected_table_supports_everyday_preview_requests(self):
        status, response = self.request("POST", "/api/ask", {"question":"show me the data", "selected_table":"notes"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(len(response["rows"]), 2)
        _, clarification = self.request("POST", "/api/ask", {"question":"visualize the data", "selected_table":"notes"}, self.session_id)
        self.assertTrue(clarification["needs_clarification"])
        self.assertIn('count "notes" by body', clarification["suggestions"])

    def test_followup_and_reset_use_session_context_without_removing_history(self):
        self.request("POST", "/api/ask", {"question":"show notes where id=1"}, self.session_id)
        status, count = self.request("POST", "/api/ask", {"question":"count them", "selected_table":"notes"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(count["rows"], [{"row_count":1}])
        self.assertEqual(self.request("POST", "/api/conversation/reset", {}, self.session_id, {"X-CSRF-Token":""})[0], 403)
        status, reset = self.request("POST", "/api/conversation/reset", {}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(reset["conversation_after"], count["request_id"])
        _, status_data = self.request("GET", "/api/status", session_id=self.session_id)
        self.assertEqual(status_data["conversation_after"], reset["conversation_after"])
        _, history = self.request("GET", "/api/history", session_id=self.session_id)
        self.assertEqual(len(history["requests"]), 2)
        self.assertEqual(workbench.get_repository().conversation(self.session_id), [])

    def test_restored_confirmation_has_a_fresh_preview_without_running_the_write(self):
        self.request("POST", "/api/query", {"sql":"DELETE FROM notes WHERE id=1"}, self.session_id)
        _, history = self.request("GET", "/api/history", session_id=self.session_id)
        command = history["requests"][0]["commands"][0]
        self.assertEqual(command["preview"], {"table":"notes", "affected_rows":1})
        self.assertEqual(command["status"], "pending")
        _, count = self.request("POST", "/api/ask", {"question":"count notes"}, self.session_id)
        self.assertEqual(count["rows"], [{"row_count":2}])

    def test_legacy_confirmed_sql_cannot_bypass_saved_commands(self):
        status, response = self.request("POST", "/api/query", {"sql": "DELETE FROM notes", "confirmed": True}, self.session_id)
        self.assertEqual(status, 400)
        self.assertIn("stored command", response["error"])

    def test_upload_creates_new_session_and_cannot_reuse_old_confirmation(self):
        _, pending = self.request("POST", "/api/query", {"sql": "DELETE FROM notes"}, self.session_id)
        status, switched = self.request("POST", "/api/connect", workbench.DEFAULT_DB_PATH.read_bytes(), self.session_id,
                                       {"Content-Type": "application/octet-stream", "X-Filename": "copy.sqlite3"})
        self.assertEqual(status, 200)
        status, _ = self.request("POST", "/api/commands/confirm", {"command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"]}, switched["session_id"])
        self.assertEqual(status, 400)
        _, count = self.request("POST", "/api/ask", {"question": "count notes"}, switched["session_id"])
        self.assertEqual(count["rows"], [{"row_count": 2}])

    def test_download_uses_session_query_parameter(self):
        status, binary = self.request("GET", "/api/download?session_id=" + self.session_id, raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(binary.startswith(b"SQLite format 3\x00"))

    def test_binaries_serialize_and_sql_errors_are_recorded(self):
        status, response = self.request("POST", "/api/query", {"sql": "SELECT X'0102' AS payload"}, self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(response["rows"][0]["payload"]["type"], "blob")
        _, response = self.request("POST", "/api/query", {"sql": "SELECT * FROM missing"}, self.session_id)
        self.assertFalse(response["matched"])
        _, history = self.request("GET", "/api/history", session_id=self.session_id)
        self.assertEqual(history["requests"][0]["status"], "rejected")

    def test_cross_origin_and_malformed_json_are_rejected(self):
        status, _ = self.request("POST", "/api/ask", {"question": "count notes"}, self.session_id, {"Origin": "https://example.com"})
        self.assertEqual(status, 403)
        self.assertEqual(self.request("POST", "/api/ask", b"[]", self.session_id)[0], 400)
        self.assertEqual(self.request("POST", "/api/ask", b"{bad", self.session_id)[0], 400)

    def test_only_explicit_static_files_are_served(self):
        for path in ("/", "/index.html", "/faq", "/faq.html", "/app", "/signin", "/signup", "/databases", "/history", "/account", "/dashboard.html", "/static/design.css", "/static/favicon.svg"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path, raw=True)[0], 200)
        for path in ("/server.py", "/repository.py", "/db/data_genie_repository.sqlite3", "/static/../server.py"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path, session_id=self.session_id)[0], 404)

    def test_pages_share_the_react_entry_and_built_assets_are_served(self):
        _, home = self.request("GET", "/", raw=True)
        _, workspace = self.request("GET", "/app", raw=True)
        self.assertEqual(home, workspace)
        self.assertIn(b'id="root"', home)
        self.assertIn(b'type="module"', home)
        assets = re.findall(rb'(?:src|href)="(/assets/[^\"]+)"', home)
        self.assertGreaterEqual(len(assets), 2)
        for path in assets:
            self.assertEqual(self.request("GET", path.decode(), raw=True)[0], 200)
        for path in ("/assets/../server.py", "/assets/%2e%2e%2frepository.py", "/assets/missing.js"):
            self.assertEqual(self.request("GET", path, raw=True)[0], 404)

    def test_homepage_sample_can_answer_its_missouri_example(self):
        with patch.object(workbench, "SHOP_DB_PATH", self.root / "shop.sqlite3"):
            status, sample = self.request("POST", "/api/sessions", {"first_name":"Demo", "last_name":"Reader", "email":"demo@example.com", "database_mode":"sample"})
            self.assertEqual(status, 201)
            self.assertEqual(sample["source"], "demo")
            _, result = self.request("POST", "/api/ask", {"question":"show customers where state = 'Missouri'"}, sample["session_id"])
            self.assertEqual([row["name"] for row in result["rows"]], ["Jon Reyes", "Priya Nair", "Tom Whitaker"])

    def test_start_requires_explicit_source_and_can_create_database(self):
        identity = {"first_name": "Grace", "last_name": "Hopper", "email": "grace@example.com"}
        self.assertEqual(self.request("POST", "/api/sessions", identity)[0], 400)
        status, created = self.request("POST", "/api/sessions", {**identity, "database_mode": "create", "database_name": "work", "starter": True})
        self.assertEqual(status, 201)
        self.assertEqual(created["source"], "created")
        self.assertEqual(created["database"], "work.sqlite3")
        _, result = self.request("POST", "/api/ask", {"question": "show notes"}, created["session_id"])
        self.assertEqual(len(result["rows"]), 1)

    def test_new_browser_database_is_empty_unless_a_sample_is_requested(self):
        identity = {"first_name": "Katherine", "last_name": "Johnson", "email": "katherine@example.com"}
        status, created = self.request("POST", "/api/sessions", {**identity, "database_mode": "create", "database_name": "blank"})
        self.assertEqual(status, 201)
        self.assertEqual(created["tables"], [])

    def test_create_from_workspace_switches_both_query_interfaces(self):
        status, created = self.request("POST", "/api/databases", {"name": "blank.sqlite3", "starter": False}, self.session_id)
        self.assertEqual(status, 201)
        self.assertEqual(created["tables"], [])
        _, ask = self.request("POST", "/api/ask", {"question": "show tables"}, created["session_id"])
        self.assertEqual(ask["rows"], [])
        _, sql = self.request("POST", "/api/query", {"sql": "SELECT name FROM sqlite_master WHERE type='table'"}, created["session_id"])
        self.assertEqual(sql["rows"], [])


if __name__ == "__main__":
    unittest.main()
