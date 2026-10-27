"""Planner contract tests, without making network calls."""

import json
import io
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import gemini_provider
from request_validation import RequestClarification


def model_response(payload):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}


class GeminiPlannerTests(unittest.TestCase):
    def test_original_request_anchors_legacy_clarification_history(self):
        original = 'add random values to all the attributes in all the existing tables'
        turns = [{'question': question, 'clarification': 'Please provide exact values.', 'status': 'rejected', 'commands': []}
                 for question in (original, 'ints', 'customers id', 'in the customers table')]
        response = model_response({'status': 'needs_clarification', 'clarification': 'How many rows?',
                                   'intent': 'Generate sample customer IDs.', 'continues_task': True, 'choices': [], 'commands': []})
        with patch.object(gemini_provider, '_request_json', return_value=response) as outgoing:
            with self.assertRaises(RequestClarification) as caught:
                gemini_provider.generate_plans('in the id attribute', [], 'test-key', 'test-model', conversation=turns)
        context = json.loads(outgoing.call_args.args[2]['contents'][-1]['parts'][1]['text'])['database_context']
        self.assertEqual(context['task']['original_request'], original)
        self.assertTrue(caught.exception.continues_task)
        self.assertEqual(len(context['history']), 4)

    def test_clarification_preserves_the_goal_and_relevant_choices(self):
        response = model_response({'status':'needs_clarification', 'clarification':'How many sample customers should I add?', 'intent':'Generate random customers with integer IDs.', 'choices':[{'label':'5 rows','request':'5'}], 'commands':[]})
        with patch.object(gemini_provider, '_request_json', return_value=response):
            with self.assertRaises(RequestClarification) as caught:
                gemini_provider.generate_plans('add random customer data', [], 'test-key', 'test-model')
        self.assertEqual(caught.exception.intent, 'Generate random customers with integer IDs.')
        self.assertEqual(caught.exception.choices, [{'label':'5 rows','request':'5'}])

    def test_numeric_reply_uses_the_original_sample_task_and_not_a_new_request(self):
        turns = [{'question':'ints', 'status':'rejected', 'commands':[], 'clarification':'How many rows?', 'needs_clarification':True, 'intent':'Generate random customers with integer IDs.', 'choices':[{'label':'5 rows','request':'5'}]}]
        plan = [{'sql':"INSERT INTO customers(name) VALUES ('Sample customer')", 'summary':'Prepare a sample customer.', 'visualization':'table'}]
        with patch.object(gemini_provider, '_request_json', return_value=model_response({'status':'ready','clarification':'','intent':'','choices':[],'commands':plan})) as outgoing:
            self.assertEqual(gemini_provider.generate_plans('5', [], 'test-key', 'test-model', conversation=turns), plan)
            contents = outgoing.call_args.args[2]['contents']
            context = json.loads(contents[-1]['parts'][1]['text'])['database_context']
            self.assertEqual(context['history'][-1]['intent'], 'Generate random customers with integer IDs.')
            self.assertEqual(contents[-1]['parts'][0]['text'], '5')
            with self.assertRaises(RequestClarification):
                gemini_provider.generate_plans('e', [], 'test-key', 'test-model', conversation=turns)

    def test_transient_provider_failure_is_retried_once(self):
        busy = HTTPError('https://example.test', 503, 'busy', {}, io.BytesIO(b'private provider details'))
        success = io.BytesIO(json.dumps({'candidates':[]}).encode())
        with patch.object(gemini_provider.request, 'urlopen', side_effect=[busy,success]) as outgoing, patch.object(gemini_provider.time, 'sleep') as wait:
            self.assertEqual(gemini_provider._request_json('https://example.test', 'private-test-key', {}), {'candidates':[]})
        self.assertEqual(outgoing.call_count, 2)
        wait.assert_called_once()

    def test_configuration_errors_are_not_retried_or_exposed(self):
        for status in (400,401,403,404):
            fault = HTTPError('https://example.test/private-test-key', status, 'private provider details', {}, io.BytesIO(b'private-test-key'))
            with self.subTest(status=status), patch.object(gemini_provider.request, 'urlopen', side_effect=fault) as outgoing, patch.object(gemini_provider.time, 'sleep') as wait:
                with self.assertRaises(gemini_provider.GeminiError) as caught:
                    gemini_provider._request_json('https://example.test', 'private-test-key', {})
                self.assertNotIn('private', str(caught.exception))
                self.assertFalse(caught.exception.retryable)
                outgoing.assert_called_once()
                wait.assert_not_called()

    def test_persistent_network_failure_has_a_bounded_retry(self):
        with patch.object(gemini_provider.request, 'urlopen', side_effect=URLError('private connection details')) as outgoing, patch.object(gemini_provider.time, 'sleep') as wait:
            with self.assertRaises(gemini_provider.GeminiError) as caught:
                gemini_provider._request_json('https://example.test', 'private-test-key', {})
        self.assertTrue(caught.exception.retryable)
        self.assertNotIn('private', str(caught.exception))
        self.assertEqual(outgoing.call_count, 2)
        wait.assert_called_once()

    def test_chat_includes_assistant_reply_and_schema_outcome_without_record_payloads(self):
        plans = [{'sql':'ALTER TABLE employees ADD COLUMN salary NUMERIC', 'summary':'Add salary to employees.', 'visualization':'table'}]
        turns = [{'question':'create another table called employees', 'status':'executed', 'commands':[{
            'sql':'CREATE TABLE employees(id INTEGER PRIMARY KEY)', 'operation':'CREATE', 'status':'executed', 'tables':['employees'],
            'summary':'Create the employees table.', 'result':{'type':'message','message':'Created table employees.','rows':[{'private':'never sent'}]},
        }]}]
        with patch.object(gemini_provider, '_request_json', return_value=model_response({'status':'ready','clarification':'','commands':plans})) as outgoing:
            gemini_provider.generate_plans('add a salary attribute to it', [], 'test-key', 'test-model', conversation=turns)
        body = outgoing.call_args.args[2]
        self.assertEqual([turn['role'] for turn in body['contents']], ['user'])
        chat = json.dumps(body['contents'])
        self.assertIn('Create the employees table.', chat)
        self.assertIn('Created table employees.', chat)
        self.assertNotIn('private', chat)
        self.assertNotIn('rows', chat)
        self.assertEqual(json.loads(body['contents'][-1]['parts'][1]['text'])['database_context']['schema'], [])

    def test_schema_and_chat_do_not_get_appended_to_the_planner_instructions(self):
        response = model_response({'status':'needs_clarification','clarification':'Which field?', 'intent':'Explore a table.','choices':[],'commands':[]})
        bodies = []
        with patch.object(gemini_provider, '_request_json', side_effect=lambda url,key,body: bodies.append(body) or response):
            for name in ('customers','project_specific_schema'):
                with self.assertRaises(RequestClarification):
                    gemini_provider.generate_plans('show me something', [{'name':name,'columns':[]}], 'test-key','test-model', selected_table=name)
        self.assertEqual(bodies[0]['systemInstruction'], bodies[1]['systemInstruction'])
        self.assertNotIn('project_specific_schema', bodies[1]['systemInstruction']['parts'][0]['text'])
        context = json.loads(bodies[1]['contents'][-1]['parts'][1]['text'])['database_context']
        self.assertEqual(context['selected_table'], 'project_specific_schema')
        self.assertEqual(context['schema'][0]['name'], 'project_specific_schema')

    def test_incomplete_input_never_reaches_the_provider(self):
        with patch.object(gemini_provider, "_request_json") as outgoing:
            for question in ("e", "?", "show", "123", "! !"):
                with self.subTest(question=question), self.assertRaises(RequestClarification):
                    gemini_provider.generate_plans(question, [], "test-key", "test-model")
        outgoing.assert_not_called()

    def test_model_can_ask_for_detail_without_sql(self):
        response = model_response({
            "status": "needs_clarification", "commands": [],
            "clarification": "Which table would you like to see?",
        })
        with patch.object(gemini_provider, "_request_json", return_value=response) as outgoing:
            with self.assertRaisesRegex(RequestClarification, "Which table"):
                gemini_provider.generate_plans("show me the data", [], "test-key", "test-model")
        body = outgoing.call_args.args[2]
        self.assertIn("needs_clarification", body["generationConfig"]["responseSchema"]["properties"]["status"]["enum"])

    def test_valid_database_plan_is_preserved(self):
        commands = [{"sql": "SELECT * FROM customers", "summary": "Lists customers.", "visualization": "table"}]
        with patch.object(gemini_provider, "_request_json", return_value=model_response({
            "status": "ready", "clarification": "", "commands": commands,
        })):
            self.assertEqual(gemini_provider.generate_plans("show customers", [], "test-key", "test-model"), commands)

    def test_inconsistent_or_malformed_model_responses_fail_closed(self):
        commands = [{"sql": "SELECT 1", "summary": "Placeholder", "visualization": "table"}]
        for payload in (
            {"commands": commands},
            {"status": "needs_clarification", "clarification": "More detail?", "commands": commands},
            {"status": "ready", "clarification": "", "commands": []},
            {"status": "needs_clarification", "clarification": "", "commands": []},
        ):
            with self.subTest(payload=payload), patch.object(gemini_provider, "_request_json", return_value=model_response(payload)):
                with self.assertRaises(gemini_provider.GeminiError):
                    gemini_provider.generate_plans("show me something", [], "test-key", "test-model")

    def test_conversation_turns_are_sent_in_order_with_only_planning_facts(self):
        response = model_response({"status":"ready", "clarification":"", "commands":[{"sql":"SELECT * FROM customers WHERE state='Iowa'", "summary":"Iowa customers.", "visualization":"table"}]})
        conversation = [{"request_id":1, "question":"show customers", "status":"executed", "rows":[{"private":"not for the model"}], "commands":[{"sql":"SELECT * FROM customers LIMIT 50", "operation":"SELECT", "status":"executed", "tables":["customers"], "payload":{"private":"not for the model"}}]}]
        with patch.object(gemini_provider, "_request_json", return_value=response) as outgoing:
            gemini_provider.generate_plans("which ones are in Iowa?", [], "test-key", "test-model", conversation=conversation)
        contents = outgoing.call_args.args[2]["contents"]
        self.assertEqual([item["role"] for item in contents], ["user"])
        self.assertEqual(contents[-1]["parts"][0]["text"], "which ones are in Iowa?")
        self.assertNotIn("private", json.dumps(contents))

    def test_brief_contextual_answer_is_allowed_without_allowing_single_letters(self):
        response = model_response({"status":"needs_clarification", "clarification":"Which table?", "commands":[]})
        turns = [{"question":"show me the data", "status":"rejected", "commands":[], "clarification":"Which state?"}]
        with patch.object(gemini_provider, "_request_json", return_value=response) as outgoing:
            with self.assertRaises(RequestClarification):
                gemini_provider.generate_plans("Iowa", [], "test-key", "test-model", conversation=turns)
            outgoing.assert_called_once()
            with self.assertRaises(RequestClarification):
                gemini_provider.generate_plans("e", [], "test-key", "test-model", conversation=turns)
            outgoing.assert_called_once()
