"""Frequent browser polls reuse structural metadata and detect committed edits."""

from contextlib import closing
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

from backend import workbench
from backend.workspaces import WorkspaceStore
from tests.test_http import HttpHarness


class MetadataCacheTests(HttpHarness, unittest.TestCase):
    def setUp(self):
        super().setUp()
        with workbench._metadata_cache_lock:
            workbench._sqlite_details_cache.clear()
            workbench._sqlite_sync_cache.clear()

    def status(self):
        status, result = self.request('GET', '/api/status', session_id=self.session_id)
        self.assertEqual(status, 200, result)
        return result

    def test_unchanged_status_does_not_recount_and_schema_sync_keeps_table_ids(self):
        original = workbench.Conn.execute
        counts = []
        def traced(connection, sql, *args, **kwargs):
            if sql.upper().startswith('SELECT COUNT(*)'):
                counts.append(sql)
            return original(connection, sql, *args, **kwargs)
        with patch.object(workbench.Conn, 'execute', traced):
            first = self.status()
            self.assertEqual(first['table_details'][0]['row_count'], 2)
            self.assertEqual(len(counts), 1)
            self.assertEqual(self.status()['table_details'], first['table_details'])
            self.assertEqual(len(counts), 1)
        repository = workbench.get_repository()
        with patch.object(repository, 'sync_schema', wraps=repository.sync_schema) as sync:
            first = workbench.schema_for_session(self.session_id)
            second = workbench.schema_for_session(self.session_id)
        self.assertEqual(sync.call_count, 1)
        self.assertEqual(first['tables'], second['tables'])
        self.assertGreater(first['tables'][0]['table_id'], 0)

    def test_external_commit_updates_counts_columns_and_repository_schema(self):
        first = self.status()
        workbench.schema_for_session(self.session_id)
        with closing(sqlite3.connect(self.session['path'])) as connection:
            connection.executescript("INSERT INTO notes VALUES(3,'external'); ALTER TABLE notes ADD COLUMN note TEXT;")
            connection.commit()
        changed = self.status()
        self.assertEqual(changed['table_details'][0]['row_count'], 3)
        self.assertEqual(len(changed['table_details'][0]['columns']), len(first['table_details'][0]['columns']) + 1)
        synced = workbench.schema_for_session(self.session_id)
        self.assertTrue(any(column['name'] == 'note' for column in synced['tables'][0]['columns']))

    def test_uncheckpointed_wal_commit_invalidates_unchanged_main_file(self):
        path = Path(self.session['path'])
        with closing(sqlite3.connect(path)) as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('PRAGMA wal_autocheckpoint=0')
            connection.commit()
            self.assertEqual(self.status()['table_details'][0]['row_count'], 2)
            main_before = path.stat().st_mtime_ns, path.stat().st_size
            connection.execute("INSERT INTO notes VALUES(3,'uncheckpointed')")
            connection.commit()
            self.assertEqual((path.stat().st_mtime_ns, path.stat().st_size), main_before)
            self.assertEqual(self.status()['table_details'][0]['row_count'], 3)

    def test_cached_results_are_copied_and_cache_size_is_bounded(self):
        self.status()
        with workbench.session_scope(self.session_id):
            first = workbench.table_schema('notes')
            first['columns'][0]['name'] = 'mutated'
            self.assertEqual(workbench.table_schema('notes')['columns'][0]['name'], 'id')
        with patch.object(workbench, 'SQLITE_METADATA_CACHE_ENTRIES', 3):
            for index in range(10):
                workbench._cache_metadata(workbench._sqlite_details_cache, ('fake', index), {'name': str(index)})
        self.assertEqual(len(workbench._sqlite_details_cache), 3)

    def test_cached_metadata_never_bypasses_live_permissions(self):
        store = WorkspaceStore(workbench.get_repository())
        owner = self.account['account_id']
        team = store.create_workspace(owner, 'Team')['workspace_id']
        store.attach_database(owner, team, self.session['database_id'])
        self.status()
        workbench.schema_for_session(self.session_id)
        status, auth = self.request('POST', '/api/auth/register', {'first_name': 'Member', 'last_name': 'Person', 'email': 'member@example.com', 'password': self.password})
        self.assertEqual(status, 201, auth)
        member = auth['user']['account_id']
        invitation = store.invite(owner, team, 'member@example.com')
        store.accept_invitation(member, invitation['invitation_id'], invitation['token'])
        store.set_grant(owner, team, member, self.session['database_id'], {'read': True})
        shared = store.open_database(member, team, self.session['database_id'])
        self.assertEqual(workbench.schema_for_session(shared['session_id'])['tables'][0]['name'], 'notes')
        store.set_grant(owner, team, member, self.session['database_id'], {})
        with self.assertRaises(PermissionError):
            workbench.schema_for_session(shared['session_id'])
        with self.assertRaises(PermissionError):
            with workbench.session_scope(shared['session_id']):
                workbench.table_schema('notes')


if __name__ == '__main__':
    unittest.main()
