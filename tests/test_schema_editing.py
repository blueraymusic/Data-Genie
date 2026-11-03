"""Manual schema changes use the existing SQL preview and confirmation API."""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import threading
import unittest

from backend import workbench
from backend.connections.postgres import PostgresConnector, connection_config
from tests.test_http import HttpHarness


class SchemaEditingHttpTests(HttpHarness, unittest.TestCase):
    def query(self, sql):
        status, response = self.request("POST", "/api/query", {"sql": sql}, self.session_id)
        self.assertEqual(status, 200, response)
        return response

    def prepare(self, sql):
        response = self.query(sql)
        self.assertTrue(response["matched"], response)
        self.assertTrue(response["requires_confirmation"], response)
        self.assertEqual(response["kind"], "DDL")
        self.assertEqual(response["operation"], "write")
        self.assertEqual(response["status"], "pending")
        return response

    def confirm(self, pending):
        status, response = self.request("POST", "/api/commands/confirm", {
            "command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"],
        }, self.session_id)
        self.assertEqual(status, 200, response)
        self.assertTrue(response["schema_changed"])
        self.assertEqual(response["status"], "executed")
        self.assertFalse(response["requires_confirmation"])
        return response

    def schema(self):
        status, response = self.request("GET", "/api/schema", session_id=self.session_id)
        self.assertEqual(status, 200, response)
        return {table["name"]: table for table in response["tables"]}

    def test_create_quoted_table_waits_for_confirmation_and_refreshes_structure_and_history(self):
        statement = 'CREATE TABLE "Project; ""Notes""" ("entry id" INTEGER PRIMARY KEY, "entry ""text""" TEXT NOT NULL)'
        pending = self.prepare(statement)
        self.assertEqual(pending["sql"], statement)
        self.assertNotIn('Project; "Notes"', self.schema())
        self.assertEqual(pending["preview"]["table"], 'Project; "Notes"')
        self.confirm(pending)
        table = self.schema()['Project; "Notes"']
        self.assertEqual([column["name"] for column in table["columns"]], ["entry id", 'entry "text"'])
        self.assertEqual(table["row_count"], 0)
        _, history = self.request("GET", "/api/history?operation=CREATE", session_id=self.session_id)
        command = history["requests"][0]["commands"][0]
        self.assertEqual(command["sql"], statement)
        self.assertEqual(command["status"], "executed")
        self.assertEqual(command["targets"][0]["access_type"], "define")

    def test_table_and_column_renames_preserve_rows_and_refresh_names(self):
        rename = self.prepare('ALTER TABLE notes RENAME TO "Customer ""Notes"""')
        self.assertEqual(self.query("SELECT * FROM notes ORDER BY id")["rows"], [
            {"id": 1, "body": "first"}, {"id": 2, "body": "second"},
        ])
        self.assertIn("notes", self.schema())
        self.confirm(rename)
        self.assertNotIn("notes", self.schema())
        self.assertIn('Customer "Notes"', self.schema())
        rename_column = self.prepare('ALTER TABLE "Customer ""Notes""" RENAME COLUMN body TO "Note ""Text"""')
        self.assertEqual([column["name"] for column in self.schema()['Customer "Notes"']["columns"]], ["id", "body"])
        self.confirm(rename_column)
        self.assertEqual([column["name"] for column in self.schema()['Customer "Notes"']["columns"]], ["id", 'Note "Text"'])
        self.assertEqual(self.query('SELECT * FROM "Customer ""Notes""" ORDER BY id')["rows"], [
            {"id": 1, 'Note "Text"': "first"}, {"id": 2, 'Note "Text"': "second"},
        ])

    def test_add_and_drop_column_apply_only_after_confirmation_and_keep_existing_data(self):
        added = self.prepare('ALTER TABLE notes ADD COLUMN "extra; field" TEXT NOT NULL DEFAULT \'pending\'')
        self.assertEqual([column["name"] for column in self.schema()["notes"]["columns"]], ["id", "body"])
        self.confirm(added)
        self.assertEqual(self.query('SELECT "extra; field" FROM notes ORDER BY id')["rows"], [
            {"extra; field": "pending"}, {"extra; field": "pending"},
        ])
        dropped = self.prepare('ALTER TABLE notes DROP COLUMN "extra; field"')
        self.assertIn("extra; field", [column["name"] for column in self.schema()["notes"]["columns"]])
        self.confirm(dropped)
        self.assertEqual([column["name"] for column in self.schema()["notes"]["columns"]], ["id", "body"])
        self.assertEqual(self.query("SELECT * FROM notes ORDER BY id")["rows"], [
            {"id": 1, "body": "first"}, {"id": 2, "body": "second"},
        ])

    def test_drop_table_counts_rows_and_decline_or_bad_token_never_changes_it(self):
        pending = self.prepare("DROP TABLE notes")
        self.assertEqual(pending["preview"], {"table": "notes", "affected_rows": 2})
        payload = {"command_id": pending["command_id"], "confirmation_token": "wrong token"}
        self.assertEqual(self.request("POST", "/api/commands/confirm", payload, self.session_id)[0], 400)
        self.assertIn("notes", self.schema())
        payload["confirmation_token"] = pending["confirmation_token"]
        self.assertEqual(self.request("POST", "/api/commands/decline", payload, self.session_id)[0], 200)
        self.assertEqual(self.request("POST", "/api/commands/confirm", payload, self.session_id)[0], 400)
        self.assertEqual(self.query("SELECT COUNT(*) AS total FROM notes")["rows"], [{"total": 2}])
        self.confirm(self.prepare("DROP TABLE notes"))
        self.assertEqual(self.schema(), {})

    def test_invalid_or_unsupported_schema_changes_leave_data_and_schema_untouched(self):
        statements = [
            "ALTER TABLE notes DROP COLUMN id",
            "ALTER TABLE notes ADD COLUMN required_value TEXT NOT NULL",
            "ALTER TABLE notes ADD COLUMN other_id INTEGER PRIMARY KEY",
            "ALTER TABLE notes ALTER COLUMN body TYPE INTEGER",
            "ALTER TABLE notes RENAME COLUMN body TO id",
            'ALTER TABLE notes RENAME TO "Notes"',
            "CREATE TABLE notes (id INTEGER)",
            "ALTER TABLE notes RENAME TO changed; DROP TABLE changed",
            "ATTACH DATABASE ':memory:' AS other",
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                response = self.query(statement)
                self.assertFalse(response["matched"], response)
                self.assertNotIn("command_id", response)
                self.assertEqual([column["name"] for column in self.schema()["notes"]["columns"]], ["id", "body"])
        self.assertEqual(self.query("SELECT * FROM notes ORDER BY id")["rows"], [
            {"id": 1, "body": "first"}, {"id": 2, "body": "second"},
        ])

    def test_schema_confirmation_is_owned_by_its_account_and_session(self):
        pending = self.prepare("ALTER TABLE notes ADD COLUMN private_note TEXT")
        owner_cookie, owner_csrf = self.cookie, self.csrf
        status, _ = self.request("POST", "/api/auth/register", {
            "first_name": "Other", "last_name": "Reader", "email": "other@example.com", "password": self.password,
        }, extra_headers={"Cookie": ""})
        self.assertEqual(status, 201)
        payload = {"command_id": pending["command_id"], "confirmation_token": pending["confirmation_token"]}
        self.assertEqual(self.request("POST", "/api/commands/confirm", payload, self.session_id)[0], 403)
        status, other_session = self.request("POST", "/api/sessions", {"database_mode": "create", "database_name": "other"})
        self.assertEqual(status, 201)
        self.assertEqual(self.request("POST", "/api/commands/confirm", payload, other_session["session_id"])[0], 400)
        self.cookie, self.csrf = owner_cookie, owner_csrf
        self.assertEqual([column["name"] for column in self.schema()["notes"]["columns"]], ["id", "body"])
        self.confirm(pending)

    def test_simultaneous_confirmations_execute_a_schema_change_once(self):
        pending = self.prepare("ALTER TABLE notes ADD COLUMN once_only TEXT")
        ready = threading.Barrier(2)

        def confirm_once():
            ready.wait(timeout=5)
            try:
                return workbench.confirm_command(self.session_id, pending["command_id"], pending["confirmation_token"])
            except ValueError as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: confirm_once(), range(2)))
        self.assertEqual(sum(isinstance(outcome, dict) for outcome in outcomes), 1)
        self.assertEqual(sum(isinstance(outcome, ValueError) for outcome in outcomes), 1)
        self.assertEqual([column["name"] for column in self.schema()["notes"]["columns"]], ["id", "body", "once_only"])
        self.assertEqual(workbench.get_repository().get_command(pending["command_id"])["status"], "executed")


