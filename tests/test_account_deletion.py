"""Destructive account lifecycle tested only against isolated fixture databases."""
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

from backend import authentication, workbench
from backend.agent_tokens import AgentTokens
from backend.reports import ReportStore
from backend.workspaces import WorkspaceStore
from tests.test_http import HttpHarness


class AccountDeletionTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.repository = workbench.get_repository()
        self.accounts = authentication.Accounts(self.repository)
        self.store = WorkspaceStore(self.repository)
        self.reports = ReportStore(self.repository)
        self.owner = self.account['account_id']
        self.member = self.accounts.register('Member', 'Fixture', 'member@example.test', self.password, 'member-fixture')['account_id']
        self.viewer = self.accounts.register('Viewer', 'Fixture', 'viewer@example.test', self.password, 'viewer-fixture')['account_id']
        self.source = Path(self.session['path'])

    def as_user(self, account_id):
        token = self.accounts.issue_login(account_id)
        self.cookie = authentication.COOKIE_NAME + '=' + token
        self.csrf = authentication.csrf_token(token)

    def team(self, owner=None, members=True):
        owner = owner or self.owner
        team = self.store.create_workspace(owner, 'Fixture studio')['workspace_id']
        if owner == self.owner:
            self.store.attach_database(owner, team, self.session['database_id'])
        if members:
            targets = [(self.member, 'member'), (self.viewer, 'viewer')] if owner == self.owner else [(self.owner, 'member')]
            for account_id, role in targets:
                with self.repository._connection() as connection:
                    email = connection.execute('SELECT email FROM accounts WHERE account_id=?', (account_id,)).fetchone()[0]
                invite = self.store.invite(owner, team, email, role)
                self.store.accept_invitation(account_id, invite['invitation_id'], invite['token'])
        return team

    def report(self, team, author=None, published=True):
        return self.reports.save_report(author or self.owner, team, {'title': 'Fixture findings', 'body': 'Reviewed fixture snapshot.', 'published': published})['report_id']

    def remove(self, **changes):
        return self.request('POST', '/api/auth/delete', {'email': 'ada@example.com', 'confirmation': 'DELETE', 'password': self.password, **changes})

    def check_integrity(self):
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_requires_current_login_csrf_email_confirmation_and_password(self):
        payload = {'email': 'ada@example.com', 'confirmation': 'DELETE', 'password': self.password}
        self.assertEqual(self.request('POST', '/api/auth/delete', payload, extra_headers={'Cookie': ''})[0], 401)
        self.assertEqual(self.request('POST', '/api/auth/delete', payload, extra_headers={'X-CSRF-Token': ''})[0], 403)
        self.assertEqual(self.remove(confirmation='')[0], 400)
        self.assertEqual(self.remove(email='member@example.test')[0], 400)
        self.assertEqual(self.remove(password='wrong')[0], 400)
        self.assertTrue(self.source.is_file())
        self.assertEqual(self.request('GET', '/api/auth/session')[1]['user']['account_id'], self.owner)

    def test_cascades_owned_databases_history_schema_and_keys_but_archives_shared_reports(self):
        team = self.team()
        shared = self.report(team)
        self.report(team, self.member, published=False)
        with sqlite3.connect(self.source) as source:
            source.execute('CREATE TABLE children(id INTEGER PRIMARY KEY, note_id INTEGER REFERENCES notes(id))')
        self.repository.sync_schema(self.session['database_id'], self.source)
        for sql in ['SELECT * FROM notes', 'INSERT INTO notes(body) VALUES(\'third\')', 'CREATE TABLE extra(id INTEGER)']:
            self.assertEqual(self.request('POST', '/api/query', {'sql': sql}, self.session_id)[0], 200)
        token = AgentTokens(self.repository).create(self.owner, {'name': 'fixture', 'workspace_id': team, 'scopes': ['databases:read'], 'days': 1})
        self.assertEqual(self.request('GET', '/api/auth/deletion')[1]['databases'], 1)
        status, result = self.remove(account_id=self.member)
        self.assertEqual((status, result), (200, {'deleted': True}))
        self.assertFalse(self.source.exists())
        self.assertIsNone(self.request('GET', '/api/auth/session')[1]['user'])
        self.assertEqual(self.request('POST', '/api/auth/login', {'email': 'ada@example.com', 'password': self.password})[0], 401)
        with self.repository._connection() as connection:
            for table in ['databases', 'sessions', 'schema_tables', 'schema_columns', 'column_constraints', 'column_references', 'requests', 'sql_commands', 'results', 'agent_tokens']:
                self.assertEqual(connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0], 0, table)
            self.assertIsNone(connection.execute('SELECT 1 FROM accounts WHERE account_id=?', (self.owner,)).fetchone())
        details = self.store.get_workspace(self.member, team)
        self.assertTrue(details['workspace']['archived_at'])
        self.assertEqual(details['databases'], [])
        report = self.reports.get_report(self.viewer, team, shared)
        self.assertEqual((report['first_name'], report['last_name']), ('Deleted', 'account'))
        self.assertTrue(report['can_delete'])
        self.assertFalse(report['can_edit'])
        with self.assertRaises(PermissionError):
            self.reports.save_report(self.member, team, {'title': 'Blocked', 'body': 'No writes.'})
        self.reports.delete_report(self.viewer, team, shared, report['version'])
        self.check_integrity()

    def test_transfer_keeps_database_files_and_moves_postgres_connection_ownership(self):
        team = self.team()
        report = self.report(team)
        remote = self.repository.create_external_session(self.owner, 'External fixture', 'encrypted-fixture-only')
        self.store.attach_database(self.owner, team, remote['database_id'])
        self.assertEqual(self.remove(transfers={team: self.member})[0], 200)
        self.assertTrue(self.source.is_file())
        details = self.store.get_workspace(self.member, team)
        self.assertEqual(details['workspace']['role'], 'owner')
        self.assertFalse(details['workspace']['archived_at'])
        self.assertEqual(len(details['databases']), 2)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('SELECT account_id FROM external_connections').fetchone()[0], self.member)
            self.assertEqual({row[0] for row in connection.execute('SELECT owner_account_id FROM workspace_databases WHERE workspace_id=?', (team,))}, {self.member})
        self.assertTrue(self.reports.get_report(self.member, team, report)['can_edit'])
        self.check_integrity()

    def test_rejects_transfers_to_nonmembers_without_any_partial_change(self):
        team = self.team(members=False)
        self.assertEqual(self.remove(transfers={team: self.member})[0], 403)
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'owner')
        self.assertTrue(self.source.is_file())
        self.assertEqual(self.remove(transfers={team: str(self.member)})[0], 400)
        self.assertEqual(self.remove(transfers={team: self.owner})[0], 400)
        self.check_integrity()

    def test_workspace_without_remaining_members_and_reports_is_fully_deleted(self):
        team = self.team(members=False)
        self.report(team)
        self.assertEqual(self.remove()[0], 200)
        with self.repository._connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM workspaces WHERE workspace_id=?', (team,)).fetchone())
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM workspace_reports').fetchone()[0], 0)
        self.check_integrity()

    def test_preserves_other_owners_workspace_and_database_and_retains_authored_report(self):
        other_team = self.team(owner=self.member)
        report = self.report(other_team, published=False)
        self.assertEqual(self.remove()[0], 200)
        self.assertEqual(self.store.get_workspace(self.member, other_team)['workspace']['role'], 'owner')
        self.assertFalse(self.store.get_workspace(self.member, other_team)['workspace']['archived_at'])
        self.assertEqual(self.reports.get_report(self.member, other_team, report)['first_name'], 'Deleted')
        self.check_integrity()

    def test_metadata_failure_restores_staged_files_and_rolls_back_transfers(self):
        team = self.team()
        with self.repository._connection(write=True) as connection:
            connection.execute('CREATE TABLE fixture_dependency(account_id INTEGER REFERENCES accounts(account_id))')
            connection.execute('INSERT INTO fixture_dependency VALUES(?)', (self.owner,))
        self.assertEqual(self.remove()[0], 400)
        self.assertTrue(self.source.is_file())
        self.assertEqual(self.store.get_workspace(self.owner, team)['workspace']['role'], 'owner')
        self.assertEqual(self.request('GET', '/api/auth/session')[1]['user']['account_id'], self.owner)
        self.assertEqual(list(self.source.parent.glob('*.account-delete-*')), [])
        self.check_integrity()

    def test_deferred_file_cleanup_retries_without_restoring_access(self):
        original = Path.unlink
        def fail_cleanup(path, *args, **kwargs):
            if '.account-delete-' in path.name:
                raise OSError('fixture cleanup failure')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', fail_cleanup):
            self.assertEqual(self.remove()[0], 200)
            self.assertFalse(self.source.exists())
            with self.repository._connection() as connection:
                self.assertGreater(connection.execute('SELECT COUNT(*) FROM account_file_deletions').fetchone()[0], 0)
        self.request('GET', '/api/auth/session')
        self.assertEqual(list(self.source.parent.glob('*.account-delete-*')), [])
        self.check_integrity()

    def test_last_remaining_member_deletion_removes_the_archive(self):
        team = self.team()
        self.report(team)
        self.remove()
        self.as_user(self.member)
        self.assertEqual(self.remove(email='member@example.test')[0], 200)
        self.as_user(self.viewer)
        self.assertEqual(self.remove(email='viewer@example.test')[0], 200)
        with self.repository._connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM workspaces WHERE workspace_id=?', (team,)).fetchone())
        self.check_integrity()

    def test_microsoft_only_account_requires_a_fresh_verified_login(self):
        import time
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE accounts SET password_hash='!microsoft' WHERE account_id=?", (self.owner,))
            connection.execute("INSERT INTO external_identities VALUES('microsoft','https://login.example.test/tenant','fixture-subject',?,?)", (self.owner, int(time.time())))
            connection.execute('UPDATE browser_logins SET created_at=? WHERE account_id=?', (int(time.time()) - 301, self.owner))
        self.assertEqual(self.remove()[0], 400)
        self.assertTrue(self.source.is_file())
        self.as_user(self.owner)
        self.assertEqual(self.remove()[0], 200)
        self.assertFalse(self.source.is_file())
