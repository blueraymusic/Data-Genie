"""Repository persistence and lifecycle tests; all databases are temporary."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from repository import Repository, RepositoryError


@contextmanager
def connect(path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "user ? database.sqlite3"
        self.repository_path = Path(self.directory.name) / "repository.sqlite3"
        self.repository = Repository(self.repository_path)
        with connect(self.source) as connection:
            connection.executescript("""
                PRAGMA foreign_keys=ON;
                CREATE TABLE customers (
                    ID INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    region TEXT DEFAULT 'MO'
                );
                CREATE TABLE sales (
                    id INTEGER PRIMARY KEY,
                    customer_id INTEGER REFERENCES customers(id),
                    amount REAL NOT NULL CHECK(amount >= 0)
                );
                INSERT INTO customers(name) VALUES('Ada');
                INSERT INTO sales(customer_id,amount) VALUES(1,12.5);
            """)

    def session(self, email="ada@example.com"):
        return self.repository.start_session("Ada", "Lovelace", email, self.source, "customers.sqlite3")

    def command(self, session, sql="SELECT * FROM sales", kind="SELECT", confirmation=False, operation=None):
        request_id = self.repository.create_request(session["session_id"], sql)
        command = self.repository.add_command(request_id, sql, kind, confirmation,
                                              [{"table_name": "sales", "access_type": "read" if kind == "SELECT" else "write"}],
                                              operation=operation)
        return request_id, command

    def test_initialization_is_lazy_and_repository_is_separate(self):
        self.assertFalse(self.repository_path.exists())
        session = self.session()
        self.assertTrue(self.repository_path.exists())
        self.assertNotEqual(str(self.repository.path), session["path"])
        with self.assertRaises(RepositoryError):
            self.repository.start_session("Ada", "Lovelace", "ada@example.com", self.repository_path, "repository")

    def test_sessions_users_and_databases_persist_and_reuse_identity(self):
        first = self.session()
        second = Repository(self.repository_path).start_session("Ada", "Lovelace", "ADA@example.com", self.source, "customers.sqlite3")
        self.assertNotEqual(first["session_id"], second["session_id"])
        self.assertEqual(first["user_id"], second["user_id"])
        self.assertEqual(first["database_id"], second["database_id"])
        self.assertEqual(len(self.repository.list_sessions("ADA@example.com")), 2)
        self.assertEqual(first["table_count"], 2)
        ended = self.repository.end_session(first["session_id"])
        self.assertIsNotNone(ended["ended_at"])
        self.assertGreaterEqual(ended["duration"], 0)
        with self.assertRaises(RepositoryError):
            self.repository.get_session(first["session_id"], active_only=True)
        self.assertIsNotNone(Repository(self.repository_path).get_session(first["session_id"])["ended_at"])

    def test_uppercase_non_ascii_email_uses_same_normalized_identity(self):
        first = self.session("ÉRIC@EXAMPLE.COM")
        second = self.session("éric@example.com")
        self.assertEqual(first["user_id"], second["user_id"])
        self.assertEqual(len(self.repository.list_sessions("ÉRIC@EXAMPLE.COM")), 2)

    def test_missing_source_is_never_created(self):
        missing = Path(self.directory.name) / "missing.sqlite3"
        with self.assertRaises(sqlite3.Error):
            self.repository.start_session("Ada", "Lovelace", "ada@example.com", missing, "missing")
        self.assertFalse(missing.exists())

    def test_schema_constraints_references_and_derived_counts(self):
        session = self.session()
        schema = {table["name"]: table for table in self.repository.get_schema(session["database_id"])}
        self.assertEqual(schema["customers"]["row_count"], 1)
        name = next(column for column in schema["customers"]["columns"] if column["name"] == "name")
        self.assertEqual(set(name["constraints"]), {"NOT NULL", "UNIQUE"})
        amount = next(column for column in schema["sales"]["columns"] if column["name"] == "amount")
        self.assertIn("CHECK", amount["constraints"])
        reference = schema["sales"]["foreign_keys"][0]
        self.assertEqual(reference["referenced_column_name"], "ID")
        self.assertEqual(reference["referenced_table_id"], schema["customers"]["table_id"])
        self.assertEqual(reference["on_delete"], "NO ACTION")
        with connect(self.source) as connection:
            connection.execute("INSERT INTO customers(name) VALUES('Grace')")
        self.assertEqual(self.repository.get_schema(session["database_id"])[0]["row_count"], 2)

    def test_implicit_composite_foreign_keys_are_resolved(self):
        with connect(self.source) as connection:
            connection.executescript("""
                CREATE TABLE parent(a INTEGER,b INTEGER,PRIMARY KEY(a,b));
                CREATE TABLE child(x INTEGER,y INTEGER,FOREIGN KEY(x,y) REFERENCES parent);
            """)
        session = self.session()
        schema = {table["name"]: table for table in self.repository.get_schema(session["database_id"])}
        self.assertEqual([item["referenced_column_name"] for item in schema["child"]["foreign_keys"]], ["a", "b"])

    def test_dropped_tables_and_columns_survive_with_historical_targets(self):
        session = self.session()
        _, command = self.command(session)
        original_id = command["targets"][0]["table_id"]
        with connect(self.source) as connection:
            connection.execute("DROP TABLE sales")
        self.repository.sync_schema(session["database_id"], self.source)
        old = next(table for table in self.repository.get_schema(session["database_id"], True) if table["name"] == "sales")
        self.assertTrue(old["is_dropped"])
        self.assertEqual(len(old["columns"]), 3)
        self.assertEqual(self.repository.get_command(command["command_id"])["targets"][0]["table_id"], original_id)
        with connect(self.source) as connection:
            connection.execute("CREATE TABLE sales(new_id INTEGER)")
        active = next(table for table in self.repository.sync_schema(session["database_id"], self.source) if table["name"] == "sales")
        self.assertNotEqual(active["table_id"], original_id)
        self.assertEqual(len([table for table in self.repository.get_schema(session["database_id"], True) if table["name"] == "sales"]), 2)

    def test_excluded_tables_are_not_active_metadata(self):
        session = self.session()
        schema = self.repository.sync_schema(session["database_id"], self.source, exclude_tables=("customers",))
        self.assertEqual([table["name"] for table in schema], ["sales"])
        self.assertIsNone(schema[0]["foreign_keys"][0]["referenced_table_id"])
        with self.assertRaises(RepositoryError):
            self.repository.sync_schema(session["database_id"], self.repository_path)

    def test_destructive_confirmation_cannot_be_disabled_or_replayed(self):
        session = self.session()
        request_id, command = self.command(session, "DELETE FROM sales", "DML", False)
        self.assertTrue(command["requires_confirmation"])
        self.assertGreaterEqual(len(command["confirmation_token"]), 32)
        for token in (None, "incorrect"):
            with self.assertRaises(RepositoryError):
                self.repository.claim_command(session["session_id"], command["command_id"], token)
        self.repository.claim_command(session["session_id"], command["command_id"], command["confirmation_token"])
        finished = self.repository.finish_command(command["command_id"], {"rows": [], "changes": 1}, "message")
        self.assertEqual(finished["rows_affected"], 1)
        self.assertEqual(finished["status"], "executed")
        self.assertEqual(self.repository.get_request(request_id)["status"], "executed")
        with self.assertRaises(RepositoryError):
            self.repository.claim_command(session["session_id"], command["command_id"], command["confirmation_token"])
        with self.assertRaises(RepositoryError):
            self.repository.finish_command(command["command_id"], {"changes": 999}, "message")
        with connect(self.repository_path) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM results").fetchone()[0], 1)

    def test_confirmation_is_bound_to_session_and_active_lifecycle(self):
        session = self.session()
        other = self.session("grace@example.com")
        _, command = self.command(session, "UPDATE sales SET amount=0", "DML", True)
        with self.assertRaises(RepositoryError):
            self.repository.claim_command(other["session_id"], command["command_id"], command["confirmation_token"])
        self.repository.end_session(session["session_id"])
        self.assertEqual(self.repository.get_command(command["command_id"])["status"], "declined")
        with self.assertRaises(RepositoryError):
            self.repository.claim_command(session["session_id"], command["command_id"], command["confirmation_token"])
        with self.assertRaises(RepositoryError):
            self.repository.create_request(session["session_id"], "show sales")

    def test_concurrent_claim_allows_exactly_one_executor(self):
        session = self.session()
        _, command = self.command(session)

        def claim(_):
            try:
                return Repository(self.repository_path).claim_command(session["session_id"], command["command_id"])["status"]
            except RepositoryError:
                return "rejected"

        with ThreadPoolExecutor(max_workers=8) as executor:
            outcomes = list(executor.map(claim, range(8)))
        self.assertEqual(outcomes.count("running"), 1)
        self.assertEqual(outcomes.count("rejected"), 7)

    def test_declined_failed_and_rejected_history_has_no_results(self):
        session = self.session()
        declined_id, declined = self.command(session, "DELETE FROM sales", "DML")
        self.repository.decline_command(session["session_id"], declined["command_id"], declined["confirmation_token"])
        self.assertEqual(self.repository.get_request(declined_id)["status"], "declined")
        failed_id, failed = self.command(session)
        self.repository.claim_command(session["session_id"], failed["command_id"])
        self.repository.fail_command(failed["command_id"], "no such table")
        self.assertEqual(self.repository.get_request(failed_id)["status"], "rejected")
        rejected_id = self.repository.create_request(session["session_id"], "unrecognized request")
        self.repository.reject_request(rejected_id, "Try show sales")
        self.assertEqual(self.repository.get_request(rejected_id)["commands"], [])
        history = self.repository.history(session["session_id"])
        self.assertEqual(len(history), 3)
        for request in history:
            for command in request["commands"]:
                self.assertIsNone(command["result"])

    def test_multi_command_create_target_resolves_after_real_creation(self):
        session = self.session()
        request_id = self.repository.create_request(session["session_id"], "make orders and add a row")
        create = self.repository.add_command(request_id, "CREATE TABLE orders(id INTEGER PRIMARY KEY)", "DDL", False,
                                              [{"table_name": "orders", "access_type": "define"}])
        insert = self.repository.add_command(request_id, "INSERT INTO orders VALUES(1)", "DML", False,
                                              [{"table_name": "orders", "access_type": "write"}])
        self.assertIsNone(create["targets"][0]["table_id"])
        self.assertNotIn("orders", [table["name"] for table in self.repository.get_schema(session["database_id"])])
        self.repository.claim_command(session["session_id"], create["command_id"])
        with connect(self.source) as connection:
            connection.execute(create["sql"])
        self.repository.sync_schema(session["database_id"], self.source)
        finished = self.repository.finish_command(create["command_id"], {"changes": 0}, "message")
        self.assertIsNotNone(finished["targets"][0]["table_id"])
        self.assertEqual(self.repository.get_request(request_id)["status"], "pending")
        self.repository.claim_command(session["session_id"], insert["command_id"])
        self.repository.finish_command(insert["command_id"], {"changes": 1}, "message")
        request = self.repository.get_request(request_id)
        self.assertEqual(request["status"], "executed")
        self.assertEqual(request["commands"][0]["targets"][0]["table_id"], request["commands"][1]["targets"][0]["table_id"])

    def test_drop_recreate_records_distinct_table_instances(self):
        session = self.session()
        request_id = self.repository.create_request(session["session_id"], "replace sales")
        commands = [
            self.repository.add_command(request_id, "DROP TABLE sales", "DDL", True,
                                        [{"table_name": "sales", "access_type": "define"}]),
            self.repository.add_command(request_id, "CREATE TABLE SALES(id INTEGER PRIMARY KEY)", "DDL", True,
                                        [{"table_name": "sales", "access_type": "define"}]),
            self.repository.add_command(request_id, "INSERT INTO sales VALUES(1)", "DML", True,
                                        [{"table_name": "sales", "access_type": "write"}]),
        ]
        original_id = commands[0]["targets"][0]["table_id"]
        self.assertIsNone(commands[1]["targets"][0]["table_id"])
        self.assertIsNone(commands[2]["targets"][0]["table_id"])
        for command in commands:
            self.repository.claim_command(session["session_id"], command["command_id"], command["confirmation_token"])
            with connect(self.source) as connection:
                connection.execute(command["sql"])
            if command["kind"] == "DDL":
                self.repository.sync_schema(session["database_id"], self.source)
            self.repository.finish_command(command["command_id"], {"changes": 1}, "message")
        stored = self.repository.get_request(request_id)["commands"]
        new_id = stored[1]["targets"][0]["table_id"]
        self.assertNotEqual(original_id, new_id)
        self.assertEqual(stored[0]["targets"][0]["table_id"], original_id)
        self.assertEqual(stored[2]["targets"][0]["table_id"], new_id)

    def test_ordering_and_partial_decline_preserve_request_outcome(self):
        session = self.session()
        request_id = self.repository.create_request(session["session_id"], "two reads")
        first = self.repository.add_command(request_id, "SELECT * FROM sales", "SELECT", False)
        second = self.repository.add_command(request_id, "SELECT * FROM sales", "SELECT", True)
        with self.assertRaises(RepositoryError):
            self.repository.claim_command(session["session_id"], second["command_id"], second["confirmation_token"])
        self.repository.claim_command(session["session_id"], first["command_id"])
        self.repository.finish_command(first["command_id"], {"rows": []})
        self.repository.decline_command(session["session_id"], second["command_id"], second["confirmation_token"])
        self.assertEqual(self.repository.get_request(request_id)["status"], "declined")

    def test_leading_sql_comments_and_cte_get_real_command_operation(self):
        session = self.session()
        request_id = self.repository.create_request(session["session_id"], "SQL with comments")
        read = self.repository.add_command(request_id, "-- note\n/* another */ SELECT * FROM sales", "SELECT", False)
        update = self.repository.add_command(request_id, "/* prefix */ WITH c AS (SELECT 1) UPDATE sales SET amount=0", "DML", True)
        self.assertEqual(read["operation"], "SELECT")
        self.assertEqual(update["operation"], "UPDATE")

    def test_results_are_json_safe_and_replayable_after_reopening(self):
        session = self.session()
        _, command = self.command(session)
        self.repository.claim_command(session["session_id"], command["command_id"])
        self.repository.finish_command(command["command_id"], {"rows": [{"blob": b"\x00\xff", "nan": float("nan")}], "changes": 0})
        reopened = Repository(self.repository_path)
        payload = reopened.history(session["session_id"])[0]["commands"][0]["result"]["payload"]
        self.assertEqual(payload["rows"][0]["blob"], {"type": "blob", "base64": "AP8="})
        self.assertIsNone(payload["rows"][0]["nan"])
        json.dumps(payload, allow_nan=False)

    def test_history_filters_sql_request_and_command_operation(self):
        session = self.session()
        self.command(session)
        self.command(session, "DELETE FROM sales", "DML")
        other = self.session("other@example.com")
        self.command(other, "DELETE FROM sales", "DML")
        self.assertEqual(len(self.repository.history(session["session_id"], search="delete")), 1)
        self.assertEqual(len(self.repository.history(session["session_id"], operation="DELETE")), 1)
        self.assertEqual(len(self.repository.history(session["session_id"], operation="SELECT")), 1)

    def test_subclasses_and_target_validation_are_transactional(self):
        session = self.session()
        request_id = self.repository.create_request(session["session_id"], "show sales")
        with self.assertRaises(RepositoryError):
            self.repository.add_command(request_id, "DROP TABLE sales", "SELECT", False)
        with self.assertRaises(RepositoryError):
            self.repository.add_command(request_id, "SELECT * FROM unknown", "SELECT", False, [{"table_name": "unknown", "access_type": "read"}])
        self.assertEqual(self.repository.get_request(request_id)["commands"], [])
        command = self.repository.add_command(request_id, "SELECT SUM(amount) FROM sales", "SELECT", False,
                                              [{"table_name": "sales", "access_type": "read"}], has_aggregation=True)
        self.assertTrue(command["has_aggregation"])
        with connect(self.repository_path) as connection:
            connection.execute("PRAGMA foreign_keys=ON")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(connection.execute("SELECT count(*) FROM select_commands").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT count(*) FROM ddl_commands").fetchone()[0], 0)
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("INSERT INTO ddl_commands VALUES(?, 'DROP')", (command["command_id"],))


if __name__ == "__main__":
    unittest.main()