@unittest.skipUnless(importlib.util.find_spec("sqlglot"), "Optional PostgreSQL dependencies are not installed")
class PostgresSchemaSqlTests(unittest.TestCase):
    def setUp(self):
        self.adapter = PostgresConnector(connection_config({
            "connection_url": "postgresql://u:p@localhost/shop", "schema_name": "Connected Schema", "allow_changes": True,
        }))
        self.adapter._schema = [{"name": 'Odd "Table"', "columns": []}]

    def test_native_schema_statements_are_qualified_and_keep_quoted_names(self):
        statements = [
            'CREATE TABLE "New; Table" ("entry id" INTEGER, "entry text" TEXT)',
            'ALTER TABLE "Odd ""Table""" RENAME TO "New; Table"',
            'ALTER TABLE "Odd ""Table""" ADD COLUMN "new; field" TEXT',
            'ALTER TABLE "Odd ""Table""" RENAME COLUMN "old field" TO "new; field"',
            'ALTER TABLE "Odd ""Table""" DROP COLUMN "old field"',
            'DROP TABLE "Odd ""Table"""',
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                root, details = self.adapter._parsed(statement)
                self.assertEqual(details["access"], "write")
                self.assertEqual(details["kind"], "DDL")
                self.assertEqual(len(details["targets"]), 1)
                self.assertEqual(details["targets"][0]["access_type"], "define")
                self.assertIn('"Connected Schema".', root.sql(dialect="postgres"))
                if "RENAME TO" in statement:
                    self.assertTrue(root.sql(dialect="postgres").endswith('RENAME TO "New; Table"'))
                self.adapter.config["read_only"] = True
                with self.assertRaisesRegex(ValueError, "read-only"):
                    self.adapter._parsed(statement)
                self.adapter.config["read_only"] = False

    def test_cross_schema_server_objects_and_extra_statements_are_rejected(self):
        statements = [
            'ALTER TABLE other."Odd ""Table""" DROP COLUMN body',
            'ALTER TABLE "Odd ""Table""" RENAME TO other.moved',
            'ALTER TABLE "Odd ""Table""" SET SCHEMA other',
            'ALTER TABLE "Odd ""Table""" OWNER TO other',
            'CREATE TEMP TABLE temporary_notes (id INTEGER)',
            'CREATE SCHEMA other',
            'DROP DATABASE shop',
            'DROP TABLE "Odd ""Table"""; CREATE TABLE replacement(id INTEGER)',
            'ALTER TABLE "Odd ""Table""" RENAME TO "ODD ""TABLE"""',
        ]
        for statement in statements:
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                self.adapter._parsed(statement)


if __name__ == "__main__":
    unittest.main()
