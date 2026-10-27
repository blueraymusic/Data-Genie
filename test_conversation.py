"""Conversation scopes, read refinements, and unchanged write confirmation."""

from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import workbench as app
from repository import Repository, RepositoryError


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="genie-conversation-")
        self.root = Path(self.temporary.name)
        self.old_repository = app.REPOSITORY_PATH
        app.REPOSITORY_PATH = self.root / "repository.sqlite3"
        self.path = self.root / "customers.sqlite3"
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            connection.execute("CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,state TEXT,active INTEGER)")
            connection.executemany("INSERT INTO customers VALUES(?,?,?,?)", [
                (index, f"Customer {index:03}", "Iowa" if index in {1,2,65} else "Missouri", 0 if index == 2 else 1)
                for index in range(1, 66)
            ])
        self.session_id = app.start_session("Test", "Reader", "reader@example.test", path=self.path)["session_id"]

    def tearDown(self):
        app.REPOSITORY_PATH = self.old_repository
        self.temporary.cleanup()

    def ask(self, question, **options):
        return app.submit_request(self.session_id, question, selected_table="customers", **options)

    def test_location_followup_preserves_filters_and_reads_beyond_the_preview_cap(self):
        self.assertEqual(len(self.ask("show customers where active=1")["rows"]), 50)
        filtered = self.ask("which ones are in iowa?")
        self.assertTrue(filtered["matched"], filtered)
        self.assertEqual([row["id"] for row in filtered["rows"]], [1,65])
        self.assertEqual(self.ask("count them")["rows"], [{"row_count":2}])

    def test_explicit_limits_still_bound_the_followup(self):
        self.ask("show customers limit 1")
        self.assertEqual(self.ask("how many are there?")["rows"], [{"row_count":1}])

    def test_projection_and_sort_keep_the_previous_filter(self):
        self.ask('show customers where state="Iowa"')
        sorted_rows = self.ask("sort them by name descending")["rows"]
        self.assertEqual([row["id"] for row in sorted_rows], [65,2,1])
        self.assertEqual(self.ask("show their names")["rows"], [{"name":row["name"]} for row in sorted_rows])

    def test_model_context_contains_recent_sql_and_status_without_result_rows(self):
        self.ask('show customers where state="Iowa"')
        plan = [{"sql": 'SELECT COUNT(*) AS row_count FROM customers WHERE state="Iowa"', "summary":"Counts those customers.", "visualization":"table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan) as generate:
            result = self.ask("how many of them?", interpreter="gemini")
        self.assertEqual(result["rows"], [{"row_count":3}])
        context = generate.call_args.kwargs["conversation"]
        self.assertEqual(context[-1]["question"], 'show customers where state="Iowa"')
        self.assertEqual(context[-1]["commands"][0]["status"], "executed")
        serialized = json.dumps(context)
        self.assertNotIn("Customer 001", serialized)
        self.assertNotIn("reader@example.test", serialized)
        self.assertNotIn(str(self.path), serialized)
        self.assertNotIn('"rows"', serialized)

    def test_other_sessions_and_users_do_not_supply_context(self):
        self.ask("show customers")
        other = app.start_session("Other", "Reader", "other@example.test", path=self.path)["session_id"]
        plan = [{"sql":"SELECT * FROM customers", "summary":"Customers.", "visualization":"table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan) as generate:
            app.submit_request(other, "show all customers", interpreter="gemini")
        self.assertEqual(generate.call_args.kwargs["conversation"], [])

    def test_context_is_bounded_and_new_conversation_survives_repository_reload(self):
        for _ in range(10):
            self.ask("show customers")
        repository = app.get_repository()
        self.assertEqual(len(repository.conversation(self.session_id)), 8)
        boundary = app.reset_conversation(self.session_id)["conversation_after"]
        reloaded = Repository(app.REPOSITORY_PATH)
        self.assertEqual(reloaded.get_session(self.session_id)["conversation_after"], boundary)
        self.assertEqual(reloaded.conversation(self.session_id), [])
        self.assertEqual(len(reloaded.history(self.session_id)), 10)
        self.ask("show customers where active=0")
        self.assertEqual(len(reloaded.conversation(self.session_id)), 1)

    def test_oversized_context_is_not_truncated_into_incomplete_sql(self):
        repository = app.get_repository()
        request_id = repository.create_request(self.session_id, "x" * 25000)
        repository.reject_request(request_id, "Please clarify.")
        self.assertEqual(repository.conversation(self.session_id), [])

    def test_writes_in_followups_still_wait_for_confirmation_and_block_reset(self):
        self.ask('show customers where state="Iowa"')
        plan = [{"sql":"DELETE FROM customers WHERE state='Iowa'", "summary":"Deletes the Iowa customers.", "visualization":"table"}]
        with patch.object(app.gemini_provider, "generate_plans", return_value=plan):
            pending = self.ask("delete those customers", interpreter="gemini")
        self.assertTrue(pending["requires_confirmation"])
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0], 65)
        with self.assertRaises(RepositoryError):
            app.reset_conversation(self.session_id)
        app.decline_command(self.session_id, pending["command_id"], pending["confirmation_token"])
        app.reset_conversation(self.session_id)

    def test_single_letter_remains_invalid_but_brief_clarification_can_reach_the_model(self):
        self.ask("show customers")
        with patch.object(app.gemini_provider, "generate_plans", side_effect=app.RequestClarification("Which column?")) as generate:
            rejected = self.ask("e", interpreter="gemini")
            self.assertFalse(rejected["matched"])
            generate.assert_not_called()
            self.ask("Iowa", interpreter="gemini")
            generate.assert_called_once()

    def test_natural_table_structure_request_returns_columns_instead_of_customer_rows(self):
        response = self.ask("show me the structure of the customers table")
        self.assertTrue(response["metadata"])
        self.assertEqual([row["name"] for row in response["rows"]], ["id","name","state","active"])
        self.assertEqual(app.history_for_session(self.session_id), [])
