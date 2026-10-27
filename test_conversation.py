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

    def test_show_more_preserves_filters_and_keeps_saved_results_unchanged(self):
        result = self.ask('show customers where active=1')
        self.assertTrue(result['has_more'])
        page = app.result_page(self.session_id, result['command_id'], 50)
        self.assertEqual(len(page['rows']), 14)
        self.assertTrue(all(row['active'] == 1 for row in page['rows']))
        self.assertFalse(page['has_more'])
        saved = app.get_repository().get_command(result['command_id'])['result']['payload']
        self.assertEqual(len(saved['rows']), 50)
        self.assertEqual(len(app.history_for_session(self.session_id)), 1)

    def test_show_more_respects_explicit_limits_and_cannot_run_writes(self):
        result = self.ask('show customers limit 50')
        self.assertFalse(result['has_more'])
        self.assertEqual(app.result_page(self.session_id, result['command_id'], 50)['rows'], [])
        pending = self.ask('delete from customers where id=1')
        with self.assertRaises(ValueError):
            app.result_page(self.session_id, pending['command_id'])
        self.assertEqual(len(app.result_page(self.session_id, result['command_id'])['rows']), 50)
        for offset in (-1, 1000001, True, '0'):
            with self.assertRaises(ValueError):
                app.result_page(self.session_id, result['command_id'], offset)

    def test_context_uses_executed_query_filters_and_clears_on_new_conversation(self):
        self.ask('show customers where active=1')
        self.ask('which ones are in Iowa?')
        self.ask('how many of them?')
        with app.session_scope(self.session_id):
            context = app.database_info()['conversation_context']
        self.assertEqual(context['tables'], ['customers'])
        self.assertEqual(context['filters'], ['active: 1', 'state: Iowa'])
        app.reset_conversation(self.session_id)
        with app.session_scope(self.session_id):
            self.assertIsNone(app.database_info()['conversation_context'])

    def test_recovery_offers_real_table_choices_without_executing_commands(self):
        result = self.ask('do something nice')
        self.assertFalse(result['matched'])
        self.assertEqual(result['choices'][0], {'label':'Preview rows', 'request':'show "customers"'})
        self.assertEqual(app.get_repository().get_request(result['request_id'])['commands'], [])

    def test_created_table_and_assistant_reply_are_available_to_schema_followups(self):
        create = app.submit_request(self.session_id, 'CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, department TEXT)', raw_sql=True)
        app.confirm_command(self.session_id, create['command_id'], create['confirmation_token'])
        with app.session_scope(self.session_id):
            self.assertEqual(app.database_info()['conversation_context']['tables'], ['employees'])
        plans = [{'sql':'ALTER TABLE employees ADD COLUMN salary NUMERIC','summary':'Add a numeric salary column to employees.','visualization':'table'}]
        with patch.object(app.gemini_provider, 'generate_plans', return_value=plans) as generate:
            result = app.submit_request(self.session_id, 'add a salary attribute to it', interpreter='gemini', selected_table='employees')
        self.assertTrue(result['requires_confirmation'])
        previous = generate.call_args.kwargs['conversation'][-1]['commands'][0]
        self.assertEqual(previous['operation'], 'CREATE')
        self.assertEqual(previous['result']['message'], 'Created table employees.')
        self.assertEqual(previous['targets'], [{'table_name':'employees','access_type':'define'}])
        with app.session_scope(self.session_id):
            self.assertNotIn('salary', [column['name'] for column in app.table_schema('employees')['columns']])
        done = app.confirm_command(self.session_id, result['command_id'], result['confirmation_token'])
        self.assertEqual(done['answer'], plans[0]['summary'])
        reloaded = Repository(app.REPOSITORY_PATH)
        self.assertEqual(reloaded.conversation(self.session_id)[-1]['commands'][0]['summary'], plans[0]['summary'])
        with app.session_scope(self.session_id):
            self.assertIn('salary', [column['name'] for column in app.table_schema('employees')['columns']])

    def test_declined_schema_changes_do_not_become_conversation_context(self):
        self.ask('show customers where state="Iowa"')
        create = app.submit_request(self.session_id, 'CREATE TABLE employees(id INTEGER)', raw_sql=True)
        app.decline_command(self.session_id, create['command_id'], create['confirmation_token'])
        with app.session_scope(self.session_id):
            context = app.database_info()['conversation_context']
        self.assertEqual(context['tables'], ['customers'])
        self.assertEqual(context['filters'], ['state: Iowa'])

    def test_retryable_planner_error_offers_the_original_request_without_commands(self):
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=app.gemini_provider.GeminiError('Gemini could not be reached right now.', retryable=True)):
            result = self.ask('show the latest customers', interpreter='gemini')
        self.assertEqual(result['choices'], [{'label':'Try again','request':'show the latest customers'}])
        self.assertEqual(app.get_repository().get_request(result['request_id'])['commands'], [])

    def test_sample_data_intent_survives_clarifications_reload_and_numeric_reply(self):
        choices = [{'label':'5 rows','request':'5'}, {'label':'10 rows','request':'10'}]
        goal = 'Generate sample customers with integer IDs, leaving existing rows unchanged.'
        first = app.RequestClarification('How many sample rows should I add?', choices=choices, intent=goal)
        narrowed = app.RequestClarification('How many sample customers should I add?', choices=choices, intent=goal)
        plan = [{'sql':"INSERT INTO customers(name,state,active) VALUES ('Sample 1','Iowa',1),('Sample 2','Iowa',1),('Sample 3','Iowa',1),('Sample 4','Iowa',1),('Sample 5','Iowa',1)", 'summary':'Add five sample customers with automatic integer IDs.', 'visualization':'table'}]
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=[first,narrowed,plan]) as generate:
            start = self.ask('add random values to the existing tables', interpreter='gemini')
            self.assertEqual(start['choices'], choices)
            self.assertEqual(start['intent'], goal)
            # Reload both storage and the UI history before supplying short answers.
            restored = Repository(app.REPOSITORY_PATH).history(self.session_id)[0]
            self.assertEqual(restored['choices'], choices)
            self.assertTrue(restored['needs_clarification'])
            self.assertEqual(restored['task'], 'add random values to the existing tables')
            self.assertEqual(app.history_for_session(self.session_id)[0]['choices'], choices)
            self.ask('ints', interpreter='gemini')
            pending = self.ask('5', interpreter='gemini')
        self.assertTrue(pending['requires_confirmation'])
        self.assertEqual(generate.call_args.kwargs['conversation'][-1]['intent'], goal)
        self.assertEqual(generate.call_args.kwargs['conversation'][-1]['choices'], choices)
        self.assertEqual(generate.call_args.kwargs['conversation'][-1]['task'], 'add random values to the existing tables')
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM customers').fetchone()[0], 65)
        app.confirm_command(self.session_id, pending['command_id'], pending['confirmation_token'])
        with sqlite3.connect(self.path, factory=app.Conn) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM customers').fetchone()[0], 70)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM customers WHERE id<=65').fetchone()[0], 65)
        self.assertEqual(app.get_repository().pending_intent(self.session_id), '')

    def test_explicit_new_goal_replaces_the_original_task_and_survives_the_chat_window(self):
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=app.RequestClarification('How many?', intent='Generate sample customers.')):
            self.ask('generate random customer rows', interpreter='gemini')
        replacement = 'create a table for invoices'
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=app.RequestClarification('Which columns?', intent='Create an invoices table.', continues_task=False)):
            self.assertEqual(self.ask(replacement, interpreter='gemini')['task'], replacement)
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=app.RequestClarification('Which type?', intent='Create an invoices table.', continues_task=True)):
            for _ in range(10):
                self.assertEqual(self.ask('with descriptions', interpreter='gemini')['task'], replacement)
        turns = Repository(app.REPOSITORY_PATH).conversation(self.session_id)
        self.assertEqual(len(turns), 8)
        self.assertEqual(app.pending_task(turns), replacement)

    def test_numeric_answer_without_a_clarification_and_single_letters_are_rejected(self):
        self.ask('show customers')
        with patch.object(app.gemini_provider, 'generate_plans') as generate:
            self.assertFalse(self.ask('5', interpreter='gemini')['matched'])
            self.assertFalse(self.ask('e', interpreter='gemini')['matched'])
        generate.assert_not_called()

    def test_new_conversation_clears_the_pending_goal_and_clarification_buttons(self):
        with patch.object(app.gemini_provider, 'generate_plans', side_effect=app.RequestClarification('How many?', choices=[{'label':'5 rows','request':'5'}], intent='Generate sample customers.')):
            self.ask('generate random customer rows', interpreter='gemini')
        with app.session_scope(self.session_id):
            self.assertEqual(app.database_info()['pending_intent'], 'Generate sample customers.')
        app.reset_conversation(self.session_id)
        with app.session_scope(self.session_id):
            self.assertEqual(app.database_info()['pending_intent'], '')
