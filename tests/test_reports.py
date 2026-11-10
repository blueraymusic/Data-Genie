"""Reports never grant source-database access; generation uses only supplied notes."""
from unittest.mock import patch
import unittest
from tests.test_http import HttpHarness
from tests import test_workspace_http as workspace_fixture
from backend import reports, workbench


class ReportHttpTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.clients = {"owner": (self.cookie, self.csrf, self.account)}
        for name in ("member", "viewer", "outsider"):
            self.cookie = self.csrf = ""
            status, response = self.request("POST", "/api/auth/register", {
                "first_name": name, "last_name": "Fixture", "email": name + "@example.test", "password": self.password})
            self.assertEqual(status, 201)
            self.clients[name] = (self.cookie, self.csrf, response["user"])
        self.as_user("owner")
        _, self.workspace = self.request("POST", "/api/workspaces", {"name": "Report team"})
        self.workspace_id = self.workspace["workspace_id"]
        self.database_id = self.session["database_id"]
        self.request("POST", self.route("attach"), {"database_id": self.database_id})

    as_user = workspace_fixture.WorkspaceHttpTests.as_user
    route = workspace_fixture.WorkspaceHttpTests.route
    invite = workspace_fixture.WorkspaceHttpTests.invite
    accept = workspace_fixture.WorkspaceHttpTests.accept
    join = workspace_fixture.WorkspaceHttpTests.join
    forbidden = workspace_fixture.WorkspaceHttpTests.forbidden
    def test_report_publication_and_viewer_isolation(self):
        self.join('member')
        self.join('viewer', 'viewer')
        path = self.route('reports')
        self.as_user('member')
        payload = {'title': 'Monthly summary', 'body': 'Verified source notes.', 'published': False}
        status, created = self.request('POST', path, payload)
        self.assertEqual(status, 200, created)
        self.as_user('viewer')
        self.assertEqual(self.request('GET', path)[1]['reports'], [])
        self.forbidden('POST', path, payload)
        self.forbidden('POST', path + '/generate', {'goal': 'Summarize', 'source': 'Notes'})
        self.as_user('owner')
        draft = self.request('GET', path)[1]['reports'][0]
        self.assertEqual(self.request('POST', path, {**draft, 'published': True})[0], 200)
        self.as_user('viewer')
        shared = self.request('GET', path)[1]['reports']
        self.assertEqual(len(shared), 1)
        self.assertFalse(shared[0]['can_edit'])
        self.assertTrue(shared[0]['published'])
        self.forbidden('POST', self.route('open'), {'database_id': self.database_id})
        self.as_user('outsider')
        self.forbidden('GET', path)

    def test_member_cannot_publish_and_stale_edits_cannot_overwrite(self):
        self.join('member')
        self.as_user('member')
        path = self.route('reports')
        payload = {'title': 'Draft', 'body': 'Evidence'}
        self.request('POST', path, payload)
        draft = self.request('GET', path)[1]['reports'][0]
        self.forbidden('POST', path, {**draft, 'published': True})
        self.assertEqual(self.request('POST', path, {**draft, 'body': 'Changed'})[0], 200)
        self.assertEqual(self.request('POST', path, {**draft, 'body': 'Stale overwrite'})[0], 400)
        self.as_user('owner')
        self.request('POST', self.route('members'), {'account_id': self.clients['member'][2]['account_id'], 'role': 'viewer'})
        self.as_user('member')
        self.assertEqual(self.request('GET', path)[1]['reports'], [])

    def test_report_generation_checks_access_before_provider_and_is_not_saved(self):
        self.join('member')
        path = self.route('reports')
        payload = {'goal': 'Summarize this week', 'source': 'There were 8 orders.'}
        response = {'candidates': [{'content': {'parts': [{'text': 'Eight orders were recorded.'}]}}]}
        with patch.object(reports.settings, 'gemini_settings', return_value={'api_key': 'fixture', 'model': 'test'}), patch.object(reports.gemini_provider, '_request_json', return_value=response) as provider:
            self.as_user('outsider')
            self.forbidden('POST', path + '/generate', payload)
            provider.assert_not_called()
            self.as_user('member')
            status, result = self.request('POST', path + '/generate', payload)
            self.assertEqual(status, 200, result)
            self.assertIn('Eight orders', result['body'])
            self.assertEqual(self.request('GET', path)[1]['reports'], [])
            self.assertNotIn('notes(id', str(provider.call_args))
            for _ in range(9):
                self.assertEqual(self.request('POST', path + '/generate', payload)[0], 200)
            self.assertEqual(self.request('POST', path + '/generate', payload)[0], 400)
            self.assertEqual(provider.call_count, 10)

