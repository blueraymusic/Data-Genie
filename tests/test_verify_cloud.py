"""Check real deployment resources, including HTML references that can be stale."""
from io import BytesIO, StringIO
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import verify_cloud


ORIGIN = "https://genie.example.test"


class Response(BytesIO):
    def __init__(self, url, body, content_type):
        super().__init__(body)
        self.url = url
        self.headers = {"Content-Type": content_type}
        self.status = 200

    def geturl(self):
        return self.url


class DeploymentVerificationTests(unittest.TestCase):
    def resources(self):
        return {
            "/": (b'<html><script type="module" src="/assets/app.js"></script>'
                   b'<link rel="stylesheet" href="/assets/app.css"></html>', "text/html; charset=utf-8"),
            "/assets/app.js": (b"console.log('ready');", "text/javascript"),
            "/assets/app.css": (b"body { color: navy; }", "text/css"),
            "/healthz": (b'{"status":"ok"}', "application/json"),
            "/api/auth/session": (b'{"user":null}', "application/json; charset=utf-8"),
        }

    def fetch(self, resources):
        def open_response(url, **kwargs):
            if not url.startswith(ORIGIN + "/"):
                self.fail("The verifier must not fetch third-party resources.")
            path = url[len(ORIGIN):]
            if path not in resources:
                raise HTTPError(url, 404, "Not found", {}, None)
            body, content_type = resources[path]
            return Response(url, body, content_type)
        return open_response

    def test_success_fetches_javascript_stylesheet_liveness_and_durable_session(self):
        with patch.object(verify_cloud, "urlopen", side_effect=self.fetch(self.resources())) as request, \
                patch("sys.stdout", new_callable=StringIO) as output:
            verify_cloud.main(ORIGIN + "/")
        self.assertEqual({call.args[0] for call in request.call_args_list},
                         {ORIGIN + path for path in self.resources()})
        self.assertIn("frontend assets, liveness and cloud-backed session", output.getvalue())

    def test_missing_script_fails_before_waking_sql(self):
        resources = self.resources()
        del resources["/assets/app.js"]
        with patch.object(verify_cloud, "urlopen", side_effect=self.fetch(resources)) as request, \
                self.assertRaises(HTTPError):
            verify_cloud.check_deployment(ORIGIN)
        self.assertNotIn(ORIGIN + "/api/auth/session", [call.args[0] for call in request.call_args_list])

    def test_google_font_stylesheet_is_optional_and_never_replaces_build_css(self):
        for has_build_css in (True, False):
            resources = self.resources()
            html = resources["/"][0]
            if not has_build_css:
                html = html.replace(b'<link rel="stylesheet" href="/assets/app.css">', b"")
            resources["/"] = (html + b'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader&amp;display=swap">', "text/html")
            with self.subTest(has_build_css=has_build_css), \
                    patch.object(verify_cloud, "urlopen", side_effect=self.fetch(resources)) as request:
                if has_build_css:
                    verify_cloud.check_deployment(ORIGIN)
                else:
                    with self.assertRaises(ValueError):
                        verify_cloud.check_deployment(ORIGIN)
                self.assertTrue(all(call.args[0].startswith(ORIGIN + "/") for call in request.call_args_list))

    def test_html_fallback_for_missing_javascript_is_rejected(self):
        resources = self.resources()
        resources["/assets/app.js"] = (b"<html>Not found</html>", "text/html")
        with patch.object(verify_cloud, "urlopen", side_effect=self.fetch(resources)), self.assertRaises(ValueError):
            verify_cloud.check_deployment(ORIGIN)

    def test_external_and_absent_assets_are_rejected(self):
        for html in (b'<script src="https://other.example.test/app.js"></script>',
                     b'<p>The text /assets/ alone is not a frontend build.</p>'):
            resources = self.resources()
            resources["/"] = (html, "text/html")
            with self.subTest(html=html), \
                    patch.object(verify_cloud, "urlopen", side_effect=self.fetch(resources)), \
                    self.assertRaises(ValueError):
                verify_cloud.check_deployment(ORIGIN)

    def test_failed_liveness_and_invalid_session_are_rejected(self):
        for path, value in (("/healthz", {"status": "unavailable"}),
                            ("/api/auth/session", {"user": {"account_id": 1}}),
                            ("/api/auth/session", {})):
            resources = self.resources()
            resources[path] = (json.dumps(value).encode(), "application/json")
            with self.subTest(path=path, value=value), \
                    patch.object(verify_cloud, "urlopen", side_effect=self.fetch(resources)), \
                    self.assertRaises(ValueError):
                verify_cloud.check_deployment(ORIGIN)

    def test_invalid_origin_is_rejected_before_any_request(self):
        with patch.object(verify_cloud, "urlopen") as request:
            for origin in ("http://genie.example.test", ORIGIN + "/app", ORIGIN + "?x=1",
                           "https://fixture:password@genie.example.test"):
                with self.subTest(origin=origin), self.assertRaises(SystemExit):
                    verify_cloud.main(origin)
        request.assert_not_called()
