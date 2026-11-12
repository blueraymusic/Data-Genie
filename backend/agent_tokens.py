"""Revocable agent credentials, bounded to one workspace and live account access."""

import hashlib
import json
import re
import secrets
import time
import uuid

from .authentication import LoginRequired, TooManyAttempts
from .workspaces import WorkspaceStore, _serialized


SCOPES = {
    'databases:read': 'Read databases and run SELECT queries',
    'queries:prepare': 'Prepare database changes for your review',
    'databases:create': 'Create blank SQLite databases (owners only)',
    'reports:read': 'Read reports available to your account',
    'reports:write': 'Create and update your private report drafts',
    'reports:generate': 'Draft reports with Data Genie AI',
}


class AgentTokens(WorkspaceStore):
    @staticmethod
    def public(row):
        return {key: row[key] for key in ('token_id', 'workspace_id', 'name', 'created_at',
                                          'expires_at', 'last_used', 'revoked_at')} | {
            'scopes': json.loads(row['scopes_json'])}

    @_serialized
    def create(self, account_id, payload):
        name, scopes, days = payload.get('name'), payload.get('scopes'), payload.get('days', 30)
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError('Give this key a name, up to 80 characters.')
        if not isinstance(scopes, list) or not scopes or any(not isinstance(s, str) or s not in SCOPES for s in scopes):
            raise ValueError('Choose at least one supported agent permission.')
        if type(days) is not int or days not in {1, 7, 30, 90}:
            raise ValueError('Choose an expiry of 1, 7, 30 or 90 days.')
        scopes = sorted(set(scopes))
        if 'queries:prepare' in scopes and 'databases:read' not in scopes:
            raise ValueError('Allow database reading before preparing changes.')
        now = int(time.time())
        token = 'dg_' + secrets.token_urlsafe(32)
        with self.repository._connection(write=True) as connection:
            workspace = self._membership(connection, account_id, payload.get('workspace_id'))
            if workspace['role'] == 'viewer' and scopes != ['reports:read']:
                raise PermissionError('Viewers can connect agents to shared reports only.')
            if 'databases:create' in scopes and workspace['role'] != 'owner':
                raise PermissionError('Only the workspace owner can add databases.')
            if connection.execute('SELECT COUNT(*) FROM agent_tokens WHERE account_id=? AND revoked_at IS NULL AND expires_at>?',
                                  (account_id, now)).fetchone()[0] >= 10:
                raise ValueError('You can have 10 active keys. Revoke an unused key first.')
            token_id = str(uuid.uuid4())
            connection.execute('''INSERT INTO agent_tokens
                (token_id,token_hash,account_id,workspace_id,name,scopes_json,created_at,expires_at)
                VALUES(?,?,?,?,?,?,?,?)''', (token_id, hashlib.sha256(token.encode()).hexdigest(), account_id,
                                          workspace['workspace_id'], name.strip(), json.dumps(scopes), now, now + days * 86400))
            row = connection.execute('SELECT * FROM agent_tokens WHERE token_id=?', (token_id,)).fetchone()
            return {**self.public(row), 'token': token}

    def list(self, account_id):
        with self.repository._connection() as connection:
            rows = connection.execute('SELECT * FROM agent_tokens WHERE account_id=? ORDER BY created_at DESC,token_id', (account_id,)).fetchall()
            return {'tokens': [self.public(row) for row in rows], 'scopes': SCOPES}

    @_serialized
    def revoke(self, account_id, token_id):
        with self.repository._connection(write=True) as connection:
            row = connection.execute('SELECT * FROM agent_tokens WHERE token_id=? AND account_id=?', (token_id, account_id)).fetchone()
            if not row:
                raise PermissionError('This key is not available for your account.')
            connection.execute('UPDATE agent_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE token_id=?', (int(time.time()), token_id))
            return {'revoked': True, 'token_id': token_id}

    def reserve(self, key, limit, seconds=60):
        now = int(time.time())
        key = 'agent:' + hashlib.sha256(key.encode()).hexdigest()
        with self.repository._connection(write=True) as connection:
            connection.execute('DELETE FROM auth_rate_limits WHERE started_at<?', (now - 86400,))
            row = connection.execute('SELECT * FROM auth_rate_limits WHERE bucket_key=?', (key,)).fetchone()
            if row and now - row['started_at'] < seconds:
                if row['attempts'] >= limit:
                    raise TooManyAttempts(max(1, seconds - (now - row['started_at'])))
                connection.execute('UPDATE auth_rate_limits SET attempts=attempts+1 WHERE bucket_key=?', (key,))
            else:
                connection.execute('''INSERT INTO auth_rate_limits VALUES(?,?,1)
                    ON CONFLICT(bucket_key) DO UPDATE SET started_at=excluded.started_at,attempts=1''', (key, now))

    @_serialized
    def authenticate(self, authorization, client):
        self.reserve('ip:' + client, 120)
        if not isinstance(authorization, str) or not re.fullmatch(r'(?i:Bearer) dg_[A-Za-z0-9_-]{43}', authorization):
            raise LoginRequired('Provide a valid Data Genie agent key.')
        hashed = hashlib.sha256(authorization[7:].encode()).hexdigest()
        with self.repository._connection(write=True) as connection:
            row = connection.execute('SELECT * FROM agent_tokens WHERE token_hash=?', (hashed,)).fetchone()
            if not row or row['revoked_at'] is not None or row['expires_at'] <= int(time.time()):
                raise LoginRequired('This agent key has expired or been revoked.')
            self._membership(connection, row['account_id'], row['workspace_id'])
            connection.execute('UPDATE agent_tokens SET last_used=? WHERE token_id=?', (int(time.time()), row['token_id']))
            result = dict(row)
        self.reserve('token:' + result['token_id'], 60)
        result['scopes'] = json.loads(result.pop('scopes_json'))
        result.pop('token_hash')
        return result
