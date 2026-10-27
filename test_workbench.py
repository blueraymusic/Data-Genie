"""End-to-end service checks using independent temporary data and repositories."""

from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import workbench as app
from repository import Repository


class WorkbenchTests(unittest.TestCase):
    def test_natural_table_count_and_names_are_answered_without_generated_sql(self):
        questions = ['how many tables do I have and what are their names', 'how many tables do I have, and what are their names?', 'show tables', 'what are the names of my tables', 'count tables']
        with patch.object(app.gemini_provider, 'generate_plans') as generate:
            for question in questions:
                with self.subTest(question=question):
                    result = app.submit_request(self.session_id, question, interpreter='gemini')
                    self.assertTrue(result['matched'])
                    self.assertTrue(result['inventory'])
                    self.assertEqual(result['table_count'], 5)
                    self.assertEqual([row['table_name'] for row in result['rows']], ['accounts','odd table','products','sales','summary'])
                    self.assertNotIn('sql', result)
            generate.assert_not_called()
        self.assertEqual(app.history_for_session(self.session_id), [])

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="genie-service-test-")
        self.root = Path(self.temporary.name)
        self.original_repository = app.REPOSITORY_PATH
        self.original_uploads = app.UPLOAD_DIRECTORY
        self.original_databases = app.DATABASE_DIRECTORY
        app.REPOSITORY_PATH = self.root / "repository.sqlite3"
        app.UPLOAD_DIRECTORY = self.root / "uploads"
        app.DATABASE_DIRECTORY = self.root / "databases"
        self.path = self.root / "shop.sqlite3"
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            connection.executescript("""
                CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
                CREATE TABLE sales(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES products(id),
                    units INTEGER NOT NULL CHECK(units>=0),sale_date TEXT,revenue REAL,note TEXT);
                INSERT INTO products VALUES(1,'Pen');
                INSERT INTO sales VALUES(1,1,2,'2026-01-01',20,'first'),(2,1,2,'2026-01-02',60,'second');
                CREATE TABLE accounts(id INTEGER PRIMARY KEY,balance REAL);
                INSERT INTO accounts VALUES(1,5),(2,9);
                CREATE TABLE summary(id INTEGER PRIMARY KEY,amount REAL);
                INSERT INTO summary VALUES(1,5),(2,9);
                CREATE TABLE "odd table"(id INTEGER PRIMARY KEY,note TEXT);
                INSERT INTO "odd table" VALUES(1,'quote');
            """)
        self.session = app.start_session("Ada", "Lovelace", "ADA@example.com", path=self.path)
        self.session_id = self.session["session_id"]

    def tearDown(self):
        app.REPOSITORY_PATH = self.original_repository
        app.UPLOAD_DIRECTORY = self.original_uploads
        app.DATABASE_DIRECTORY = self.original_databases
        self.temporary.cleanup()

    def ask(self, text, raw_sql=False):
        return app.submit_request(self.session_id, text, raw_sql=raw_sql)

    def confirm(self, command):
        return app.confirm_command(self.session_id, command["command_id"], command["confirmation_token"])

    def rows(self, sql):
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            return connection.execute(sql).fetchall()

    def test_conditional_delete_keeps_filter_and_requires_confirmation(self):
        response = self.ask("delete from sales where id=1")
        self.assertEqual(response["preview"], {"table":"sales", "affected_rows":1})
        self.assertIn('WHERE "id" = 1', response["sql"])
        self.assertEqual(self.rows("SELECT id FROM sales"), [(1,), (2,)])
        self.confirm(response)
        self.assertEqual(self.rows("SELECT id FROM sales"), [(2,)])

    def test_gemini_plan_is_locally_validated_and_runs_reads(self):
        plan = [{"sql": 'SELECT id, name FROM "products"', "summary": "Lists products.", "visualization": "table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan) as generate:
            response = app.submit_request(self.session_id, "list the products", interpreter="gemini")
        self.assertEqual(response["interpreter"], "gemini")
        self.assertEqual(response["rows"], [{"id": 1, "name": "Pen"}])
        supplied_schema = generate.call_args.args[1]
        self.assertEqual(supplied_schema[0]["name"], "accounts")
        self.assertNotIn("rows", supplied_schema[0])

    def test_gemini_writes_still_require_confirmation(self):
        plan = [{"sql": 'DELETE FROM "sales" WHERE "id" = 1', "summary": "Removes the selected sale.", "visualization": "table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan):
            response = app.submit_request(self.session_id, "remove sale 1", interpreter="gemini")
        self.assertTrue(response["requires_confirmation"])
        self.assertEqual(self.rows("SELECT id FROM sales"), [(1,), (2,)])
        self.confirm(response)
        self.assertEqual(self.rows("SELECT id FROM sales"), [(2,)])

    def test_gemini_failure_rejects_without_keyword_fallback(self):
        with patch.object(app.gemini_provider, "generate_plans", side_effect=app.gemini_provider.GeminiError("Gemini unavailable")):
            response = app.submit_request(self.session_id, "count sales", interpreter="gemini")
        self.assertFalse(response["matched"])
        self.assertEqual(response["message"], "Gemini unavailable")
        self.assertEqual(app.get_repository().get_request(response["request_id"])["status"], "rejected")

    def test_ai_placeholder_reads_are_rejected_without_commands_or_results(self):
        for sql in ("SELECT 'visualization' AS label, 1 AS value", "SELECT name AS label, type AS value FROM sqlite_master"):
            plan = [{"sql": sql, "summary": "Placeholder", "visualization": "bar"}]
            with self.subTest(sql=sql), patch.object(app.gemini_provider, "generate_plans", return_value=plan):
                response = app.submit_request(self.session_id, "visualize the database", interpreter="gemini")
            self.assertFalse(response["matched"])
            self.assertTrue(response["needs_clarification"])
            self.assertEqual(app.get_repository().get_request(response["request_id"])["commands"], [])

    def test_ai_clarification_is_saved_without_sql(self):
        with patch.object(app.gemini_provider, "generate_plans", side_effect=app.RequestClarification("Which table would you like to see?")):
            response = app.submit_request(self.session_id, "list the latest sales", interpreter="gemini")
        self.assertTrue(response["needs_clarification"])
        saved = app.get_repository().get_request(response["request_id"])
        self.assertEqual(saved["commands"], [])
        self.assertEqual(saved["error"], "Which table would you like to see?")

    def test_generic_reads_use_the_selected_table_without_guessing(self):
        with patch.object(app.gemini_provider, "generate_plans") as generate:
            response = app.submit_request(self.session_id, "show me the data", interpreter="gemini", selected_table="products")
        self.assertEqual(response["rows"], [{"id":1, "name":"Pen"}])
        generate.assert_not_called()
        ambiguous = self.ask("show me the data")
        self.assertTrue(ambiguous["needs_clarification"])
        self.assertNotIn("sql", ambiguous)

    def test_chart_requests_offer_schema_based_choices_and_run_chosen_group(self):
        response = app.submit_request(self.session_id, "visualize the data", selected_table="products")
        self.assertTrue(response["needs_clarification"])
        self.assertIn('count "products" by name', response["suggestions"])
        self.assertNotIn("sql", response)
        chosen = self.ask('count "products" by name')
        self.assertEqual(chosen["rows"], [{"label":"Pen", "value":1}])
        self.assertEqual(chosen["visualization"], "bar")

    def test_invalid_selected_table_cannot_inject_or_override_explicit_requests(self):
        invalid = app.submit_request(self.session_id, "show me the data", selected_table='products; DROP TABLE sales')
        self.assertFalse(invalid["matched"])
        self.assertEqual(len(self.rows("SELECT * FROM sales")), 2)
        explicit = app.submit_request(self.session_id, "show sales", selected_table="products")
        self.assertEqual(len(explicit["rows"]), 2)

    def test_selected_table_is_included_in_the_ai_context(self):
        plan = [{"sql": "SELECT * FROM sales", "summary":"Lists sales.", "visualization":"table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan) as generate:
            app.submit_request(self.session_id, "list the latest sales", interpreter="gemini", selected_table="products")
        self.assertEqual(generate.call_args.kwargs["selected_table"], "products")

    def test_raw_sql_constants_and_structure_shortcuts_still_work(self):
        self.assertEqual(self.ask("SELECT 1 AS value", raw_sql=True)["rows"], [{"value": 1}])
        with patch.object(app.gemini_provider, "generate_plans") as generate:
            self.assertTrue(app.submit_request(self.session_id, "tables", interpreter="gemini")["metadata"])
            self.assertTrue(app.submit_request(self.session_id, "schema", interpreter="gemini")["metadata"])
        generate.assert_not_called()

    def test_action_words_inside_literals_remain_values(self):
        response = self.ask('insert into sales units=1, note="delete from sales"')
        self.assertTrue(response["sql"].startswith("INSERT"))
        self.confirm(response)
        self.assertEqual(len(self.rows("SELECT id FROM sales")), 3)
        response = self.ask('show sales where note = "drop table sales"')
        self.assertEqual(response["operation"], "read")
        self.assertEqual(response["rows"], [])

    def test_quoted_commas_and_compound_request_preserve_literals(self):
        response = self.ask('create table notes (id INTEGER PRIMARY KEY,body TEXT) then insert into notes body="hello, then goodbye" then show notes')
        self.assertTrue(response["matched"], response)
        self.assertEqual(len(response["commands"]), 3)
        for command in response["commands"]:
            result = self.confirm(command)
        self.assertEqual(result["rows"], [{"id": 1, "body": "hello, then goodbye"}])
        request = app.get_repository().get_request(response["request_id"])
        self.assertEqual(request["status"], "executed")
        self.assertEqual(len([command for command in request["commands"] if command["result"]]), 3)

    def test_reordering_compound_steps_is_blocked(self):
        response = self.ask("create table notes then insert into notes id=1")
        with self.assertRaises(ValueError):
            self.confirm(response["commands"][1])
        self.assertNotIn(("notes",), self.rows("SELECT name FROM sqlite_master"))

    def test_decline_cascades_to_dependent_steps_and_has_no_results(self):
        response = self.ask("create table notes then insert into notes id=1")
        command = response["commands"][0]
        declined = app.decline_command(self.session_id, command["command_id"], command["confirmation_token"])
        self.assertEqual(len(declined["declined_command_ids"]), 2)
        request = app.get_repository().get_request(response["request_id"])
        self.assertEqual(request["status"], "declined")
        self.assertTrue(all(command["result"] is None for command in request["commands"]))

    def test_metadata_reads_do_not_create_requests(self):
        self.assertTrue(self.ask("show tables")["metadata"])
        self.assertTrue(self.ask('show columns from "sales"')["metadata"])
        structure = app.submit_request(self.session_id, "show me the structure of the db", interpreter="gemini")
        self.assertTrue(structure["metadata"])
        self.assertEqual(structure["rows"][0]["table"], "accounts")
        self.assertEqual(structure["rows"][0]["column"], "id")
        app.schema_for_session(self.session_id)
        self.assertEqual(app.history_for_session(self.session_id), [])

    def test_invalid_types_constraints_and_fk_are_rejected_before_writes(self):
        for request in ["insert into sales units=hello", "insert into sales units=-1", "insert into sales units=1,product_id=999", "delete from products where id=1", "insert into sales note=missing_units"]:
            with self.subTest(request=request):
                response = self.ask(request)
                self.assertFalse(response["matched"], response)
                stored = app.get_repository().get_request(response["request_id"])
                self.assertEqual(stored["status"], "rejected")
                self.assertEqual(stored["commands"], [])
        self.assertEqual(len(self.rows("SELECT id FROM sales")), 2)

    def test_numeric_group_and_monthly_average_use_requested_metric(self):
        self.assertEqual(self.ask("compare revenue by units in sales")["rows"], [{"label": 2, "value": 80.0}])
        self.assertEqual(self.ask("average revenue in sales by month")["rows"], [{"period": "2026-01", "total": 40.0}])

    def test_identifier_substrings_do_not_change_intent(self):
        self.assertEqual(len(self.ask("show accounts")["rows"]), 2)
        self.assertEqual(len(self.ask("show summary")["rows"]), 2)

    def test_quoted_table_names_and_selected_columns(self):
        self.assertEqual(len(self.ask('show "sales"')["rows"]), 2)
        self.assertEqual(self.ask('count "odd table"')["rows"], [{"row_count": 1}])
        self.assertEqual(self.ask('show note from "odd table"')["rows"], [{"note": "quote"}])

    def test_fk_join_uses_relationship_and_records_both_targets(self):
        response = self.ask('show "sales" join "products"')
        self.assertTrue(response["matched"], response)
        self.assertEqual(response["rows"][0]["products.name"], "Pen")
        command = app.get_repository().get_command(response["command_id"])
        self.assertEqual({target["table_name"] for target in command["targets"]}, {"sales", "products"})

    def test_literals_comments_and_ctes_are_validated_lexically(self):
        response = self.ask("/* read comment */ SELECT 'update; transaction' AS value; -- tail", raw_sql=True)
        self.assertTrue(response["matched"], response)
        self.assertEqual(response["operation"], "read")
        self.assertEqual(response["rows"], [{"value": "update; transaction"}])
        response = self.ask("WITH target AS (SELECT 1 AS id) DELETE FROM sales WHERE id IN (SELECT id FROM target)", raw_sql=True)
        self.assertEqual(response["operation"], "write")
        self.confirm(response)
        self.assertEqual(self.rows("SELECT id FROM sales"), [(2,)])

    def test_blob_rows_and_result_truncation_are_json_safe(self):
        response = self.ask("SELECT X'000102' AS payload", raw_sql=True)
        json.dumps(response, allow_nan=False)
        self.assertEqual(response["rows"][0]["payload"]["type"], "blob")
        response = self.ask("WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<501) SELECT n FROM nums", raw_sql=True)
        self.assertTrue(response["truncated"])
        self.assertEqual(len(response["rows"]), 500)
        stored = app.get_repository().get_command(response["command_id"])["result"]["payload"]
        self.assertTrue(stored["truncated"])

    def test_history_survives_reopen_and_does_not_rerun(self):
        response = self.ask("count sales")
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            connection.execute("DELETE FROM sales")
        reopened = Repository(app.REPOSITORY_PATH)
        saved = reopened.history(self.session_id)[0]["commands"][0]["result"]["payload"]
        self.assertEqual(saved["rows"], [{"row_count": 2}])
        self.assertEqual(saved["command_id"], response["command_id"])

    def test_confirmation_is_single_use_and_session_bound(self):
        response = self.ask("delete from sales where id=1")
        other = app.start_session("Ada", "Lovelace", "ada@example.com", path=self.path)
        with self.assertRaises(ValueError):
            app.confirm_command(other["session_id"], response["command_id"], response["confirmation_token"])
        self.confirm(response)
        with self.assertRaises(ValueError):
            self.confirm(response)

    def test_switch_preserves_original_file_and_ends_old_session(self):
        pending = self.ask("delete from sales")
        switched = app.connect_upload(self.session_id, "uploaded.sqlite3", self.path.read_bytes())
        self.assertNotEqual(switched["session_id"], self.session_id)
        self.assertNotEqual(switched["path"], str(self.path))
        self.assertIsNotNone(app.get_repository().get_session(self.session_id)["ended_at"])
        with self.assertRaises(ValueError):
            self.confirm(pending)
        self.assertEqual(len(self.rows("SELECT id FROM sales")), 2)
        self.assertEqual(app.get_repository().get_command(pending["command_id"])["status"], "declined")

    def test_failed_upload_keeps_current_session_open(self):
        with self.assertRaises(ValueError):
            app.connect_upload(self.session_id, "bad.sqlite3", b"not a database")
        self.assertIsNone(app.get_repository().get_session(self.session_id)["ended_at"])

    def test_export_includes_committed_wal_rows(self):
        keeper = sqlite3.connect(self.path, factory=app.Conn)
        try:
            keeper.execute("PRAGMA journal_mode=WAL")
            keeper.execute("INSERT INTO accounts VALUES(3,99)")
            keeper.commit()
            destination = app.export_database(self.session_id, self.root / "download.sqlite3")
            with sqlite3.connect(destination, factory=app.Conn) as exported:
                self.assertEqual(exported.execute("SELECT balance FROM accounts WHERE id=3").fetchone()[0], 99)
        finally:
            keeper.close()

    def test_drop_preserves_historical_table_and_column_metadata(self):
        response = self.ask("drop table summary")
        self.confirm(response)
        tables = app.get_repository().get_schema(self.session["database_id"], include_dropped=True)
        dropped = next(table for table in tables if table["name"] == "summary")
        self.assertTrue(dropped["is_dropped"])
        self.assertEqual(len(dropped["columns"]), 2)

    def test_history_cannot_cross_users(self):
        other = app.start_session("Grace", "Hopper", "grace@example.com", path=self.path)
        with self.assertRaises(ValueError):
            app.history_for_session(self.session_id, history_session_id=other["session_id"])

    def test_repository_cannot_be_connected_as_a_data_source(self):
        with self.assertRaises(ValueError):
            app.start_session("Ada", "Lovelace", "ada@example.com", path=app.REPOSITORY_PATH)

    def test_new_database_has_editable_starter_and_context(self):
        created = app.create_database_session("Ada", "Lovelace", "ada@example.com", name="personal")
        self.assertEqual(created["database"], "personal.sqlite3")
        self.assertEqual(created["source"], "created")
        self.assertEqual(created["tables"], ["notes"])
        self.assertEqual(created["table_details"][0]["row_count"], 1)
        response = app.submit_request(created["session_id"], "show notes")
        self.assertEqual(response["rows"][0]["title"], "Welcome to your database")
        response = app.submit_request(created["session_id"], 'update notes set title="My first note" where id=1')
        app.confirm_command(created["session_id"], response["command_id"], response["confirmation_token"])
        self.assertEqual(app.submit_request(created["session_id"], "show notes")["rows"][0]["title"], "My first note")

    def test_empty_database_supports_schema_creation_and_queries(self):
        created = app.create_database_session("Ada", "Lovelace", "ada@example.com", starter=False)
        self.assertEqual(created["tables"], [])
        self.assertEqual(app.submit_request(created["session_id"], "show tables")["rows"], [])
        response = app.submit_request(created["session_id"], "create table tasks (id INTEGER PRIMARY KEY,title TEXT) then insert into tasks title='A task' then show tasks")
        for command in response["commands"]:
            result = app.confirm_command(created["session_id"], command["command_id"], command["confirmation_token"])
        self.assertEqual(result["rows"], [{"id": 1, "title": "A task"}])

    def test_create_does_not_overwrite_an_existing_database(self):
        before = self.path.read_bytes()
        with self.assertRaises(ValueError):
            app.create_database_session("Ada", "Lovelace", "ada@example.com", path=self.path)
        self.assertEqual(self.path.read_bytes(), before)

    def test_create_switch_safely_ends_old_session(self):
        pending = self.ask("delete from sales")
        created = app.create_for_session(self.session_id, "new.sqlite3", starter=False)
        self.assertEqual(created["tables"], [])
        self.assertIsNotNone(app.get_repository().get_session(self.session_id)["ended_at"])
        with self.assertRaises(ValueError):
            self.confirm(pending)

    def test_failed_creation_keeps_current_database_and_does_not_leave_file(self):
        with self.assertRaises(ValueError):
            app.create_for_session(self.session_id, "../outside.sqlite3")
        self.assertIsNone(app.get_repository().get_session(self.session_id)["ended_at"])
        with self.assertRaises(ValueError):
            app.create_database_session("", "", "", name="invalid")
        self.assertEqual(list(app.DATABASE_DIRECTORY.glob("*.sqlite3")), [])

    def test_upload_can_start_first_session_without_demo(self):
        uploaded = app.start_uploaded_session("Ada", "Lovelace", "ada@example.com", "my.sqlite3", self.path.read_bytes())
        self.assertEqual(uploaded["source"], "uploaded")
        self.assertEqual(uploaded["database"], "my.sqlite3")
        self.assertIn("sales", uploaded["tables"])
        self.assertEqual(app.submit_request(uploaded["session_id"], "count sales")["rows"], [{"row_count": 2}])

    def test_status_examples_can_use_actual_schema_and_identify_attached_data(self):
        with app.session_scope(self.session_id):
            status = app.database_info()
        self.assertEqual(status["source"], "attached")
        sales = next(table for table in status["table_details"] if table["name"] == "sales")
        self.assertIn("revenue", [column["name"] for column in sales["columns"]])


if __name__ == "__main__":
    unittest.main()
