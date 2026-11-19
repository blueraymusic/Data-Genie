"""Downloads target a database explicitly; removal and name checks are authorized."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextlib import closing
import io
from pathlib import Path
import sqlite3
import unittest
import zipfile
from threading import Event, Thread
from unittest.mock import patch

from backend import workbench, workspace_api
from backend.database_lifecycle import export_database, remove_database
from backend.workspaces import WorkspaceStore, AUTHORIZATION_LOCK
from backend.connections.vault import CredentialVault
from tests.test_http import HttpHarness


class DatabaseLifecycleTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.repository = workbench.get_repository()
        self.store = WorkspaceStore(self.repository)
        self.personal = self.store.ensure_personal(self.account['account_id'])['workspace_id']

    def create(self, name):
        status, result = self.request('POST', '/api/sessions', {'database_mode': 'create', 'database_name': name})
        self.assertEqual(status, 201, result)
        return result

    def test_download_uses_database_id_even_when_another_database_is_active(self):
        other = self.create('Other')
        with closing(sqlite3.connect(self.session['path'])) as connection:
            connection.execute("UPDATE notes SET body='changed and saved' WHERE id=1")
            connection.commit()
        status, content = self.request('GET', f"/api/databases/{self.session['database_id']}/download", session_id=other['session_id'], raw=True)
        self.assertEqual(status, 200)
        download = self.root / 'download.sqlite3'
        download.write_bytes(content)
        with closing(sqlite3.connect(download)) as connection:
            self.assertEqual(connection.execute('SELECT body FROM notes WHERE id=1').fetchone()[0], 'changed and saved')
        self.assertEqual(self.repository.get_session(other['session_id'])['database_id'], other['database_id'])

    def test_csv_folder_and_sql_dump_include_all_tables_and_current_state(self):
        with closing(sqlite3.connect(self.session['path'])) as connection:
            connection.executescript('CREATE TABLE "../strange"(value TEXT); INSERT INTO "../strange" VALUES(\'=1+1\');')
            connection.commit()
        base = f"/api/databases/{self.session['database_id']}/download"
        status, content = self.request('GET', base + '?format=csv', raw=True)
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertIn('schema.sql', archive.namelist())
            csv_files = [name for name in archive.namelist() if name.endswith('.csv')]
            self.assertEqual(len(csv_files), 2)
            self.assertTrue(all('/' not in name and '..' not in name for name in csv_files))
            self.assertTrue(any("'=1+1" in archive.read(name).decode('utf-8-sig') for name in csv_files))
        status, content = self.request('GET', base + '?format=sql', raw=True)
        self.assertEqual(status, 200)
        with closing(sqlite3.connect(':memory:')) as restored:
            restored.executescript(content.decode())
            self.assertEqual(restored.execute('SELECT COUNT(*) FROM notes').fetchone()[0], 2)
            self.assertEqual(restored.execute('SELECT * FROM "../strange"').fetchone()[0], '=1+1')

    def test_duplicate_names_are_case_insensitive_scoped_and_atomic(self):
        before = len(self.repository.list_sessions(account_id=self.account['account_id']))
        status, result = self.request('POST', '/api/sessions', {'database_mode': 'create', 'database_name': ' DEMO.SQLITE3 '})
        self.assertEqual(status, 400, result)
        self.assertIn('already exists', result['error'])
        self.assertEqual(len(self.repository.list_sessions(account_id=self.account['account_id'])), before)
        team = self.store.create_workspace(self.account['account_id'], 'Team')
        status, other = self.request('POST', '/api/sessions', {'database_mode': 'create', 'database_name': 'demo.sqlite3', 'workspace_id': team['workspace_id']})
        self.assertEqual(status, 201, other)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.store.attach_database(self.account['account_id'], team['workspace_id'], self.session['database_id'])
        self.assertEqual(self.store.access(self.account['account_id'], self.session['database_id'])['workspace_id'], self.personal)

    def test_concurrent_creations_reserve_one_name(self):
        def create(_):
            try:
                return workspace_api.create_database(self.account, {'database_mode': 'create', 'database_name': 'Concurrent'})
            except ValueError as error:
                return str(error)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, range(2)))
        self.assertEqual(sum(isinstance(item, dict) for item in results), 1)
        self.assertEqual(sum(isinstance(item, str) and 'already exists' in item for item in results), 1)

    def test_reset_samples_and_deleting_teams_keep_distinct_names(self):
        first = self.request('POST', '/api/reset', {}, self.session_id)[1]
        second = self.request('POST', '/api/reset', {}, first['session_id'])[1]
        self.assertEqual(first['database'], 'shop.sqlite')
        self.assertEqual(second['database'], 'shop (2).sqlite')
        team = self.store.create_workspace(self.account['account_id'], 'Team')
        status, duplicate = self.request('POST', '/api/sessions', {'database_mode': 'create', 'database_name': 'demo.sqlite3', 'workspace_id': team['workspace_id']})
        self.assertEqual(status, 201, duplicate)
        result = self.store.delete_workspace(self.account['account_id'], team['workspace_id'], 'Team')
        self.assertEqual(result['renamed_databases'], [{'database_id': duplicate['database_id'], 'database': 'demo (2).sqlite3'}])
        self.assertTrue(Path(duplicate['path']).is_file())

    def test_remove_requires_owner_and_exact_confirmation_and_removes_managed_copy(self):
        request = workbench.submit_request(self.session_id, 'SELECT * FROM notes', raw_sql=True)
        self.assertTrue(request['matched'])
        path = Path(self.session['path'])
        status, result = self.request('POST', f"/api/databases/{self.session['database_id']}/delete", {'name': 'wrong'})
        self.assertEqual(status, 400, result)
        self.assertTrue(path.is_file())
        status, result = self.request('POST', f"/api/databases/{self.session['database_id']}/delete", {'name': self.session['database']})
        self.assertEqual(status, 200, result)
        self.assertFalse(path.exists())
        self.assertEqual(self.store.get_workspace(self.account['account_id'], self.personal)['databases'], [])
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 0)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM requests').fetchone()[0], 0)
        status, result = self.request('GET', '/api/status', session_id=self.session_id)
        self.assertEqual(result['code'], 'session_unavailable')

    def test_unauthorized_accounts_cannot_export_or_remove(self):
        status, other = self.request('POST', '/api/auth/register', {'first_name': 'Other', 'last_name': 'Person', 'email': 'other@example.com', 'password': self.password})
        self.assertEqual(status, 201, other)
        for path, payload in [(f"/api/databases/{self.session['database_id']}/download", None),
                              (f"/api/databases/{self.session['database_id']}/delete", {'name': self.session['database']})]:
            status, result = self.request('GET' if payload is None else 'POST', path, payload)
            self.assertEqual(status, 403, result)

    def test_postgresql_csv_export_writes_values_and_removal_never_contacts_server(self):
        config = {'schema_name': 'public', 'name': 'Remote', 'dbname': 'sales'}
        encrypted = CredentialVault(self.repository.path).encrypt(config)
        session = self.repository.create_external_session(self.account['account_id'], 'Remote', encrypted)
        self.store.ensure_personal(self.account['account_id'])
        class Column:
            name = 'amount'
        class Cursor:
            description = [Column()]
            batch = 0
            def fetchmany(self, _):
                self.batch += 1
                return [{'amount': '1234.50'}] if self.batch == 1 else []
            def execute(self, _):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
        class Connector:
            def __init__(self, _):
                pass
            def schema(self):
                return [{'name': 'orders', 'columns': [{'name': 'amount'}]}]
            @contextmanager
            def connection(self, read_only=False):
                yield self
            def execute(self, _):
                return Cursor()
            def cursor(self, name):
                self.name = name
                return Cursor()
            def commit(self):
                pass
        destination = self.root / 'remote.zip'
        with patch('backend.database_lifecycle.PostgresConnector', Connector):
            export_database(self.repository, self.account['account_id'], session['database_id'], destination, 'csv')
        with zipfile.ZipFile(destination) as archive:
            self.assertEqual(archive.read('001-orders.csv').decode('utf-8-sig'), 'amount\r\n1234.50\r\n')
            self.assertIn('schema.json', archive.namelist())
        with patch('backend.database_lifecycle.PostgresConnector', side_effect=AssertionError('must not connect')):
            remove_database(self.repository, self.account['account_id'], session['database_id'], 'Remote')
        with self.repository._connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM external_connections WHERE connection_id=?', (session['connection_id'],)).fetchone())
            self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_export_limit_refuses_a_large_snapshot_without_sending_partial_data(self):
        with patch('backend.database_lifecycle.MAX_EXPORT_BYTES', 100):
            status, result = self.request('GET', f"/api/databases/{self.session['database_id']}/download")
        self.assertEqual(status, 400, result)
        self.assertIn('download limit', result['error'])

    def test_csv_budget_counts_formula_text_and_blob_expansion(self):
        with closing(sqlite3.connect(self.session['path'])) as connection:
            connection.execute('CREATE TABLE blobs(value BLOB)')
            connection.execute('INSERT INTO blobs VALUES(?)', (b'x' * 20000,))
            connection.commit()
        size = Path(self.session['path']).stat().st_size
        with patch('backend.database_lifecycle.MAX_EXPORT_BYTES', size + 1):
            status, result = self.request('GET', f"/api/databases/{self.session['database_id']}/download?format=csv")
        self.assertEqual(status, 400, result)
        self.assertIn('download limit', result['error'])

    def test_stale_database_identity_cannot_export_or_remove_a_reused_id(self):
        original = Path(self.session['path'])
        replacement = self.root / 'replacement.sqlite3'
        with closing(sqlite3.connect(replacement)) as connection:
            connection.execute('CREATE TABLE replacement(value TEXT)')
        real_lock = workbench._lock
        @contextmanager
        def changed_identity(path):
            with real_lock(path):
                with self.repository._connection(write=True) as connection:
                    connection.execute('UPDATE databases SET path=? WHERE database_id=?', (str(replacement), self.session['database_id']))
                yield
        for action in ('export', 'remove'):
            with self.repository._connection(write=True) as connection:
                connection.execute('UPDATE databases SET path=? WHERE database_id=?', (str(original), self.session['database_id']))
            with self.subTest(action=action), patch.object(workbench, '_lock', changed_identity), self.assertRaisesRegex(ValueError, 'database changed'):
                if action == 'export':
                    export_database(self.repository, self.account['account_id'], self.session['database_id'], self.root / 'stale.sqlite3')
                else:
                    remove_database(self.repository, self.account['account_id'], self.session['database_id'], self.session['database'])
            self.assertTrue(original.is_file())
            self.assertTrue(replacement.is_file())
            self.assertFalse((self.root / 'stale.sqlite3').exists())

    def test_creation_waits_for_database_before_holding_authorization_lock(self):
        held, attempted, authorized = Event(), Event(), Event()
        real_lock = workbench._lock
        def observer(path):
            attempted.set()
            return real_lock(path)
        def reader():
            with real_lock(self.session['path']):
                held.set()
                if not attempted.wait(3):
                    return
                acquired = AUTHORIZATION_LOCK.acquire(timeout=2)
                if acquired:
                    authorized.set()
                    AUTHORIZATION_LOCK.release()
        thread = Thread(target=reader)
        thread.start()
        self.assertTrue(held.wait(3))
        try:
            with patch.object(workbench, '_lock', observer):
                status, result = self.request('POST', '/api/databases', {'name': 'No lock inversion'}, self.session_id)
            self.assertEqual(status, 201, result)
            self.assertTrue(authorized.is_set(), 'Database operations must not wait for the database while holding AUTHORIZATION_LOCK.')
        finally:
            attempted.set()
            thread.join(timeout=5)
        self.assertFalse(thread.is_alive())

    def test_moving_ends_member_sessions_and_cannot_reactivate_pending_changes(self):
        team = self.store.create_workspace(self.account['account_id'], 'Team')['workspace_id']
        self.store.attach_database(self.account['account_id'], team, self.session['database_id'])
        self.request('POST', '/api/auth/register', {'first_name': 'Member', 'last_name': 'Person', 'email': 'member@example.com', 'password': self.password})
        with self.repository._connection() as connection:
            member = connection.execute("SELECT account_id FROM accounts WHERE email='member@example.com'").fetchone()[0]
        invitation = self.store.invite(self.account['account_id'], team, 'member@example.com')
        self.store.accept_invitation(member, invitation['invitation_id'], invitation['token'])
        self.store.set_grant(self.account['account_id'], team, member, self.session['database_id'], {'read': True, 'write': True})
        shared = self.store.open_database(member, team, self.session['database_id'])
        pending = workbench.submit_request(shared['session_id'], "UPDATE notes SET body='bad'", raw_sql=True)
        self.store.attach_database(self.account['account_id'], self.personal, self.session['database_id'])
        self.assertIsNotNone(self.repository.get_session(shared['session_id'])['ended_at'])
        self.store.attach_database(self.account['account_id'], team, self.session['database_id'])
        self.store.set_grant(self.account['account_id'], team, member, self.session['database_id'], {'read': True, 'write': True})
        with self.assertRaises(ValueError):
            workbench.confirm_command(shared['session_id'], pending['command_id'], pending['confirmation_token'])


if __name__ == '__main__':
    unittest.main()
