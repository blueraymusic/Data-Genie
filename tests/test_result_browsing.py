"""Browsing may only read an executed command owned by the active account/session."""
import unittest
from tests.test_http import HttpHarness


class ResultBrowsingTests(HttpHarness, unittest.TestCase):
    def test_browse_uses_stored_read_and_validates_inputs(self):
        _, result = self.request('POST', '/api/ask', {'question':'show notes'}, self.session_id)
        status, page = self.request('GET', f"/api/results/page?command_id={result['command_id']}&offset=1", session_id=self.session_id)
        self.assertEqual(status, 200)
        self.assertEqual(page['rows'], [{'id':2,'body':'second'}])
        self.assertFalse(page['has_more'])
        self.assertEqual(self.request('GET', '/api/results/page?command_id=1&offset=-1', session_id=self.session_id)[0], 400)
        self.assertEqual(self.request('GET', '/api/results/page?command_id=1&offset=not-a-number', session_id=self.session_id)[0], 400)
        self.assertEqual(self.request('GET', '/api/results/page?command_id=1')[0], 403)

    def test_other_account_and_pending_writes_cannot_be_browsed(self):
        _, read = self.request('POST', '/api/ask', {'question':'show notes'}, self.session_id)
        _, pending = self.request('POST', '/api/ask', {'question':'delete from notes where id=1'}, self.session_id)
        self.assertEqual(self.request('GET', f"/api/results/page?command_id={pending['command_id']}", session_id=self.session_id)[0], 400)
        _, other = self.request('POST', '/api/sessions', {'database_mode':'create','database_name':'other'})
        self.assertEqual(self.request('GET', f"/api/results/page?command_id={read['command_id']}", session_id=other['session_id'])[0], 400)
        self.request('POST', '/api/auth/register', {'first_name':'Other','last_name':'Reader','email':'other@example.test','password':self.password})
        self.assertEqual(self.request('GET', f"/api/results/page?command_id={read['command_id']}", session_id=self.session_id)[0], 403)
