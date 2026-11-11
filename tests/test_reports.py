"""Reports never grant source-database access; generation uses only supplied notes."""
from unittest.mock import patch
from io import BytesIO
import importlib.util
import unittest
from tests.test_http import HttpHarness
from tests import test_workspace_http as workspace_fixture
from backend import report_pdf, reports, workbench

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

PDF_AVAILABLE = bool(importlib.util.find_spec('reportlab'))


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
        self.assertFalse(shared[0]['can_delete'])
        self.assertTrue(shared[0]['published'])
        self.forbidden('POST', self.route('open'), {'database_id': self.database_id})
        self.as_user('outsider')
        self.forbidden('GET', path)

    def create_report(self, title='Evidence report', body='Verified evidence.', published=False):
        status, result = self.request('POST', self.route('reports'), {'title': title, 'body': body, 'published': published})
        self.assertEqual(status, 200, result)
        return next(row for row in self.request('GET', self.route('reports'))[1]['reports']
                    if row['report_id'] == result['report_id'])

    def test_only_current_nonviewer_creator_can_delete_draft_or_shared_report(self):
        self.join('member')
        self.join('viewer', 'viewer')
        self.as_user('member')
        draft = self.create_report()
        self.assertTrue(draft['can_delete'])
        target = self.route('reports') + '/' + draft['report_id'] + '/delete'
        self.as_user('owner')
        owner_view = self.request('GET', self.route('reports'))[1]['reports'][0]
        self.assertFalse(owner_view['can_delete'])
        self.forbidden('POST', target, {'version': draft['version']})
        self.assertEqual(self.request('POST', self.route('reports'), {**draft, 'published': True})[0], 200)
        self.as_user('viewer')
        self.forbidden('POST', target, {'version': 2})
        self.as_user('outsider')
        self.forbidden('POST', target, {'version': 2})
        self.as_user('member')
        shared = self.request('GET', self.route('reports'))[1]['reports'][0]
        self.assertTrue(shared['can_delete'])
        self.assertEqual(self.request('POST', target, {'version': shared['version']})[0], 200)
        self.assertEqual(self.request('GET', self.route('reports'))[1]['reports'], [])
        self.forbidden('POST', target, {'version': shared['version']})
        second = self.create_report('Second draft')
        self.assertEqual(self.request('POST', self.route('reports') + '/' + second['report_id'] + '/delete',
                                      {'version': second['version']})[0], 200)

    def test_delete_rejects_stale_versions_missing_csrf_and_cross_workspace_ids(self):
        draft = self.create_report()
        target = self.route('reports') + '/' + draft['report_id'] + '/delete'
        for invalid in (None, False, '1', 0, 2):
            self.assertEqual(self.request('POST', target, {'version': invalid})[0], 400)
        self.assertEqual(self.request('POST', target, {'version': 1}, extra_headers={'X-CSRF-Token': ''})[0], 403)
        self.assertEqual(self.request('POST', self.route('reports'), {**draft, 'body': 'Newer evidence'})[0], 200)
        status, failure = self.request('POST', target, {'version': 1})
        self.assertEqual(status, 400)
        self.assertIn('changed in another session', failure['error'])
        self.assertEqual(self.request('GET', self.route('reports'))[1]['reports'][0]['body'], 'Newer evidence')
        _, other = self.request('POST', '/api/workspaces', {'name': 'Other workspace'})
        self.forbidden('POST', '/api/workspaces/' + other['workspace_id'] + '/reports/' + draft['report_id'] + '/delete', {'version': 2})
        self.forbidden('POST', self.route('reports') + '/missing/delete', {'version': 1})
        self.cookie = self.csrf = ''
        self.assertEqual(self.request('POST', target, {'version': 2})[0], 401)

    def test_demoted_creator_remains_read_only_and_revoked_member_cannot_export(self):
        self.join('member')
        self.as_user('member')
        draft = self.create_report()
        target = self.route('reports') + '/' + draft['report_id']
        self.as_user('owner')
        self.request('POST', self.route('reports'), {**draft, 'published': True})
        self.request('POST', self.route('members'), {'account_id': self.clients['member'][2]['account_id'], 'role': 'viewer'})
        self.as_user('member')
        self.assertFalse(self.request('GET', self.route('reports'))[1]['reports'][0]['can_delete'])
        self.forbidden('POST', target + '/delete', {'version': 2})
        self.as_user('owner')
        self.request('POST', self.route('remove'), {'account_id': self.clients['member'][2]['account_id']})
        self.as_user('member')
        with patch.object(report_pdf, 'render_report') as render:
            self.forbidden('GET', target + '/pdf')
            render.assert_not_called()

    def test_pdf_routes_check_visibility_before_rendering_and_keep_drafts_private(self):
        self.join('member')
        self.join('viewer', 'viewer')
        self.as_user('member')
        draft = self.create_report(title='Café / report\r\nInjected: header')
        target = self.route('reports') + '/' + draft['report_id'] + '/pdf'
        with patch.object(report_pdf, 'render_report', return_value=b'%PDF-fixture') as render:
            for name in ('owner', 'member'):
                self.as_user(name)
                self.assertEqual(self.request('GET', target, raw=True), (200, b'%PDF-fixture'))
                self.assertIn('Content-Type: application/pdf', self.last_headers)
                self.assertIn('Content-Disposition: attachment; filename="Cafe-report-Injected-header.pdf"', self.last_headers)
                self.assertIn('Cache-Control: no-store', self.last_headers)
            self.assertEqual(render.call_count, 2)
            for name in ('viewer', 'outsider'):
                self.as_user(name)
                self.forbidden('GET', target)
            self.assertEqual(render.call_count, 2)
            self.as_user('owner')
            _, other = self.request('POST', '/api/workspaces', {'name': 'Other workspace'})
            self.forbidden('GET', '/api/workspaces/' + other['workspace_id'] + '/reports/' + draft['report_id'] + '/pdf')
            self.forbidden('GET', self.route('reports') + '/missing/pdf')
            self.request('POST', self.route('reports'), {**draft, 'published': True})
            self.as_user('viewer')
            self.assertEqual(self.request('GET', target, raw=True)[0], 200)
            self.assertEqual(render.call_count, 3)
            self.cookie = self.csrf = ''
            self.assertEqual(self.request('GET', target)[0], 401)
            self.assertEqual(render.call_count, 3)

    def test_optional_pdf_dependency_failure_does_not_affect_saved_reports(self):
        draft = self.create_report()
        with patch.object(report_pdf, 'render_report', side_effect=report_pdf.PdfExportUnavailable('PDF export is unavailable.')):
            status, failure = self.request('GET', self.route('reports') + '/' + draft['report_id'] + '/pdf')
        self.assertEqual(status, 503)
        self.assertEqual(failure['code'], 'pdf_export_unavailable')
        self.assertEqual(self.request('GET', self.route('reports'))[1]['reports'][0]['body'], draft['body'])

    def test_missing_pdf_library_returns_a_graceful_unavailable_response(self):
        draft = self.create_report()
        original_import = __import__
        def without_pdf(name, *args, **kwargs):
            if name.startswith('reportlab'):
                raise ModuleNotFoundError('optional library not installed')
            return original_import(name, *args, **kwargs)
        with patch('builtins.__import__', side_effect=without_pdf):
            status, failure = self.request('GET', self.route('reports') + '/' + draft['report_id'] + '/pdf')
        self.assertEqual(status, 503)
        self.assertEqual(failure['code'], 'pdf_export_unavailable')
        self.assertEqual(len(self.request('GET', self.route('reports'))[1]['reports']), 1)

    @unittest.skipUnless(PDF_AVAILABLE, 'Install report requirements for font checks.')
    def test_font_configuration_error_is_sanitized(self):
        from reportlab.pdfbase.ttfonts import TTFError
        draft = self.create_report()
        with patch.object(report_pdf, '_fonts', side_effect=TTFError('private filesystem detail')):
            status, failure = self.request('GET', self.route('reports') + '/' + draft['report_id'] + '/pdf')
        self.assertEqual(status, 503)
        self.assertNotIn('private filesystem', failure['error'])

    @unittest.skipUnless(PDF_AVAILABLE and PdfReader, 'Install report and test requirements for PDF content checks.')
    def test_pdf_download_contains_literal_unicode_text_and_multiple_complete_pages(self):
        lines = ['Evidence <b>literal text</b> & amounts > estimates.',
                 'Café résumé · Καλημέρα · Привет · 漢字 · 日本語 · 한국어 · → € •']
        lines += [f'Finding {index:03d}: Verified customer evidence and next steps.' for index in range(180)]
        lines.append('Final finding: nothing omitted.')
        draft = self.create_report('Café findings', '\n'.join(lines))
        status, content = self.request('GET', self.route('reports') + '/' + draft['report_id'] + '/pdf', raw=True)
        self.assertEqual(status, 200, content[:200])
        self.assertTrue(content.startswith(b'%PDF-'))
        pdf = PdfReader(BytesIO(content))
        self.assertGreaterEqual(len(pdf.pages), 3)
        for page in pdf.pages:
            self.assertIn('DATA GENIE', page.extract_text())
            self.assertIn('Report snapshot', page.extract_text())
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        for expected in ('Café findings', '<b>literal text</b>', 'Καλημέρα', 'Привет', '漢字', '日本語', '한국어', '→', '€', 'Finding 179', 'Final finding: nothing omitted.'):
            self.assertIn(expected, text)
        self.assertNotIn('/JavaScript', pdf.trailer)
        self.assertTrue(all(not page.get('/Annots') for page in pdf.pages))
        self.assertEqual(len(self.request('GET', self.route('reports'))[1]['reports']), 1)

    @unittest.skipUnless(PDF_AVAILABLE and PdfReader, 'Install report and test requirements for PDF content checks.')
    def test_pdf_wraps_long_unbroken_text_and_rejects_unknown_glyphs_explicitly(self):
        draft = self.create_report(body='start ' + 'x' * 8000 + ' final-token')
        status, content = self.request('GET', self.route('reports') + '/' + draft['report_id'] + '/pdf', raw=True)
        self.assertEqual(status, 200)
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertIn('final-token', text)
        self.assertEqual(text.count('x'), 8000)
        unsupported = self.create_report(body='Saved text with unsupported character \U0001FAE8')
        status, failure = self.request('GET', self.route('reports') + '/' + unsupported['report_id'] + '/pdf')
        self.assertEqual(status, 400)
        self.assertIn('U+1FAE8', failure['error'])
        self.assertEqual(len(self.request('GET', self.route('reports'))[1]['reports']), 2)

    def test_shared_report_cannot_be_modified_or_unshared_by_member(self):
        self.join('member')
        path = self.route('reports')
        self.as_user('member')
        self.request('POST', path, {'title': 'Approved', 'body': 'Original evidence'})
        self.as_user('owner')
        draft = self.request('GET', path)[1]['reports'][0]
        self.assertEqual(self.request('POST', path, {**draft, 'published': True})[0], 200)
        self.as_user('member')
        shared = self.request('GET', path)[1]['reports'][0]
        self.assertFalse(shared['can_edit'])
        self.forbidden('POST', path, {**shared, 'body': 'Changed', 'published': False})
        self.assertEqual(self.request('GET', path)[1]['reports'][0]['body'], 'Original evidence')

    def test_invalid_report_ids_do_not_create_new_reports(self):
        self.as_user('owner')
        path = self.route('reports')
        for invalid in ('', False, 0, [], {}):
            status, response = self.request('POST', path, {'report_id': invalid, 'title': 'Duplicate', 'body': 'Text'})
            self.assertEqual(status, 400, response)
        self.assertEqual(self.request('GET', path)[1]['reports'], [])

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

