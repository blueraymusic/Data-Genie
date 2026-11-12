"""Agent credentials never bypass live membership, SQL review, or report visibility."""

import hashlib
import json
import sqlite3
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend import workbench
from backend.agent_tokens import AgentTokens
from backend.workspaces import WorkspaceStore
from tests.test_http import HttpHarness


class AgentApiTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.workspace_id = self.session['access']['workspace_id']

    def key(self, scopes=None, workspace_id=None):
        status, result = self.request('POST', '/api/agent-tokens', {
            'name': 'Fixture agent', 'workspace_id': workspace_id or self.workspace_id,
            'scopes': scopes or ['databases:read', 'reports:read'], 'days': 7, 'password': self.password})
        self.assertEqual(status, 201, result)
        return result

    def agent(self, key, name=None, args=None, **headers):
        return self.request('POST' if name else 'GET', '/api/v1/actions/' + name if name else '/api/v1',
                            args if name else None, extra_headers={'Authorization': 'Bearer ' + key['token'], **headers})

    def test_keys_are_hashed_shown_once_and_cannot_use_cookie_auth(self):
        key = self.key()
        self.assertEqual(self.request('GET', '/api/v1')[0], 401)
        self.assertNotIn(key['token'], json.dumps(self.request('GET', '/api/agent-tokens')[1]))
        with workbench.get_repository()._connection() as connection:
            row = connection.execute('SELECT * FROM agent_tokens').fetchone()
            self.assertEqual(row['token_hash'], hashlib.sha256(key['token'].encode()).hexdigest())
            self.assertNotIn(key['token'], str(dict(row)))
        self.cookie = self.csrf = ''
        self.assertEqual(self.agent(key)[0], 200)
        self.assertEqual(self.request('GET', '/api/agent-tokens', extra_headers={'Authorization': 'Bearer ' + key['token']})[0], 401)

    def test_creation_requires_password_csrf_valid_scope_and_workspace(self):
        payload = {'name': 'Agent', 'workspace_id': self.workspace_id, 'scopes': ['reports:read'], 'password': 'wrong'}
        self.assertEqual(self.request('POST', '/api/agent-tokens', payload)[0], 400)
        payload['password'] = self.password
        csrf, self.csrf = self.csrf, ''
        self.assertEqual(self.request('POST', '/api/agent-tokens', payload)[0], 403)
        self.csrf = csrf
        for change in ({'scopes': ['admin']}, {'days': True}, {'workspace_id': 'missing'}):
            self.assertIn(self.request('POST', '/api/agent-tokens', {**payload, **change})[0], (400, 403))

    def test_expiry_revocation_and_password_change_invalidate_keys(self):
        key = self.key()
        self.assertEqual(self.request('POST', '/api/agent-tokens/revoke', {'token_id': key['token_id']})[0], 200)
        self.assertEqual(self.agent(key)[0], 401)
        key = self.key()
        with workbench.get_repository()._connection(write=True) as connection:
            connection.execute('UPDATE agent_tokens SET expires_at=? WHERE token_id=?', (int(time.time()) - 1, key['token_id']))
        self.assertEqual(self.agent(key)[0], 401)
        key = self.key()
        status, result = self.request('POST', '/api/auth/password', {'current_password': self.password, 'new_password': 'a different long passphrase 123'})
        self.assertEqual(status, 200, result)
        self.assertEqual(self.agent(key)[0], 401)

    def test_read_queries_are_bounded_and_writes_cannot_run(self):
        key = self.key()
        status, result = self.agent(key, 'query', {'database_id': self.session['database_id'], 'sql': 'SELECT * FROM notes'})
        self.assertEqual(status, 200, result)
        self.assertEqual(len(result['rows']), 2)
        for sql in ('DELETE FROM notes', 'SELECT * FROM notes; DELETE FROM notes', 'WITH x AS (SELECT 1) DELETE FROM notes'):
            status, _ = self.agent(key, 'query', {'database_id': self.session['database_id'], 'sql': sql})
            self.assertEqual(status, 400)
        with sqlite3.connect(workbench.get_repository().get_session(self.session_id)['path']) as connection:
            connection.executemany('INSERT INTO notes(body) VALUES(?)', [(str(i),) for i in range(80)])
        result = self.agent(key, 'query', {'database_id': self.session['database_id'], 'sql': 'WITH rows AS (SELECT * FROM notes) SELECT * FROM rows'})[1]
        self.assertEqual(len(result['rows']), 50)
        self.assertNotIn('confirmation_token', json.dumps(result))

    def test_query_accepts_trailing_line_comments(self):
        key = self.key()
        status, result = self.agent(key, 'query', {'database_id': self.session['database_id'],
            'sql': 'SELECT * FROM notes -- a normal SQL comment'})
        self.assertEqual(status, 200, result)
        self.assertTrue(result['matched'], result)
        self.assertEqual(len(result['rows']), 2)

    def test_moving_database_while_agent_waits_does_not_expand_key_scope(self):
        key = self.key()
        store = WorkspaceStore(workbench.get_repository())
        destination = store.create_workspace(self.account['account_id'], 'Different workspace')['workspace_id']
        lock = workbench._lock
        moved = False

        @contextmanager
        def move_before_lock(path):
            nonlocal moved
            if not moved:
                moved = True
                store.attach_database(self.account['account_id'], destination, self.session['database_id'])
            with lock(path):
                yield

        with patch.object(workbench, '_lock', side_effect=move_before_lock):
            status, result = self.agent(key, 'database_schema', {'database_id': self.session['database_id']})
        self.assertTrue(moved)
        self.assertEqual(status, 403, result)

    def test_concurrent_publication_cannot_be_undone_by_agent_draft_save(self):
        from backend.reports import ReportStore
        key = self.key(['reports:write'])
        report = ReportStore(workbench.get_repository()).save_report(self.account['account_id'], self.workspace_id,
            {'title': 'Reviewed report', 'body': 'Evidence'})
        save = ReportStore.save_report

        def publish_before_save(service, account_id, workspace_id, payload, **kwargs):
            save(service, account_id, workspace_id, {'report_id': report['report_id'], 'version': 1,
                'title': 'Reviewed report', 'body': 'Evidence', 'published': True})
            return save(service, account_id, workspace_id, payload, **kwargs)

        with patch.object(ReportStore, 'save_report', autospec=True, side_effect=publish_before_save):
            status, result = self.agent(key, 'save_report_draft', {'report_id': report['report_id'], 'version': 2,
                'title': 'Agent edit', 'body': 'Replacement', 'idempotency_key': 'publication-race'})
        self.assertEqual(status, 403, result)
        current = ReportStore(workbench.get_repository()).get_report(self.account['account_id'], self.workspace_id, report['report_id'])
        self.assertTrue(current['published'])
        self.assertEqual(current['body'], 'Evidence')

    def test_prepare_change_never_returns_approval_secret_or_executes(self):
        key = self.key(['databases:read', 'queries:prepare'])
        args = {'database_id': self.session['database_id'], 'sql': "UPDATE notes SET body='prepared' WHERE id=1", 'idempotency_key': 'prepare-fixture-1'}
        status, result = self.agent(key, 'prepare_change', args)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['status'], 'pending')
        self.assertNotIn('confirmation_token', json.dumps(result))
        self.assertTrue(result['review_url'].startswith('/history?agent_session='))
        self.assertEqual(self.agent(key, 'prepare_change', args)[1]['request_id'], result['request_id'])
        with sqlite3.connect(workbench.get_repository().get_session(self.session_id)['path']) as connection:
            self.assertEqual(connection.execute('SELECT body FROM notes WHERE id=1').fetchone()[0], 'first')
        self.cookie = self.csrf = ''
        self.assertEqual(self.request('POST', '/api/commands/confirm', {'command_id': result['command_id']},
            result['session_id'], extra_headers={'Authorization': 'Bearer ' + key['token']})[0], 401)

    def test_scope_and_workspace_denial_happen_before_database_or_ai_calls(self):
        key = self.key(['reports:read'])
        with patch.object(workbench, 'schema_for_session') as schema, patch('backend.reports.gemini_provider._request_json') as ai:
            self.assertEqual(self.agent(key, 'database_schema', {'database_id': self.session['database_id']})[0], 403)
            self.assertEqual(self.agent(key, 'generate_report', {'goal': 'test', 'source': 'test'})[0], 403)
            schema.assert_not_called(); ai.assert_not_called()
        store = WorkspaceStore(workbench.get_repository())
        team = store.create_workspace(self.account['account_id'], 'Other team')
        other_key = self.key(workspace_id=team['workspace_id'])
        with patch.object(workbench, 'schema_for_session') as schema:
            self.assertEqual(self.agent(other_key, 'database_schema', {'database_id': self.session['database_id']})[0], 403)
            schema.assert_not_called()

    def test_database_creation_and_report_retries_are_idempotent(self):
        key = self.key(['databases:create', 'reports:write', 'reports:read'])
        args = {'name': 'Agent database', 'idempotency_key': 'database-fixture-1'}
        status, created = self.agent(key, 'create_database', args)
        self.assertEqual(status, 200, created)
        self.assertEqual(self.agent(key, 'create_database', args)[1], created)
        self.assertEqual(self.agent(key, 'create_database', {**args, 'name': 'Different'})[0], 400)
        draft = {'title': 'Findings', 'body': 'Two notes.', 'idempotency_key': 'report-fixture-1'}
        first = self.agent(key, 'save_report_draft', draft)[1]
        self.assertEqual(self.agent(key, 'save_report_draft', draft)[1], first)
        rows = self.agent(key, 'list_reports', {})[1]['reports']
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]['published'])
        report_id = rows[0]['report_id']
        update = {**draft, 'report_id': report_id, 'version': 1, 'idempotency_key': 'report-fixture-2'}
        self.assertEqual(self.agent(key, 'save_report_draft', update)[0], 200)
        self.assertEqual(self.agent(key, 'save_report_draft', {**update, 'idempotency_key': 'report-fixture-3'})[0], 400)
        self.assertEqual(self.agent(key, 'save_report_draft', {**draft, 'published': True})[0], 400)

    def test_membership_and_grant_revocation_apply_to_existing_agent_sessions(self):
        store = WorkspaceStore(workbench.get_repository())
        owner = self.account['account_id']
        team = store.create_workspace(owner, 'Shared team')['workspace_id']
        store.attach_database(owner, team, self.session['database_id'])
        owner_cookie, owner_csrf = self.cookie, self.csrf
        self.cookie = self.csrf = ''
        _, registered = self.request('POST', '/api/auth/register', {'first_name': 'Other', 'last_name': 'Fixture',
            'email': 'member@example.test', 'password': self.password})
        member = registered['user']['account_id']
        invitation = store.invite(owner, team, 'member@example.test')
        store.accept_invitation(member, invitation['invitation_id'], invitation['token'])
        store.set_grant(owner, team, member, self.session['database_id'], {'read': True})
        key = self.key(workspace_id=team)
        args = {'database_id': self.session['database_id']}
        self.assertEqual(self.agent(key, 'database_schema', args)[0], 200)
        store.set_grant(owner, team, member, self.session['database_id'], {})
        with patch.object(workbench, 'schema_for_session') as schema:
            self.assertEqual(self.agent(key, 'database_schema', args)[0], 403)
            schema.assert_not_called()
        store.remove_member(owner, team, member)
        self.assertEqual(self.agent(key)[0], 403)
        self.cookie, self.csrf = owner_cookie, owner_csrf

    def test_viewers_only_see_shared_reports_and_no_database_tools(self):
        store = WorkspaceStore(workbench.get_repository()); owner = self.account['account_id']
        team = store.create_workspace(owner, 'Viewer team')['workspace_id']
        self.request('POST', '/api/workspaces/' + team + '/reports', {'title': 'Shared', 'body': 'Evidence', 'published': True})
        self.request('POST', '/api/workspaces/' + team + '/reports', {'title': 'Private', 'body': 'Private evidence'})
        self.cookie = self.csrf = ''
        _, registration = self.request('POST', '/api/auth/register', {'first_name': 'Viewer', 'last_name': 'Fixture',
            'email': 'viewer@example.test', 'password': self.password})
        invitation = store.invite(owner, team, 'viewer@example.test', 'viewer')
        store.accept_invitation(registration['user']['account_id'], invitation['invitation_id'], invitation['token'])
        key = self.key(['reports:read'], team)
        self.assertEqual({tool['name'] for tool in self.agent(key)[1]['tools']}, {'workspace', 'list_reports', 'get_report'})
        rows = self.agent(key, 'list_reports', {})[1]['reports']
        self.assertEqual([row['title'] for row in rows], ['Shared'])
        self.assertEqual(self.agent(key, 'list_databases', {})[0], 403)

    def test_rate_limits_have_retry_headers_and_cross_origin_is_rejected(self):
        key = self.key()
        with patch.object(AgentTokens, 'reserve') as reserve:
            self.assertEqual(self.agent(key, Origin='https://other.example')[0], 200)  # GET has no side effects.
            self.assertEqual(self.agent(key, 'workspace', {}, Origin='https://other.example')[0], 403)
        from backend.authentication import TooManyAttempts
        with patch.object(AgentTokens, 'reserve', side_effect=TooManyAttempts(60)):
            self.assertEqual(self.agent(key)[0], 429)
            self.assertIn('Retry-After: 60', self.last_headers)

    def test_openapi_is_public_and_matches_the_action_catalog(self):
        self.cookie = self.csrf = ''
        status, schema = self.request('GET', '/api/v1/openapi.json')
        self.assertEqual(status, 200)
        self.assertIn('/api/v1/actions/prepare_change', schema['paths'])
        self.assertEqual(schema['components']['securitySchemes']['agentKey']['scheme'], 'bearer')

    def test_default_key_is_read_only_for_seven_days(self):
        status, key = self.request('POST', '/api/agent-tokens', {'name': 'Default fixture', 'workspace_id': self.workspace_id, 'password': self.password})
        self.assertEqual(status, 201)
        self.assertEqual(key['scopes'], ['databases:read'])
        self.assertEqual(key['expires_at'] - key['created_at'], 7 * 86400)

    def test_read_only_sqlite_engine_denies_writes_even_without_parser(self):
        with workbench.session_scope(self.session_id):
            for sql in ('DELETE FROM notes', 'CREATE TEMP TABLE hostile(id)', "ATTACH DATABASE ':memory:' AS hostile", 'PRAGMA query_only=OFF'):
                with workbench.db(readonly=True) as connection:
                    with self.assertRaises(sqlite3.DatabaseError):
                        connection.execute(sql)
        key = self.key()
        for sql in ("ATTACH DATABASE ':memory:' AS hostile", 'PRAGMA query_only=OFF', "SELECT load_extension('hostile')", 'WITH gone AS (DELETE FROM notes RETURNING *) SELECT * FROM gone'):
            status, result = self.agent(key, 'query', {'database_id': self.session['database_id'], 'sql': sql})
            self.assertIn(status, (200, 400))
            if status == 200:
                self.assertFalse(result.get('matched'), sql)
                self.assertFalse(result.get('requires_confirmation'), sql)
        with workbench.session_scope(self.session_id), workbench.db(readonly=True) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM notes').fetchone()[0], 2)
