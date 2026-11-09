"""Schema questions use scoped introspection without generated SQL or a live DB."""

from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from backend import keywords, workbench
from backend.workspaces import WorkspaceStore


class MetadataQuestionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="genie-metadata-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        repository_patch = patch.object(workbench, "REPOSITORY_PATH", self.root / "repository.sqlite3")
        repository_patch.start()
        self.addCleanup(repository_patch.stop)
        self.path = self.root / "customers.sqlite3"
        with sqlite3.connect(self.path, factory=workbench.Conn) as connection:
            connection.executescript('''
                CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, email TEXT, state TEXT);
                CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER);
                CREATE TABLE "odd table"(id INTEGER PRIMARY KEY, description TEXT, amount REAL);
                INSERT INTO customers VALUES(1, 'column count', 'customer@example.test', 'Iowa');
            ''')
        self.session = workbench.start_session("Metadata", "Fixture", "metadata@example.test", path=self.path)
        self.session_id = self.session["session_id"]

    def ask(self, question, **kwargs):
        return workbench.submit_request(self.session_id, question, interpreter="gemini", **kwargs)

    def test_column_counts_and_whole_database_total_use_real_schema_without_ai(self):
        questions = [
            "Show column count for all tables", "number of attributes per table",
            "list the number of fields for each table", "How many columns are in this database?",
            "count columns across all tables", "What is the total number of columns in the database?",
            "How many columns does the database have?",
        ]
        expected = [
            {"table_name": "customers", "column_count": 4},
            {"table_name": "odd table", "column_count": 3},
            {"table_name": "orders", "column_count": 2},
        ]
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            for question in questions:
                with self.subTest(question=question):
                    result = self.ask(question)
                    self.assertTrue(result["matched"], result)
                    self.assertTrue(result["metadata"])
                    self.assertEqual(result["rows"], expected)
                    self.assertEqual(result["total_column_count"], 9)
                    self.assertIn("9 columns across 3 tables", result["answer"])
                    self.assertNotIn("sql", result)
                    self.assertNotIn("request_id", result)
            generate.assert_not_called()
        self.assertEqual(workbench.history_for_session(self.session_id), [])

    def test_single_table_counts_and_quoted_names_never_count_records(self):
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            for question in ["How many columns does customers have?", "Show field count for customers", "count attributes in customers", "What is the column count of table customers?"]:
                with self.subTest(question=question):
                    result = self.ask(question)
                    self.assertEqual(result["rows"], [{"table_name": "customers", "column_count": 4}])
                    self.assertEqual(result["total_column_count"], 4)
                    self.assertEqual(result["answer"], "customers has 4 columns.")
            result = self.ask('How many columns does "odd table" have?')
            self.assertEqual(result["rows"], [{"table_name": "odd table", "column_count": 3}])
            generate.assert_not_called()

    def test_ambiguous_count_clarifies_and_its_suggestion_succeeds(self):
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            result = self.ask("column count")
            self.assertTrue(result["needs_clarification"])
            self.assertNotIn("sql", result)
            self.assertEqual(result["choices"][0]["request"], "Show column count for all tables")
            chosen = self.ask(result["choices"][0]["request"])
            self.assertEqual(chosen["total_column_count"], 9)
            selected = self.ask("column count", selected_table="orders")
            self.assertEqual(selected["total_column_count"], 2)
            generate.assert_not_called()

    def test_missing_table_clarifies_with_schema_count_choices_without_ai(self):
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            for question in ["How many columns does missing have?", "show columns from missing"]:
                with self.subTest(question=question):
                    result = self.ask(question)
                    self.assertFalse(result["matched"])
                    self.assertTrue(result["needs_clarification"])
                    self.assertTrue(result["choices"])
                    saved = workbench.get_repository().get_request(result["request_id"])
                    self.assertEqual(saved["commands"], [])
            generate.assert_not_called()

    def test_empty_database_returns_an_honest_zero(self):
        path = self.root / "empty.sqlite3"
        with sqlite3.connect(path, factory=workbench.Conn) as connection:
            connection.execute("PRAGMA user_version=1")
        session = workbench.start_session("Empty", "Fixture", "empty@example.test", path=path)
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            result = workbench.submit_request(session["session_id"], "Show column count for all tables", interpreter="gemini")
            self.assertEqual(result["rows"], [])
            self.assertEqual(result["total_column_count"], 0)
            self.assertEqual(result["table_count"], 0)
            generate.assert_not_called()

    def test_postgres_metadata_uses_only_the_connectors_scoped_schema(self):
        def column(name):
            return {"name": name, "type": "text", "primary_key": False, "not_null": False, "default": None}

        adapter = Mock()
        adapter.config = {"schema_name": "tenant_shop", "read_only": True}
        adapter.schema.return_value = [
            {"name": "customers", "columns": [column("id"), column("name"), column("state")], "foreign_keys": []},
            {"name": "orders", "columns": [column("id"), column("customer_id")], "foreign_keys": []},
        ]
        repository = workbench.get_repository()
        external_session = {**self.session, "connection_id": "isolated-postgres-fixture"}
        with patch.object(repository, "get_session", return_value=external_session), \
                patch.object(workbench, "_saved_postgres_config", return_value=adapter.config), \
                patch.object(workbench, "PostgresConnector", return_value=adapter), \
                patch.object(workbench, "db", side_effect=AssertionError("PostgreSQL metadata must not query SQLite")), \
                patch.object(workbench.gemini_provider, "generate_plans") as generate:
            result = self.ask("Show column count for all tables")
            self.assertEqual(result["rows"], [{"table_name": "customers", "column_count": 3}, {"table_name": "orders", "column_count": 2}])
            self.assertEqual(result["total_column_count"], 5)
            self.assertEqual(self.ask("What tables are in my database?")["table_count"], 2)
            self.assertEqual(len(self.ask("show columns for all tables")["rows"]), 5)
            self.assertEqual(self.ask("show columns from customers")["rows"][1]["name"], "name")
            generate.assert_not_called()
            adapter.execute.assert_not_called()
            adapter.prepare_batch.assert_not_called()
        self.assertEqual(workbench.history_for_session(self.session_id), [])

    def test_revoked_read_grant_blocks_metadata_before_introspection(self):
        repository = workbench.get_repository()
        store = WorkspaceStore(repository)
        with repository._connection(write=True) as connection:
            owner, member = [connection.execute(
                "INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES('Test','User',?,'!test',?)",
                (email, int(time.time())),
            ).lastrowid for email in ("owner@example.test", "member@example.test")]
        owner_session = workbench.start_session("Owner", "Fixture", "owner@example.test", path=self.path, account_id=owner)
        workspace = store.create_workspace(owner, "Metadata fixture")["workspace_id"]
        store.attach_database(owner, workspace, owner_session["database_id"])
        invitation = store.invite(owner, workspace, "member@example.test", "member")
        store.accept_invitation(member, invitation["invitation_id"], invitation["token"])
        store.set_grant(owner, workspace, member, owner_session["database_id"], {"read": True})
        session = store.open_database(member, workspace, owner_session["database_id"])
        result = workbench.submit_request(session["session_id"], "Show column count for all tables")
        self.assertEqual(result["total_column_count"], 9)
        store.set_grant(owner, workspace, member, owner_session["database_id"], {})
        with patch.object(workbench, "table_schema") as schema, patch.object(workbench.gemini_provider, "generate_plans") as generate:
            with self.assertRaises(PermissionError):
                workbench.submit_request(session["session_id"], "Show column count for all tables")
            schema.assert_not_called()
            generate.assert_not_called()

    def test_metadata_grammar_does_not_swallow_data_queries_or_gibberish(self):
        for question in ["e", "show customers", 'show customers where name = "column count"', "count orders", "show count from customers"]:
            with self.subTest(question=question):
                self.assertIsNone(keywords.column_count_request(question))
        with patch.object(workbench.gemini_provider, "generate_plans") as generate:
            result = self.ask("e")
            self.assertTrue(result["needs_clarification"])
            self.assertNotIn("sql", result)
            generate.assert_not_called()
        result = workbench.submit_request(self.session_id, "SELECT count(*) AS total FROM customers", raw_sql=True)
        self.assertEqual(result["rows"], [{"total": 1}])
        self.assertNotIn("metadata", result)


if __name__ == "__main__":
    unittest.main()
