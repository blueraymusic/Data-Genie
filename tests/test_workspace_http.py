"""Workspace permissions are enforced at HTTP boundaries, not just in the UI.

The fixtures use isolated SQLite files and independent browser logins. No external
database, AI service, or listening HTTP server is needed.
"""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import sqlite3
from threading import Event
import time
import unittest
from unittest.mock import patch

from backend import workbench
from tests.test_http import HttpHarness


class WorkspaceHttpTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.clients = {"owner": (self.cookie, self.csrf, self.account)}
        for name in ("member", "viewer", "outsider"):
            self.cookie = self.csrf = ""
            status, response = self.request("POST", "/api/auth/register", {
                "first_name": name.title(), "last_name": "Fixture",
                "email": name + "@example.test", "password": self.password,
            })
            self.assertEqual(status, 201, response)
            self.clients[name] = (self.cookie, self.csrf, response["user"])
        self.as_user("owner")
        status, self.workspace = self.request("POST", "/api/workspaces", {"name": "Fixture team"})
        self.assertEqual(status, 201, self.workspace)
        self.workspace_id = self.workspace["workspace_id"]
        self.database_id = self.session["database_id"]
        status, response = self.request("POST", self.route("attach"), {"database_id": self.database_id})
        self.assertEqual(status, 200, response)

    def as_user(self, name):
        self.cookie, self.csrf, _ = self.clients[name]

    def route(self, action=None, workspace_id=None):
        return "/api/workspaces/" + (workspace_id or self.workspace_id) + ("/" + action if action else "")

    def invite(self, name="member", role="member"):
        self.as_user("owner")
        status, invitation = self.request("POST", self.route("invite"), {
            "email": self.clients[name][2]["email"], "role": role,
        })
        self.assertEqual(status, 201, invitation)
        self.assertTrue(invitation["token"])
        return invitation

    def accept(self, invitation, name="member"):
        self.as_user(name)
        status, response = self.request("POST", "/api/workspaces/invitations/accept", {
            "invitation_id": invitation["invitation_id"], "token": invitation["token"],
        })
        self.assertEqual(status, 200, response)
        return response

    def join(self, name="member", role="member"):
        return self.accept(self.invite(name, role), name)

    def grant(self, name="member", database_id=None, **permissions):
        self.as_user("owner")
        status, response = self.request("POST", self.route("grants"), {
            "account_id": self.clients[name][2]["account_id"],
            "database_id": database_id or self.database_id, "permissions": permissions,
        })
        self.assertEqual(status, 200, response)
        return response

    def open(self, name="member", database_id=None):
        self.as_user(name)
        status, response = self.request("POST", self.route("open"), {
            "database_id": database_id or self.database_id,
        })
        self.assertEqual(status, 200, response)
        return response

    def forbidden(self, method, path, payload=None, session_id=None):
        status, response = self.request(method, path, payload, session_id)
        self.assertEqual(status, 403, response)
        self.assertIn("error", response)
        return response

    def query(self, session_id, sql):
        status, response = self.request("POST", "/api/query", {"sql": sql}, session_id)
        self.assertEqual(status, 200, response)
        self.assertTrue(response["matched"], response)
        return response

    def confirm(self, session_id, pending):
        self.assertTrue(pending["requires_confirmation"], pending)
        status, response = self.request("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, session_id)
        self.assertEqual(status, 200, response)
        self.assertEqual(response["status"], "executed")
        return response

    def fixture_rows(self):
        path = workbench.get_repository().get_session(self.session_id)["path"]
        with sqlite3.connect(path) as connection:
            return connection.execute("SELECT id,body FROM notes ORDER BY id").fetchall()

    def test_workspace_routes_require_login_csrf_and_membership(self):
        self.cookie = self.csrf = ""
        self.assertEqual(self.request("GET", "/api/workspaces")[0], 401)
        self.as_user("owner")
        csrf = self.csrf
        self.csrf = ""
        self.forbidden("POST", self.route("invite"), {"email": "member@example.test", "role": "member"})
        self.csrf = csrf
        self.as_user("outsider")
        self.forbidden("GET", self.route())
        _, listing = self.request("GET", "/api/workspaces")
        self.assertNotIn(self.workspace_id, json.dumps(listing))

    def test_invitation_requires_secret_and_matching_account_without_disclosing_secret_in_lists(self):
        invitation = self.invite()
        self.as_user("owner")
        for path in ("/api/workspaces", self.route()):
            status, listing = self.request("GET", path)
            self.assertEqual(status, 200, listing)
            self.assertNotIn(invitation["token"], json.dumps(listing))
        self.as_user("member")
        for token in (None, "not-the-invitation-secret"):
            self.forbidden("POST", "/api/workspaces/invitations/accept", {
                "invitation_id": invitation["invitation_id"], "token": token,
            })
        self.as_user("outsider")
        self.forbidden("POST", "/api/workspaces/invitations/accept", {
            "invitation_id": invitation["invitation_id"], "token": invitation["token"],
        })
        self.accept(invitation)
        status, detail = self.request("GET", self.route())
        self.assertEqual(status, 200, detail)
        self.assertEqual(detail["workspace"]["role"], "member")
        self.assertEqual(detail["grants"], [])
        self.assertEqual(detail["invitations"], [])

    def test_expired_and_revoked_invitations_cannot_add_members(self):
        invitation = self.invite()
        repository = workbench.get_repository()
        with repository._connection(write=True) as connection:
            connection.execute("UPDATE workspace_invitations SET expires_at=? WHERE invitation_id=?", (
                int(time.time()) - 1, invitation["invitation_id"],
            ))
        self.as_user("member")
        self.forbidden("POST", "/api/workspaces/invitations/accept", {
            "invitation_id": invitation["invitation_id"], "token": invitation["token"],
        })
        revoked = self.invite("viewer", "viewer")
        status, response = self.request("POST", self.route("invitations/revoke"), {
            "invitation_id": revoked["invitation_id"],
        })
        self.assertEqual(status, 200, response)
        self.as_user("viewer")
        self.forbidden("POST", "/api/workspaces/invitations/accept", {
            "invitation_id": revoked["invitation_id"], "token": revoked["token"],
        })
        self.forbidden("GET", self.route())

    def test_member_cannot_manage_members_grants_or_workspace_database_connections(self):
        self.join()
        self.grant(read=True)
        member_session = self.open()["session_id"]
        attempts = [
            (self.route("invite"), {"email": "outsider@example.test", "role": "member"}),
            (self.route("members"), {"account_id": self.clients["member"][2]["account_id"], "role": "viewer"}),
            (self.route("remove"), {"account_id": self.clients["owner"][2]["account_id"]}),
            (self.route("grants"), {"account_id": self.clients["member"][2]["account_id"], "database_id": self.database_id, "permissions": {"read": True, "write": True}}),
            (self.route("attach"), {"database_id": self.database_id}),
            ("/api/sessions", {"database_mode": "create", "database_name": "unauthorized", "workspace_id": self.workspace_id}),
            ("/api/databases", {"name": "unauthorized"}),
        ]
        for path, payload in attempts:
            with self.subTest(path=path):
                self.forbidden("POST", path, payload, member_session)
        _, details = self.request("GET", self.route())
        self.assertEqual(details["workspace"]["role"], "member")
        self.assertEqual(len(details["databases"]), 1)

    def test_member_without_a_database_grant_cannot_open_or_reuse_owner_session(self):
        self.join()
        self.forbidden("POST", self.route("open"), {"database_id": self.database_id})
        self.forbidden("GET", "/api/status", session_id=self.session_id)
        self.forbidden("POST", "/api/sessions/resume", {"session_id": self.session_id})
        self.forbidden("GET", "/api/history?history_session_id=" + self.session_id)

    def test_read_grant_allows_ask_sql_and_schema_but_not_any_write_or_export(self):
        self.join()
        self.grant(read=True)
        member_session = self.open()["session_id"]
        status, result = self.request("POST", "/api/ask", {"question": "count notes"}, member_session)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["rows"], [{"row_count": 2}])
        self.assertEqual(self.query(member_session, "SELECT body FROM notes ORDER BY id")["rows"], [{"body": "first"}, {"body": "second"}])
        status, schema = self.request("GET", "/api/schema", session_id=member_session)
        self.assertEqual(status, 200, schema)
        self.assertEqual(schema["tables"][0]["name"], "notes")
        for sql in (
            "INSERT INTO notes VALUES (3,'third')", "UPDATE notes SET body='changed' WHERE id=1",
            "DELETE FROM notes WHERE id=1", "REPLACE INTO notes VALUES(1,'replaced')",
            "ALTER TABLE notes ADD COLUMN salary INTEGER", "CREATE TABLE forbidden(id INTEGER)", "DROP TABLE notes",
        ):
            with self.subTest(sql=sql):
                self.forbidden("POST", "/api/query", {"sql": sql}, member_session)
        self.forbidden("POST", "/api/ask", {"question": "delete from notes where id=1"}, member_session)
        plan = [{"sql": "UPDATE notes SET body='AI write' WHERE id=1", "summary": "Update the note.", "visualization": "table"}]
        with patch.object(workbench.gemini_provider, "generate_plans", return_value=plan):
            self.forbidden("POST", "/api/ask", {"question": "change the first note's body", "interpreter": "gemini"}, member_session)
        self.forbidden("GET", "/api/download?session_id=" + member_session)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_write_grant_changes_shared_data_only_after_confirmation_and_does_not_imply_delete(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        pending = self.query(member_session, "INSERT INTO notes VALUES(3,'third')")
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])
        self.confirm(member_session, pending)
        self.confirm(member_session, self.query(member_session, "UPDATE notes SET body='revised' WHERE id=3"))
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second"), (3, "revised")])
        for sql in (
            "DELETE FROM notes WHERE id=1", "REPLACE INTO notes VALUES(1,'replaced')",
            "INSERT OR REPLACE INTO notes VALUES(1,'replaced')",
            "UPDATE OR REPLACE notes SET id=2 WHERE id=1",
            "ALTER TABLE notes ADD COLUMN private TEXT",
        ):
            self.forbidden("POST", "/api/query", {"sql": sql}, member_session)
        self.as_user("owner")
        owner_rows = self.query(self.session_id, "SELECT id,body FROM notes ORDER BY id")["rows"]
        self.assertEqual(owner_rows[-1], {"id": 3, "body": "revised"})

    def test_delete_structure_and_export_grants_are_independent_of_write(self):
        self.join()
        self.grant(read=True, delete=True, structure=True, export=True)
        member_session = self.open()["session_id"]
        self.confirm(member_session, self.query(member_session, "DELETE FROM notes WHERE id=2"))
        self.confirm(member_session, self.query(member_session, "ALTER TABLE notes ADD COLUMN salary INTEGER"))
        self.forbidden("POST", "/api/query", {"sql": "INSERT INTO notes(id,body) VALUES(3,'third')"}, member_session)
        status, binary = self.request("GET", "/api/download?session_id=" + member_session, raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(binary.startswith(b"SQLite format 3\x00"))
        self.assertEqual(self.fixture_rows(), [(1, "first")])

    def test_revoking_a_permission_invalidates_an_already_prepared_confirmation(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        pending = self.query(member_session, "UPDATE notes SET body='must not run' WHERE id=1")
        self.grant(read=True)
        self.as_user("member")
        self.forbidden("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, member_session)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_a_trigger_cannot_smuggle_delete_through_a_write_grant(self):
        path = workbench.get_repository().get_session(self.session_id)["path"]
        with sqlite3.connect(path) as connection:
            connection.execute("CREATE TRIGGER delete_second AFTER UPDATE ON notes BEGIN DELETE FROM notes WHERE id=2; END")
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        self.forbidden("POST", "/api/query", {"sql": "UPDATE notes SET body='changed' WHERE id=1"}, member_session)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_confirmation_rechecks_effects_when_a_trigger_was_added_after_preview(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        pending = self.query(member_session, "UPDATE notes SET body='changed' WHERE id=1")
        path = workbench.get_repository().get_session(self.session_id)["path"]
        with sqlite3.connect(path) as connection:
            connection.execute("CREATE TRIGGER late_delete AFTER UPDATE ON notes BEGIN DELETE FROM notes WHERE id=2; END")
        self.forbidden("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, member_session)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_foreign_key_side_effects_require_their_own_permission(self):
        path = workbench.get_repository().get_session(self.session_id)["path"]
        with sqlite3.connect(path) as connection:
            connection.executescript("""
                CREATE TABLE parents(id INTEGER PRIMARY KEY);
                CREATE TABLE children(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parents(id) ON DELETE SET NULL);
                INSERT INTO parents VALUES(1);
                INSERT INTO children VALUES(1,1);
            """)
        self.join()
        self.grant(read=True, delete=True)
        member_session = self.open()["session_id"]
        self.forbidden("POST", "/api/query", {"sql": "DELETE FROM parents WHERE id=1"}, member_session)
        with sqlite3.connect(path) as connection:
            self.assertEqual(connection.execute("SELECT * FROM parents").fetchall(), [(1,)])
            self.assertEqual(connection.execute("SELECT * FROM children").fetchall(), [(1, 1)])

    def test_mixed_ai_plan_is_rejected_before_any_command_runs(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        plans = [
            {"sql": "INSERT INTO notes VALUES(3,'must not run')", "summary": "Add a note.", "visualization": "table"},
            {"sql": "DELETE FROM notes WHERE id=1", "summary": "Delete a note.", "visualization": "table"},
        ]
        with patch.object(workbench.gemini_provider, "generate_plans", return_value=plans):
            self.forbidden("POST", "/api/ask", {"question": "add a note then delete the first note", "interpreter": "gemini"}, member_session)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_read_revocation_blocks_existing_sessions_and_result_paging(self):
        self.join()
        self.grant(read=True, export=True)
        member_session = self.open()["session_id"]
        result = self.query(member_session, "SELECT * FROM notes")
        self.grant()
        self.as_user("member")
        paths = [
            "/api/status", "/api/schema", "/api/sample?table=notes", "/api/history",
            "/api/history?history_session_id=" + member_session,
            "/api/results/page?command_id=" + str(result["command_id"]),
            "/api/download?session_id=" + member_session,
        ]
        for path in paths:
            with self.subTest(path=path):
                self.forbidden("GET", path, session_id=member_session)
        self.forbidden("POST", "/api/query", {"sql": "SELECT * FROM notes"}, member_session)
        self.forbidden("POST", "/api/ask", {"question": "show notes"}, member_session)
        self.forbidden("POST", "/api/sessions/resume", {"session_id": member_session})
        status, ended = self.request("POST", "/api/sessions/end", {}, member_session)
        self.assertEqual(status, 200, ended)
        self.assertIsNotNone(workbench.get_repository().get_session(member_session)["ended_at"])

    def test_revoked_session_never_sends_attachments_or_prepares_ai(self):
        self.join()
        self.grant(read=True)
        member_session = self.open()["session_id"]
        self.grant()
        self.as_user("member")
        with patch.object(workbench.gemini_provider, "generate_plans") as provider:
            self.forbidden("POST", "/api/ask", {"question": "show notes", "interpreter": "gemini",
                "attachments": [{"mime_type": "application/pdf", "data": "JVBERi0xLjQ="}]}, member_session)
        provider.assert_not_called()

    def test_old_confirmation_stays_invalid_after_read_access_is_regranted(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        prepared = self.query(member_session, "INSERT INTO notes VALUES(10,'never run')")
        self.grant()
        self.grant(read=True, write=True)
        self.as_user("member")
        status, response = self.request("POST", "/api/commands/confirm", {
            "command_id": prepared["command_id"], "confirmation_token": prepared["confirmation_token"]}, member_session)
        self.assertEqual(status, 400, response)
        self.assertEqual(workbench.get_repository().get_command(prepared["command_id"])["status"], "declined")
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_reads_waiting_for_database_lock_recheck_revoked_grants(self):
        self.join()
        self.grant(read=True, export=True)
        member_session = self.open()["session_id"]
        result = self.query(member_session, "SELECT * FROM notes")
        path = workbench.get_repository().get_session(member_session)["path"]
        original_access = workbench.session_access
        checked = Event()

        def observe_access(repository, session, capability="read"):
            access = original_access(repository, session, capability)
            if session and session["session_id"] == member_session:
                checked.set()
            return access

        actions = {
            "result page": lambda: workbench.result_page(member_session, result["command_id"]),
            "schema": lambda: workbench.schema_for_session(member_session),
            "export": lambda: workbench.export_database(member_session, self.root / "blocked-export.sqlite3"),
        }
        for name, action in actions.items():
            with self.subTest(action=name):
                self.grant(read=True, export=True)
                member_session = self.open()["session_id"]
                result = self.query(member_session, "SELECT * FROM notes")
                checked.clear()
                with ThreadPoolExecutor(max_workers=1) as pool, patch.object(workbench, "session_access", observe_access):
                    with workbench._lock(path):
                        pending = pool.submit(action)
                        self.assertTrue(checked.wait(3), "The read did not pass its initial access check.")
                        self.grant()
                    with self.assertRaises(PermissionError):
                        pending.result(timeout=3)
        self.assertFalse((self.root / "blocked-export.sqlite3").exists())

    def test_role_downgrade_and_removal_immediately_block_existing_database_sessions(self):
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        self.as_user("owner")
        status, response = self.request("POST", self.route("members"), {
            "account_id": self.clients["member"][2]["account_id"], "role": "viewer",
        })
        self.assertEqual(status, 200, response)
        self.as_user("member")
        self.forbidden("POST", "/api/query", {"sql": "SELECT * FROM notes"}, member_session)
        self.forbidden("POST", self.route("open"), {"database_id": self.database_id})
        self.as_user("owner")
        status, response = self.request("POST", self.route("remove"), {"account_id": self.clients["member"][2]["account_id"]})
        self.assertEqual(status, 200, response)
        self.as_user("member")
        self.forbidden("GET", self.route())
        self.forbidden("GET", "/api/schema", session_id=member_session)

    def test_switching_to_an_authorized_database_cleans_up_a_revoked_current_session(self):
        self.join()
        self.grant(read=True)
        old_session = self.open()["session_id"]
        self.grant()
        self.as_user("owner")
        status, second = self.request("POST", "/api/sessions", {
            "database_mode": "create", "database_name": "another database", "workspace_id": self.workspace_id,
        })
        self.assertEqual(status, 201, second)
        self.grant(database_id=second["database_id"], read=True)
        self.as_user("member")
        status, opened = self.request("POST", self.route("open"), {
            "database_id": second["database_id"],
        }, old_session)
        self.assertEqual(status, 200, opened)
        self.assertEqual(opened["database_id"], second["database_id"])
        self.assertIsNotNone(workbench.get_repository().get_session(old_session)["ended_at"])
        self.assertEqual(self.request("GET", "/api/schema", session_id=opened["session_id"])[0], 200)

    def test_viewers_see_workspace_membership_but_no_database_metadata_or_raw_data(self):
        self.join("viewer", "viewer")
        status, detail = self.request("GET", self.route())
        self.assertEqual(status, 200, detail)
        self.assertEqual(detail["workspace"]["role"], "viewer")
        self.assertEqual(detail["databases"], [])
        self.assertEqual(detail["members"], [])
        self.forbidden("POST", self.route("open"), {"database_id": self.database_id})
        self.forbidden("GET", "/api/schema", session_id=self.session_id)
        self.forbidden("POST", "/api/query", {"sql": "SELECT * FROM notes"}, self.session_id)

    def test_database_ids_cannot_be_used_through_a_different_workspace(self):
        self.as_user("outsider")
        status, other = self.request("POST", "/api/workspaces", {"name": "Other team"})
        self.assertEqual(status, 201, other)
        other_id = other["workspace_id"]
        status, invitation = self.request("POST", self.route("invite", other_id), {
            "email": self.clients["member"][2]["email"], "role": "member",
        })
        self.assertEqual(status, 201, invitation)
        self.accept(invitation)
        self.as_user("outsider")
        for action, payload in (
            ("open", {"database_id": self.database_id}),
            ("attach", {"database_id": self.database_id}),
            ("grants", {"account_id": self.clients["member"][2]["account_id"], "database_id": self.database_id, "permissions": {"read": True}}),
        ):
            with self.subTest(action=action):
                self.forbidden("POST", self.route(action, other_id), payload)
        self.as_user("owner")
        self.forbidden("GET", self.route(workspace_id=other_id))
        self.forbidden("POST", self.route("open", other_id), {"database_id": self.database_id})

    def test_shared_database_sessions_and_confirmation_tokens_keep_each_users_history_private(self):
        self.as_user("owner")
        self.query(self.session_id, "SELECT body AS owner_only_result FROM notes")
        self.join()
        self.grant(read=True, write=True)
        member_session = self.open()["session_id"]
        _, history = self.request("GET", "/api/history", session_id=member_session)
        self.assertEqual(history["requests"], [])
        pending = self.query(member_session, "UPDATE notes SET body='member change' WHERE id=1")
        self.forbidden("GET", "/api/history?history_session_id=" + self.session_id, session_id=member_session)
        _, sessions = self.request("GET", "/api/sessions")
        self.assertNotIn(self.session_id, [session["session_id"] for session in sessions["sessions"]])
        self.as_user("owner")
        self.forbidden("GET", "/api/history?history_session_id=" + member_session, session_id=self.session_id)
        self.forbidden("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, member_session)
        status, _ = self.request("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, self.session_id)
        self.assertEqual(status, 400)
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])

    def test_workspace_delete_route_requires_owner_name_and_csrf_and_preserves_database(self):
        self.join()
        self.as_user("member")
        self.forbidden("POST", self.route("delete"), {"name": self.workspace["name"]})
        self.as_user("owner")
        csrf, self.csrf = self.csrf, ""
        self.forbidden("POST", self.route("delete"), {"name": self.workspace["name"]})
        self.csrf = csrf
        self.assertEqual(self.request("POST", self.route("delete"), {"name": "wrong"})[0], 400)
        status, response = self.request("POST", self.route("delete"), {"name": self.workspace["name"]})
        self.assertEqual(status, 200, response)
        self.assertTrue(response["deleted"])
        self.assertEqual(response["workspace_id"], self.workspace_id)
        status, personal = self.request("GET", self.route(workspace_id=response["personal_workspace_id"]))
        self.assertEqual(status, 200, personal)
        self.assertIn(self.database_id, [database["database_id"] for database in personal["databases"]])
        self.assertEqual(self.fixture_rows(), [(1, "first"), (2, "second")])
        self.forbidden("GET", self.route())

    @unittest.skipUnless(importlib.util.find_spec("cryptography"), "Optional PostgreSQL dependencies are not installed")
    def test_shared_postgres_grants_cannot_exceed_the_owners_read_only_connection(self):
        with patch.object(workbench.PostgresConnector, "schema", return_value=[]):
            status, postgres = self.request("POST", "/api/sessions", {
                "database_mode": "postgresql", "connection_url": "postgresql://reader:fixture-password@localhost/shop",
                "allow_changes": False, "workspace_id": self.workspace_id,
            })
        self.assertEqual(status, 201, postgres)
        self.join()
        self.grant(database_id=postgres["database_id"], read=True, write=True, delete=True, structure=True)
        with patch.object(workbench.PostgresConnector, "schema", return_value=[]):
            member_session = self.open(database_id=postgres["database_id"])
            self.assertTrue(member_session["read_only"])
            with patch.object(workbench.PostgresConnector, "prepare_batch") as prepare, patch.object(workbench.PostgresConnector, "execute") as execute:
                self.forbidden("POST", "/api/query", {"sql": "UPDATE customers SET name='blocked' WHERE id=1"}, member_session["session_id"])
                prepare.assert_not_called()
                execute.assert_not_called()
        self.as_user("member")
        status, details = self.request("GET", self.route())
        self.assertEqual(status, 200, details)
        encoded = json.dumps(details)
        for secret in ("fixture-password", "encrypted_config", "connection_url"):
            self.assertNotIn(secret, encoded)


if __name__ == "__main__":
    unittest.main()
