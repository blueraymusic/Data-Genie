"""Planner contract tests, without making network calls."""

import json
import unittest
from unittest.mock import patch

import gemini_provider
from request_validation import RequestClarification


def model_response(payload):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}


class GeminiPlannerTests(unittest.TestCase):
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
        self.assertEqual([item["role"] for item in contents], ["user","model","user"])
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
