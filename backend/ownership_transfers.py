"""Workspace ownership moves only after the named recipient accepts."""
import hashlib
import json
import secrets
import time

from .authentication import Accounts, LoginRequired, token_hash
from .workspaces import WorkspaceStore, AUTHORIZATION_LOCK

LIFETIME = 7 * 24 * 60 * 60


class OwnershipTransfers(WorkspaceStore):
    @staticmethod
    def public(connection, row):
        result = dict(row)
        if result['status'] == 'pending' and result['expires_at'] <= time.time():
            result['status'] = 'expired'
        for prefix, account_id in (('sender', row['sender_account_id']), ('recipient', row['recipient_account_id'])):
            account = connection.execute('SELECT first_name,last_name,email FROM accounts WHERE account_id=?', (account_id,)).fetchone()
            result[prefix] = dict(account) if account else {'first_name': 'Deleted', 'last_name': 'account', 'email': ''}
        return result

    @classmethod
    def inbox(cls, connection, account_id):
        rows = connection.execute('''SELECT t.* FROM ownership_transfers t JOIN workspaces w USING(workspace_id)
            JOIN workspace_members m ON m.workspace_id=t.workspace_id AND m.account_id=t.recipient_account_id
            WHERE t.recipient_account_id=? AND t.status='pending' AND t.expires_at>?
            AND w.owner_account_id=t.sender_account_id AND w.archived_at IS NULL ORDER BY t.created_at DESC''', (account_id, int(time.time())))
        return [cls.public(connection, row) for row in rows]

    @classmethod
    def outgoing(cls, connection, workspace_id):
        row = connection.execute('SELECT * FROM ownership_transfers WHERE workspace_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', (workspace_id,)).fetchone()
        return cls.public(connection, row) if row else None

    def reauthenticate(self, account_id, password, login_token, client):
        with self.repository._connection() as connection:
            account = Accounts._account(connection, 'account_id', account_id)
            login = connection.execute('SELECT * FROM browser_logins WHERE token_hash=? AND account_id=?', (token_hash(login_token), account_id)).fetchone()
        if not account or not login:
            raise LoginRequired('Log in to continue.')
        if account['password_hash'].startswith('pbkdf2_sha256$'):
            Accounts(self.repository).verify_password(account_id, password, client)
        elif not account['microsoft_linked'] or time.time() - login['created_at'] > 300:
            raise ValueError('Log out and sign in with Microsoft again, then confirm within five minutes.')
        return account['password_hash']

    @staticmethod
    def recheck(connection, account_id, credential, login_token):
        account = Accounts._account(connection, 'account_id', account_id)
        login = connection.execute('SELECT 1 FROM browser_logins WHERE token_hash=? AND account_id=?', (token_hash(login_token), account_id)).fetchone()
        if not account or not login or account['password_hash'] != credential:
            raise LoginRequired('Log in again before confirming ownership.')

    @staticmethod
    def inventory(connection, row):
        databases = [dict(item) for item in connection.execute('''SELECT d.database_id,d.connection_id,e.encrypted_config
            FROM workspace_databases wd JOIN databases d USING(database_id)
            LEFT JOIN external_connections e USING(connection_id) WHERE wd.workspace_id=? ORDER BY d.database_id''', (row['workspace_id'],))]
        members = [tuple(item) for item in connection.execute('SELECT account_id,role FROM workspace_members WHERE workspace_id=? ORDER BY account_id', (row['workspace_id'],))]
        fingerprint = hashlib.sha256(json.dumps([row['transfer_id'], databases, members], sort_keys=True).encode()).hexdigest()
        return {'databases': len(databases), 'postgres_connections': sum(bool(item['connection_id']) for item in databases), 'members': len(members), 'review_version': fingerprint}

    def create(self, account_id, workspace_id, payload, login_token, client):
        with AUTHORIZATION_LOCK, self.repository._connection() as connection:
            self._membership(connection, account_id, workspace_id, owner=True)
        credential = self.reauthenticate(account_id, payload.get('password'), login_token, client)
        target = payload.get('recipient_account_id')
        if type(target) is not int or target == account_id:
            raise ValueError('Choose another existing workspace member.')
        with AUTHORIZATION_LOCK, self.repository._connection(write=True) as connection:
            self.recheck(connection, account_id, credential, login_token)
            workspace = self._membership(connection, account_id, workspace_id, owner=True)
            if workspace['kind'] != 'team' or payload.get('name') != workspace['name']:
                raise ValueError('Type the team workspace name exactly to request a transfer.')
            self._membership(connection, target, workspace_id)
            now = int(time.time())
            connection.execute("UPDATE ownership_transfers SET status='cancelled',decided_at=? WHERE workspace_id=? AND status='pending' AND expires_at<=?", (now, workspace_id, now))
            if connection.execute("SELECT 1 FROM ownership_transfers WHERE workspace_id=? AND status='pending'", (workspace_id,)).fetchone():
                raise ValueError('An ownership request is already pending. Cancel it before sending another.')
            transfer_id = secrets.token_urlsafe(24)
            connection.execute("INSERT INTO ownership_transfers VALUES(?,?,?,?,?,'pending',?,?,NULL)", (transfer_id, workspace_id, workspace['name'], account_id, target, now, now + LIFETIME))
            return self.public(connection, connection.execute('SELECT * FROM ownership_transfers WHERE transfer_id=?', (transfer_id,)).fetchone())

    def review(self, account_id, transfer_id):
        with AUTHORIZATION_LOCK, self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM ownership_transfers WHERE transfer_id=? AND (recipient_account_id=? OR sender_account_id=?)', (transfer_id, account_id, account_id)).fetchone()
            if not row:
                raise PermissionError('This ownership request is not available for your account.')
            result = self.public(connection, row)
            if result['status'] == 'pending':
                self._membership(connection, account_id, row['workspace_id'])
                self._membership(connection, row['sender_account_id'], row['workspace_id'], owner=True)
                result.update(self.inventory(connection, row))
            return result

    def decide(self, account_id, transfer_id, action, payload, login_token, client):
        if action not in ('accept', 'decline', 'cancel'):
            raise ValueError('Choose accept, decline or cancel.')
        # Authorize before password work; an unknown request cannot probe users.
        review = self.review(account_id, transfer_id)
        expected = review['sender_account_id'] if action == 'cancel' else review['recipient_account_id']
        if expected != account_id:
            raise PermissionError('This ownership action is not available for your account.')
        credential = self.reauthenticate(account_id, payload.get('password'), login_token, client) if action == 'accept' else None
        with AUTHORIZATION_LOCK, self.repository._connection(write=True) as connection:
            row = connection.execute('SELECT * FROM ownership_transfers WHERE transfer_id=?', (transfer_id,)).fetchone()
            if not row or row['status'] != 'pending' or row['expires_at'] <= time.time():
                raise ValueError('This ownership request is no longer pending. Refresh your workspace.')
            self._membership(connection, row['sender_account_id'], row['workspace_id'], owner=True)
            if action == 'accept':
                self.recheck(connection, account_id, credential, login_token)
                self._membership(connection, account_id, row['workspace_id'])
                if payload.get('review_version') != self.inventory(connection, row)['review_version']:
                    raise ValueError('The workspace changed since your review. Refresh the review before accepting.')
                self._apply(connection, row['sender_account_id'], account_id, row['workspace_id'])
            status = {'accept': 'accepted', 'decline': 'declined', 'cancel': 'cancelled'}[action]
            connection.execute('UPDATE ownership_transfers SET status=?,decided_at=? WHERE transfer_id=?', (status, int(time.time()), transfer_id))
            return {'status': status, 'workspace_id': row['workspace_id']}

    @classmethod
    def _apply(cls, connection, sender, recipient, workspace_id):
        connection.execute('UPDATE workspace_invitations SET revoked_at=? WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL', (int(time.time()), workspace_id))
        connection.execute("UPDATE workspace_members SET role='member' WHERE workspace_id=? AND account_id=?", (workspace_id, sender))
        connection.execute("UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND account_id=?", (workspace_id, recipient))
        connection.execute('UPDATE workspaces SET owner_account_id=? WHERE workspace_id=?', (recipient, workspace_id))
        connection.execute('''UPDATE external_connections SET account_id=? WHERE connection_id IN
            (SELECT d.connection_id FROM databases d JOIN workspace_databases wd USING(database_id) WHERE wd.workspace_id=?)''', (recipient, workspace_id))
        connection.execute('UPDATE workspace_databases SET owner_account_id=? WHERE workspace_id=?', (recipient, workspace_id))
