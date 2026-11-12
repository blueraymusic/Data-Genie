"""Delete an account's databases and credentials while retaining shared reports.

Metadata changes are one SQLite transaction. Managed SQLite copies are staged
by rename so a database failure can restore them. A small cleanup queue retries
file removal after commit. External PostgreSQL servers are never contacted.
"""
import logging
from pathlib import Path
import re
import secrets
import time

from .authentication import Accounts, LoginRequired, token_hash
from .workspaces import AUTHORIZATION_LOCK, WorkspaceStore


class AccountDeletion:
    def __init__(self, repository, directories):
        self.repository = repository
        self.directories = tuple(Path(path).resolve() for path in directories)

    @staticmethod
    def _transfer(connection, account_id, transfers):
        if not isinstance(transfers, dict) or len(transfers) > 100:
            raise ValueError('Choose a valid workspace transfer.')
        for workspace_id, target_id in transfers.items():
            workspace = WorkspaceStore._membership(connection, account_id, workspace_id, owner=True)
            if workspace['kind'] != 'team' or type(target_id) is not int or target_id == account_id:
                raise ValueError('Transfer a team workspace to another existing member.')
            WorkspaceStore._membership(connection, target_id, workspace_id)
            connection.execute("UPDATE workspace_members SET role='member' WHERE workspace_id=? AND account_id=?", (workspace_id, account_id))
            connection.execute("UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND account_id=?", (workspace_id, target_id))
            connection.execute('UPDATE workspaces SET owner_account_id=? WHERE workspace_id=?', (target_id, workspace_id))
            connection.execute('''UPDATE external_connections SET account_id=? WHERE account_id=? AND connection_id IN
                (SELECT d.connection_id FROM databases d JOIN workspace_databases wd USING(database_id) WHERE wd.workspace_id=?)''', (target_id, account_id, workspace_id))
            connection.execute('UPDATE workspace_databases SET owner_account_id=? WHERE workspace_id=? AND owner_account_id=?', (target_id, workspace_id, account_id))

    @staticmethod
    def _prepare(connection, account_id):
        connection.execute('CREATE TEMP TABLE delete_workspaces AS SELECT workspace_id FROM workspaces WHERE owner_account_id=?', (account_id,))
        connection.execute('''CREATE TEMP TABLE delete_databases AS SELECT d.* FROM databases d
            LEFT JOIN workspace_databases wd USING(database_id)
            LEFT JOIN external_connections e USING(connection_id)
            WHERE wd.owner_account_id=? OR wd.workspace_id IN (SELECT workspace_id FROM delete_workspaces)
            OR e.account_id=? OR (wd.database_id IS NULL AND
                (SELECT s.account_id FROM sessions s WHERE s.database_id=d.database_id
                 AND s.account_id IS NOT NULL ORDER BY s.rowid LIMIT 1)=?)''', (account_id, account_id, account_id))
        connection.execute('''CREATE TEMP TABLE delete_sessions AS SELECT session_id FROM sessions
            WHERE account_id=? OR database_id IN (SELECT database_id FROM delete_databases)''', (account_id,))
        connection.execute('CREATE TEMP TABLE delete_requests AS SELECT request_id FROM requests WHERE session_id IN (SELECT session_id FROM delete_sessions)')
        connection.execute('CREATE TEMP TABLE delete_commands AS SELECT command_id FROM sql_commands WHERE request_id IN (SELECT request_id FROM delete_requests)')
        connection.execute('CREATE TEMP TABLE delete_tables AS SELECT table_id FROM schema_tables WHERE database_id IN (SELECT database_id FROM delete_databases)')

    def summary(self, account_id):
        with AUTHORIZATION_LOCK, self.repository._connection() as connection:
            self._prepare(connection, account_id)
            return {
                'databases': connection.execute('SELECT COUNT(*) FROM delete_databases').fetchone()[0],
                'workspaces': [{
                    'workspace_id': row['workspace_id'], 'name': row['name'],
                    'members': [dict(member) for member in connection.execute('''SELECT a.account_id,a.first_name,a.last_name,a.email
                        FROM workspace_members m JOIN accounts a USING(account_id) WHERE m.workspace_id=? AND m.account_id<>?''', (row['workspace_id'], account_id))],
                } for row in connection.execute("SELECT * FROM workspaces WHERE owner_account_id=? AND kind='team'", (account_id,))],
                'shared_reports': connection.execute('''SELECT COUNT(*) FROM workspace_reports WHERE published=1
                    AND (author_id=? OR workspace_id IN (SELECT workspace_id FROM delete_workspaces))''', (account_id,)).fetchone()[0],
            }

    def _managed(self, path):
        return not path.is_symlink() and any(path.resolve().is_relative_to(root) for root in self.directories)

    def cleanup(self):
        with self.repository._connection() as connection:
            paths = [row[0] for row in connection.execute('SELECT path FROM account_file_deletions LIMIT 1000')]
        for value in paths:
            path = Path(value)
            if not re.search(r'\.account-delete-[0-9a-f]{32}$', path.name) or not self._managed(path):
                continue
            try:
                path.unlink(missing_ok=True)
                with self.repository._connection(write=True) as connection:
                    connection.execute('DELETE FROM account_file_deletions WHERE path=?', (value,))
            except OSError:
                logging.getLogger(__name__).warning('Account database file cleanup deferred.')

    def delete(self, account_id, payload, login_token, client):
        # Password verification has the same server-side attempt budget as login.
        with self.repository._connection() as connection:
            account = Accounts._account(connection, 'account_id', account_id)
        if not account:
            raise LoginRequired('Log in to continue.')
        if str(payload.get('email') or '').strip().lower() != account['email'] or payload.get('confirmation') != 'DELETE':
            raise ValueError('Enter your account email and type DELETE to confirm.')
        if account['password_hash'].startswith('pbkdf2_sha256$'):
            Accounts(self.repository).verify_password(account_id, payload.get('password'), client)
        else:
            with self.repository._connection() as connection:
                login = connection.execute('SELECT created_at FROM browser_logins WHERE token_hash=? AND account_id=?', (token_hash(login_token), account_id)).fetchone()
            if not account['microsoft_linked'] or not login or time.time() - login['created_at'] > 300:
                raise ValueError('Log out and sign in with Microsoft again, then delete your account within five minutes.')
        staged = []
        try:
            with AUTHORIZATION_LOCK, self.repository._connection(write=True) as connection:
                # Recheck credentials and current login inside the mutation lock.
                current = Accounts._account(connection, 'account_id', account_id)
                login = connection.execute('SELECT 1 FROM browser_logins WHERE token_hash=? AND account_id=?', (token_hash(login_token), account_id)).fetchone()
                if not current or not login or current['password_hash'] != account['password_hash']:
                    raise LoginRequired('Log in again before deleting your account.')
                self._transfer(connection, account_id, payload.get('transfers', {}))
                self._prepare(connection, account_id)
                for row in connection.execute('SELECT path FROM delete_databases WHERE connection_id IS NULL'):
                    original = Path(row['path'])
                    if not self._managed(original):
                        continue
                    for path in [original, *[Path(str(original) + suffix) for suffix in ('-wal', '-shm', '-journal')]]:
                        if path.is_file() and self._managed(path):
                            destination = path.with_name(path.name + '.account-delete-' + secrets.token_hex(16))
                            path.rename(destination)
                            staged.append((path, destination))
                            connection.execute('INSERT INTO account_file_deletions VALUES(?)', (str(destination),))
                # An anonymous, non-login identity retains report attribution.
                cursor = connection.execute("INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES('Deleted','account',?,'!deleted',?)", ('deleted-' + secrets.token_hex(16) + '@accounts.invalid', int(time.time())))
                tombstone = cursor.lastrowid
                connection.execute('UPDATE workspace_reports SET author_id=? WHERE author_id=?', (tombstone, account_id))
                connection.execute('''UPDATE workspaces SET owner_account_id=?,archived_at=?
                    WHERE workspace_id IN (SELECT workspace_id FROM delete_workspaces) AND kind='team'
                    AND EXISTS(SELECT 1 FROM workspace_reports r WHERE r.workspace_id=workspaces.workspace_id )
                    AND EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=workspaces.workspace_id AND m.account_id<>?)''', (tombstone, int(time.time()), account_id))
                connection.execute("INSERT INTO workspace_members(workspace_id,account_id,role,joined_at) SELECT workspace_id,?,'owner',? FROM workspaces WHERE owner_account_id=?", (tombstone, int(time.time()), tombstone))
                # Private drafts in an archived owned workspace have no remaining
                # author/owner login. Do not expose them to other members.
                connection.execute('DELETE FROM workspace_reports WHERE published=0 AND author_id=? AND workspace_id IN (SELECT workspace_id FROM delete_workspaces)', (tombstone,))
                for table in ('results', 'ddl_commands', 'dml_commands', 'select_commands'):
                    connection.execute(f'DELETE FROM {table} WHERE command_id IN (SELECT command_id FROM delete_commands)')
                connection.execute('DELETE FROM command_targets WHERE command_id IN (SELECT command_id FROM delete_commands) OR table_id IN (SELECT table_id FROM delete_tables)')
                connection.execute('DELETE FROM sql_commands WHERE command_id IN (SELECT command_id FROM delete_commands)')
                connection.execute('DELETE FROM requests WHERE request_id IN (SELECT request_id FROM delete_requests)')
                connection.execute('DELETE FROM agent_sessions WHERE session_id IN (SELECT session_id FROM delete_sessions) OR database_id IN (SELECT database_id FROM delete_databases)')
                connection.execute('DELETE FROM sessions WHERE session_id IN (SELECT session_id FROM delete_sessions)')
                connection.execute('DELETE FROM column_references WHERE table_id IN (SELECT table_id FROM delete_tables) OR referenced_table_id IN (SELECT table_id FROM delete_tables)')
                connection.execute('DELETE FROM column_constraints WHERE table_id IN (SELECT table_id FROM delete_tables)')
                connection.execute('DELETE FROM schema_columns WHERE table_id IN (SELECT table_id FROM delete_tables)')
                connection.execute('DELETE FROM schema_tables WHERE table_id IN (SELECT table_id FROM delete_tables)')
                connection.execute('DELETE FROM workspace_databases WHERE database_id IN (SELECT database_id FROM delete_databases)')
                connection.execute('DELETE FROM databases WHERE database_id IN (SELECT database_id FROM delete_databases)')
                connection.execute('DELETE FROM agent_tokens WHERE account_id=? OR workspace_id IN (SELECT workspace_id FROM delete_workspaces)', (account_id,))
                connection.execute('DELETE FROM workspace_invitations WHERE invited_by=? OR email=? COLLATE NOCASE OR workspace_id IN (SELECT workspace_id FROM delete_workspaces)', (account_id, account['email']))
                connection.execute('DELETE FROM workspace_members WHERE account_id=?', (account_id,))
                connection.execute('DELETE FROM workspaces WHERE owner_account_id=?', (account_id,))
                # Remove an archive when its final real member leaves by deleting
                # their account; anonymous report attribution is not a member.
                connection.execute("""DELETE FROM workspaces WHERE archived_at IS NOT NULL
                    AND NOT EXISTS(SELECT 1 FROM workspace_members m JOIN accounts a USING(account_id)
                        WHERE m.workspace_id=workspaces.workspace_id AND a.password_hash<>'!deleted')""")
                for table in ('external_connections', 'browser_logins', 'external_identities', 'microsoft_auth_flows'):
                    connection.execute(f'DELETE FROM {table} WHERE account_id=?', (account_id,))
                connection.execute('DELETE FROM users WHERE email=? AND NOT EXISTS(SELECT 1 FROM sessions WHERE sessions.user_id=users.user_id)', (account['email'],))
                connection.execute("UPDATE users SET first_name='Deleted',last_name='account',email=? WHERE email=?", ('deleted-' + secrets.token_hex(16) + '@accounts.invalid', account['email']))
                connection.execute('DELETE FROM accounts WHERE account_id=?', (account_id,))
                if not connection.execute('SELECT 1 FROM workspace_reports WHERE author_id=? UNION ALL SELECT 1 FROM workspaces WHERE owner_account_id=?', (tombstone, tombstone)).fetchone():
                    connection.execute('DELETE FROM accounts WHERE account_id=?', (tombstone,))
                connection.execute("""DELETE FROM accounts WHERE password_hash='!deleted'
                    AND NOT EXISTS(SELECT 1 FROM workspace_reports r WHERE r.author_id=accounts.account_id)
                    AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.owner_account_id=accounts.account_id)""")
        except Exception:
            for original, destination in reversed(staged):
                if destination.exists():
                    destination.rename(original)
            raise
        self.cleanup()
        return {'deleted': True}
