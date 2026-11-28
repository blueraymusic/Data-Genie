import json
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from wsgiref.util import setup_testing_defaults

from backend import help_faq
from backend.authentication import TooManyAttempts
from backend.repository import Repository
from backend.wsgi import application


class HelpFaqTests(TestCase):
    def setUp(self):
        temp = self.enterContext(TemporaryDirectory())
        path = Path(temp)
        catalog = path / "help-faq.json"
        catalog.write_text(json.dumps([
            {"id": "faq-answer-create-account", "question": "How do I sign up?", "search": "Create an account."},
        ]))
        self.enterContext(patch.object(help_faq, "CATALOG", catalog))
        self.enterContext(patch.object(help_faq.settings, "public_url", return_value=""))
        self.enterContext(patch.object(help_faq.workbench, "get_repository", return_value=Repository(path / "state.sqlite")))
        self.config = self.enterContext(patch.object(help_faq.settings, "gemini_settings", return_value={
            "api_key": "test-only", "model": "test-model",
        }))
        self.provider = self.enterContext(patch.object(help_faq.gemini_provider, "_request_json"))
        self.provider.return_value = {
            "candidates": [{"content": {"parts": [{"text": '{"matches":[true,1,76]}'}]}}],
        }

    def request(self, question, origin="http://localhost"):
        body = json.dumps({"question": question}).encode()
        environ = {}
        setup_testing_defaults(environ)
        environ.update({
            "PATH_INFO": "/api/help/faq", "REQUEST_METHOD": "POST",
            "HTTP_HOST": "localhost", "HTTP_ORIGIN": origin,
            "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": str(len(body)),
            "wsgi.input": BytesIO(body),
        })
        result = []
        payload = b"".join(application(environ, lambda status, headers: result.append(status)))
        return int(result[0].split()[0]), json.loads(payload)

    def test_anonymous_request_selects_only_real_faq_entries(self):
        status, payload = self.request("I am new here and need to register.")
        self.assertEqual((status, payload), (200, {"matches": ["faq-answer-create-account"]}))
        args, kwargs = self.provider.call_args
        self.assertEqual(kwargs["attempts"], 1)
        request_data = json.loads(args[2]["contents"][0]["parts"][0]["text"])
        self.assertEqual(set(request_data), {"faq", "question"})
        self.assertEqual(request_data["faq"][0]["number"], 1)

    def test_offline_and_sensitive_questions_use_the_local_fallback(self):
        self.assertEqual(self.request("Use postgresql://user:secret@example.test/db")[1], {"matches": []})
        self.config.return_value["api_key"] = ""
        self.assertEqual(self.request("How can a new user join?")[1], {"matches": []})
        self.provider.assert_not_called()

    def test_cross_origin_and_oversized_questions_never_reach_gemini(self):
        self.assertEqual(self.request("help", "https://elsewhere.example")[0], 403)
        self.assertEqual(self.request("a" * 281)[0], 400)
        self.provider.assert_not_called()

    def test_provider_failure_returns_no_matches_and_lookup_is_rate_limited(self):
        self.provider.side_effect = help_faq.gemini_provider.GeminiError("Unavailable")
        for _ in range(5):
            self.assertEqual(help_faq.match("How do I join?", "127.0.0.1"), [])
        with self.assertRaises(TooManyAttempts):
            help_faq.match("How do I join?", "127.0.0.1")
        self.assertEqual(self.provider.call_count, 5)
