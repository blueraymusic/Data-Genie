"""Deleting a team revokes sharing while preserving data and private history."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
from threading import Event
import time
import unittest

from backend import workbench
from backend.repository import RepositoryError
from backend.workspaces import WorkspaceStore
from tests.test_http import HttpHarness


class WorkspaceDeletionTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.repository = workbench.get_repository()
        self.store = WorkspaceStore(self.repository)
        self.owner = self.account['account_id']
        self.workspace = self.store.create_workspace(self.owner, 'Research Team')
        self.workspace_id = self.workspace['workspace_id']
        self.database_id = self.session['database_id']
        self.store.attach_database(self.owner, self.workspace_id, self.database_id)
        with self.repository._connection(write=True) as connection:
            self.member = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Member','Fixture','member@example.test','!test',?)''', (int(time.time()),)).lastrowid
            self.guest = connection.execute('''INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Guest','Fixture','guest@example.test','!test',?)''', (int(time.time()),)).lastrowid
        invitation = self.store.invite(self.owner, self.workspace_id, 'member@example.test')
        self.store.accept_invitation(self.member, invitation['invitation_id'], invitation['token'])
        self.store.set_grant(self.owner, self.workspace_id, self.member, self.database_id,
                             {'read': True, 'write': True, 'delete': True, 'structure': True, 'export': True})
        self.member_session = self.store.open_database(self.member, self.workspace_id, self.database_id)
        self.pending_invitation = self.store.invite(self.owner, self.workspace_id, 'guest@example.test')

    def delete(self, name='Research Team'):
        return self.store.delete_workspace(self.owner, self.workspace_id, name)

    def rows(self):
        with sqlite3.connect(self.session['path']) as connection:
            return connection.execute('SELECT id,body FROM notes ORDER BY id').fetchall()

    def test_owner_databases_files_active_sessions_and_history_move_intact_to_personal(self):
        original = Path(self.session['path']).read_bytes()
        owner_request = self.repository.create_request(self.session_id, 'Private owner request')
        member_request = self.repository.create_request(self.member_session['session_id'], 'Private member request')
        result = self.delete()
        self.assertEqual(result, {'deleted': True, 'workspace_id': self.workspace_id,
                                  'personal_workspace_id': self.store.ensure_personal(self.owner)['workspace_id']})
        self.assertEqual(Path(self.session['path']).read_bytes(), original)
        self.assertEqual(self.rows(), [(1, 'first'), (2, 'second')])
        owner_session = self.repository.get_session(self.session_id, active_only=True)
        self.assertEqual(owner_session['database_id'], self.database_id)
        self.assertEqual(self.store.access(self.owner, self.database_id)['workspace_id'], result['personal_workspace_id'])
        self.assertEqual([request['request_id'] for request in workbench.history_for_session(self.session_id)], [owner_request])
        self.assertEqual([request['request_id'] for request in self.repository.history(self.member_session['session_id'])], [member_request])
        self.assertIsNotNone(self.repository.get_session(self.member_session['session_id'])['ended_at'])
        with self.repository._connection() as connection:
            for table in ('workspaces', 'workspace_members', 'workspace_grants', 'workspace_invitations'):
                self.assertEqual(connection.execute(f'SELECT COUNT(*) FROM {table} WHERE workspace_id=?',
                                                    (self.workspace_id,)).fetchone()[0], 0)
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_deleted_team_disappears_for_everyone_and_all_invitation_codes_stop_working(self):
        self.delete()
        for account_id in (self.owner, self.member, self.guest):
            listing = self.store.list_workspaces(account_id)
            self.assertNotIn(self.workspace_id, [workspace['workspace_id'] for workspace in listing['workspaces']])
            self.assertNotIn(self.pending_invitation['invitation_id'], [invite['invitation_id'] for invite in listing['invitations']])
            with self.assertRaises(PermissionError):
                self.store.get_workspace(account_id, self.workspace_id)
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.guest, self.pending_invitation['invitation_id'], self.pending_invitation['token'])
        with self.assertRaises(PermissionError):
            self.store.access(self.member, self.database_id)

    def test_pending_member_confirmation_remains_invalid_after_database_is_shared_again(self):
        pending = workbench.submit_request(self.member_session['session_id'], "UPDATE notes SET body='member change' WHERE id=1", raw_sql=True)
        self.assertTrue(pending['requires_confirmation'], pending)
        self.delete()
        with self.assertRaises((PermissionError, RepositoryError)):
            workbench.confirm_command(self.member_session['session_id'], pending['command_id'], pending['confirmation_token'])
        replacement = self.store.create_workspace(self.owner, 'Replacement team')['workspace_id']
        self.store.attach_database(self.owner, replacement, self.database_id)
        invitation = self.store.invite(self.owner, replacement, 'member@example.test')
        self.store.accept_invitation(self.member, invitation['invitation_id'], invitation['token'])
        self.store.set_grant(self.owner, replacement, self.member, self.database_id, {'read': True, 'write': True})
        with self.assertRaises(RepositoryError):
            workbench.confirm_command(self.member_session['session_id'], pending['command_id'], pending['confirmation_token'])
        self.assertEqual(self.rows(), [(1, 'first'), (2, 'second')])
        self.assertEqual(self.repository.get_command(pending['command_id'])['status'], 'pending')

    def test_owner_pending_confirmation_and_active_session_stay_usable(self):
        pending = workbench.submit_request(self.session_id, "UPDATE notes SET body='owner change' WHERE id=1", raw_sql=True)
        self.assertTrue(pending['requires_confirmation'], pending)
        self.delete()
        done = workbench.confirm_command(self.session_id, pending['command_id'], pending['confirmation_token'])
        self.assertEqual(done['status'], 'executed')
        self.assertEqual(self.rows(), [(1, 'owner change'), (2, 'second')])
        self.assertIsNone(self.repository.get_session(self.session_id)['ended_at'])

    def test_owner_confirmation_is_exact_and_failed_attempts_do_not_change_sharing(self):
        for name in (None, '', 'research team', 'Research Team ', ' Research Team', True):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.delete(name)
            self.assertEqual(self.store.access(self.member, self.database_id)['workspace_id'], self.workspace_id)
            self.assertIsNone(self.repository.get_session(self.member_session['session_id'])['ended_at'])
        with self.assertRaises(PermissionError):
            self.store.delete_workspace(self.member, self.workspace_id, 'Research Team')
        with self.assertRaises(PermissionError):
            self.store.delete_workspace(self.guest, self.workspace_id, 'Research Team')
        personal = self.store.ensure_personal(self.owner)
        with self.assertRaises(ValueError):
            self.store.delete_workspace(self.owner, personal['workspace_id'], personal['name'])
        self.assertEqual(self.store.access(self.member, self.database_id)['workspace_id'], self.workspace_id)

    def test_failed_delete_rolls_back_database_moves_session_endings_and_grant_removal(self):
        with self.repository._connection(write=True) as connection:
            connection.execute('''CREATE TRIGGER prevent_team_delete BEFORE DELETE ON workspaces
                WHEN OLD.kind='team' BEGIN SELECT RAISE(ABORT,'fixture delete failure'); END''')
        with self.assertRaises(sqlite3.IntegrityError):
            self.delete()
        self.assertEqual(self.store.access(self.member, self.database_id)['workspace_id'], self.workspace_id)
        self.assertIsNone(self.repository.get_session(self.member_session['session_id'])['ended_at'])
        self.assertEqual(self.rows(), [(1, 'first'), (2, 'second')])
        self.assertEqual(self.store.list_workspaces(self.guest)['invitations'][0]['invitation_id'],
                         self.pending_invitation['invitation_id'])
        self.assertEqual(self.store.get_workspace(self.owner, self.workspace_id)['databases'][0]['database_id'],
                         self.database_id)

    def test_all_sqlite_and_external_databases_move_without_removing_saved_connections(self):
        external = self.repository.create_external_session(self.owner, 'Live database', 'encrypted-connection-fixture')
        self.store.attach_database(self.owner, self.workspace_id, external['database_id'])
        self.store.set_grant(self.owner, self.workspace_id, self.member, external['database_id'], {'read': True})
        shared = self.store.open_database(self.member, self.workspace_id, external['database_id'])
        result = self.delete()
        personal = self.store.get_workspace(self.owner, result['personal_workspace_id'])
        self.assertEqual({database['database_id'] for database in personal['databases']}, {self.database_id, external['database_id']})
        self.assertEqual(self.store.access(self.owner, external['database_id'])['workspace_id'], result['personal_workspace_id'])
        self.assertEqual(self.repository.external_connection(external['connection_id'], self.owner), 'encrypted-connection-fixture')
        self.assertIsNone(self.repository.get_session(external['session_id'])['ended_at'])
        self.assertIsNotNone(self.repository.get_session(shared['session_id'])['ended_at'])

    def test_delete_is_serialized_with_member_confirmation(self):
        pending = workbench.submit_request(self.member_session['session_id'], "UPDATE notes SET body='blocked' WHERE id=1", raw_sql=True)
        waiting = Event()
        database_lock = workbench._lock(Path(self.session['path']).resolve())
        def confirm():
            waiting.set()
            try:
                return workbench.confirm_command(self.member_session['session_id'], pending['command_id'], pending['confirmation_token'])
            except (PermissionError, RepositoryError):
                return None
        with ThreadPoolExecutor(max_workers=1) as pool:
            with database_lock:
                future = pool.submit(confirm)
                self.assertTrue(waiting.wait(timeout=1))
                self.delete()
            self.assertIsNone(future.result(timeout=2))
        self.assertEqual(self.rows(), [(1, 'first'), (2, 'second')])


if __name__ == '__main__':
    unittest.main()
