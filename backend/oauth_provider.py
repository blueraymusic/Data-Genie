"""First-party OAuth persistence. The MCP SDK validates redirects, client auth and PKCE."""

from contextvars import ContextVar
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode, urlsplit, parse_qsl, urlunsplit

from . import workbench
from .agent_tokens import AgentTokens, SCOPES
from .connections.vault import CredentialVault
from .microsoft_auth import durable
from .workspaces import WorkspaceStore, AUTHORIZATION_LOCK


REQUEST_IP = ContextVar('oauth_request_ip', default='local')
ACCESS_LIFETIME = 3600
GRANT_DAYS = 30


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def redirect(uri, **values):
    parts = urlsplit(str(uri))
    query = parse_qsl(parts.query, keep_blank_values=True)
    query += [(key, value) for key, value in values.items() if value is not None]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


class OAuthProvider:
    def __init__(self, origin):
        self.origin, self.resource = origin, origin + '/mcp'

    @property
    def repository(self):
        return workbench.get_repository()

    def live_grant(self, connection, token_id):
        row = connection.execute('SELECT * FROM agent_tokens WHERE token_id=? AND revoked_at IS NULL AND expires_at>?',
                                 (token_id, int(time.time()))).fetchone()
        if row is None:
            return None
        try:
            WorkspaceStore._membership(connection, row['account_id'], row['workspace_id'])
        except PermissionError:
            return None
        return dict(row) | {'scopes': json.loads(row['scopes_json'])}

    async def get_client(self, client_id):
        from mcp.shared.auth import OAuthClientInformationFull
        if not isinstance(client_id, str) or len(client_id) > 200:
            return None
        with durable():
            AgentTokens(self.repository).reserve('oauth-client-ip:' + REQUEST_IP.get(), 120)
            with self.repository._connection() as connection:
                row = connection.execute('SELECT encrypted_json FROM oauth_clients WHERE client_id=?', (client_id,)).fetchone()
                return OAuthClientInformationFull.model_validate(CredentialVault(self.repository.path).decrypt(row[0])) if row else None

    async def register_client(self, client_info):
        from mcp.server.auth.provider import RegistrationError
        if not client_info.redirect_uris:
            raise RegistrationError('invalid_redirect_uri', 'Provide at least one registered callback.')
        for uri in client_info.redirect_uris:
            parts = urlsplit(str(uri))
            if (parts.username or parts.password or parts.fragment or not parts.hostname
                    or (parts.scheme != 'https' and not (parts.scheme == 'http' and parts.hostname in {'127.0.0.1', 'localhost', '::1'}))):
                raise RegistrationError('invalid_redirect_uri', 'Use HTTPS or a loopback callback.')
        if len(client_info.redirect_uris) > 10 or len(client_info.model_dump_json()) > 16000:
            raise RegistrationError('invalid_client_metadata', 'Client metadata is too large.')
        with durable():
            AgentTokens(self.repository).reserve('oauth-register:' + REQUEST_IP.get(), 10, 3600)
            with self.repository._connection(write=True) as connection:
                if connection.execute('SELECT COUNT(*) FROM oauth_clients').fetchone()[0] >= 10000:
                    raise RegistrationError('invalid_client_metadata', 'Client registration is temporarily unavailable.')
                encrypted = CredentialVault(self.repository.path).encrypt(client_info.model_dump(mode='json'))
                connection.execute('INSERT INTO oauth_clients VALUES(?,?,?)', (client_info.client_id, encrypted, int(time.time())))

    async def authorize(self, client, params):
        from mcp.server.auth.provider import AuthorizeError
        if params.resource not in (None, self.resource):
            raise AuthorizeError('invalid_target', 'Choose the Data Genie MCP resource.')
        params.resource = self.resource
        if not params.scopes or set(params.scopes) - set(SCOPES):
            raise AuthorizeError('invalid_scope', 'Choose supported Data Genie permissions.')
        if 'queries:prepare' in params.scopes and 'databases:read' not in params.scopes:
            raise AuthorizeError('invalid_scope', 'Preparing changes also requires databases:read.')
        flow = secrets.token_urlsafe(32)
        with durable(), AUTHORIZATION_LOCK:
            AgentTokens(self.repository).reserve('oauth-authorize:' + REQUEST_IP.get(), 30, 900)
            with self.repository._connection(write=True) as connection:
                connection.execute('DELETE FROM oauth_flows WHERE expires_at<=?', (int(time.time()),))
                connection.execute('INSERT INTO oauth_flows VALUES(?,?,?,?)',
                    (digest(flow), client.client_id, params.model_dump_json(), int(time.time()) + 600))
        return self.origin + '/connect-agent?flow=' + flow

    def flow(self, flow):
        if not isinstance(flow, str) or not 40 <= len(flow) <= 100:
            raise ValueError('This connection request is invalid or expired. Start again from your agent.')
        with self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM oauth_flows WHERE flow_hash=? AND expires_at>?', (digest(flow), int(time.time()))).fetchone()
            if not row:
                raise ValueError('This connection request has expired or was already used. Start again from your agent.')
            client = connection.execute('SELECT encrypted_json FROM oauth_clients WHERE client_id=?', (row['client_id'],)).fetchone()
        metadata = CredentialVault(self.repository.path).decrypt(client[0])
        return dict(row), metadata, json.loads(row['params_json'])

    def flow_info(self, account_id, flow):
        _, client, params = self.flow(flow)
        spaces = WorkspaceStore(self.repository).list_workspaces(account_id)['workspaces']
        return {'client_name': (client.get('client_name') or 'MCP client')[:80],
                'callback': params['redirect_uri'], 'scopes': params['scopes'],
                'scope_labels': SCOPES, 'workspaces': spaces}

    def consent(self, account_id, payload):
        with AUTHORIZATION_LOCK:
            row, client, params = self.flow(payload.get('flow'))
            if type(payload.get('approve')) is not bool:
                raise ValueError('Choose whether to connect this agent.')
            if not payload['approve']:
                with self.repository._connection(write=True) as connection:
                    connection.execute('DELETE FROM oauth_flows WHERE flow_hash=?', (row['flow_hash'],))
                return {'url': redirect(params['redirect_uri'], error='access_denied', state=params.get('state'))}
            scopes = payload.get('scopes')
            if not isinstance(scopes, list) or not scopes or any(not isinstance(scope, str) or scope not in params['scopes'] for scope in scopes):
                raise ValueError('Choose at least one of the requested permissions.')
            grant = AgentTokens(self.repository).create(account_id, {
                'name': ('Connected: ' + (client.get('client_name') or 'MCP client'))[:80],
                'workspace_id': payload.get('workspace_id'), 'scopes': scopes, 'days': GRANT_DAYS,
            })
            params['scopes'] = grant['scopes']
            code = secrets.token_urlsafe(32)
            with self.repository._connection(write=True) as connection:
                deleted = connection.execute('DELETE FROM oauth_flows WHERE flow_hash=?', (row['flow_hash'],)).rowcount
                if deleted != 1:
                    raise ValueError('This connection request has expired. Start again from your agent.')
                connection.execute('INSERT INTO oauth_codes VALUES(?,?,?,?,?)',
                    (digest(code), grant['token_id'], row['client_id'], json.dumps(params), int(time.time()) + 60))
            return {'url': redirect(params['redirect_uri'], code=code, state=params.get('state'))}

    async def load_authorization_code(self, client, authorization_code):
        from mcp.server.auth.provider import AuthorizationCode
        if len(authorization_code) > 200:
            return None
        with durable(), self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM oauth_codes WHERE code_hash=? AND client_id=? AND expires_at>?',
                (digest(authorization_code), client.client_id, int(time.time()))).fetchone()
            grant = self.live_grant(connection, row['token_id']) if row else None
            if not grant:
                return None
            return AuthorizationCode(code=authorization_code, client_id=client.client_id, expires_at=row['expires_at'],
                subject=str(grant['account_id']), **json.loads(row['params_json']))

    def issue(self, connection, token_id, client_id, scopes):
        from mcp.shared.auth import OAuthToken
        grant = self.live_grant(connection, token_id)
        if not grant or not set(scopes).issubset(grant['scopes']):
            from mcp.server.auth.provider import TokenError
            raise TokenError('invalid_grant', 'This connection is no longer available.')
        access, refresh = 'dgo_' + secrets.token_urlsafe(32), 'dgr_' + secrets.token_urlsafe(32)
        connection.execute('DELETE FROM oauth_tokens WHERE token_id=?', (token_id,))
        now = int(time.time())
        for raw, kind, expiry in ((access, 'access', min(now + ACCESS_LIFETIME, grant['expires_at'])), (refresh, 'refresh', grant['expires_at'])):
            connection.execute('INSERT INTO oauth_tokens VALUES(?,?,?,?,?,?)',
                (digest(raw), kind, token_id, client_id, json.dumps(scopes), expiry))
        return OAuthToken(access_token=access, refresh_token=refresh, token_type='Bearer',
            expires_in=min(ACCESS_LIFETIME, grant['expires_at'] - now), scope=' '.join(scopes))

    async def exchange_authorization_code(self, client, authorization_code):
        from mcp.server.auth.provider import TokenError
        with durable(), AUTHORIZATION_LOCK, self.repository._connection(write=True) as connection:
            row = connection.execute('SELECT * FROM oauth_codes WHERE code_hash=? AND client_id=? AND expires_at>?',
                (digest(authorization_code.code), client.client_id, int(time.time()))).fetchone()
            if row is None:
                raise TokenError('invalid_grant', 'This authorization code was already used or expired.')
            result = self.issue(connection, row['token_id'], client.client_id, authorization_code.scopes)
            connection.execute('DELETE FROM oauth_codes WHERE code_hash=?', (row['code_hash'],))
            return result

    def load_token(self, raw, kind, client_id=None):
        if not isinstance(raw, str) or len(raw) > 200:
            return None
        with self.repository._connection() as connection:
            row = connection.execute('SELECT * FROM oauth_tokens WHERE token_hash=? AND kind=? AND expires_at>?',
                (digest(raw), kind, int(time.time()))).fetchone()
            if not row or (client_id is not None and row['client_id'] != client_id):
                return None
            grant = self.live_grant(connection, row['token_id'])
            return (dict(row), grant) if grant else None

    async def load_refresh_token(self, client, refresh_token):
        from mcp.server.auth.provider import RefreshToken
        with durable():
            loaded = self.load_token(refresh_token, 'refresh', client.client_id)
            if not loaded:
                return None
            row, grant = loaded
            return RefreshToken(token=refresh_token, client_id=client.client_id, scopes=json.loads(row['scopes_json']),
                expires_at=row['expires_at'], resource=self.resource, subject=str(grant['account_id']))

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        from mcp.server.auth.provider import TokenError
        with durable(), AUTHORIZATION_LOCK:
            loaded = self.load_token(refresh_token.token, 'refresh', client.client_id)
            if not loaded or not set(scopes).issubset(json.loads(loaded[0]['scopes_json'])):
                raise TokenError('invalid_grant', 'This refresh token was already used, expired or revoked.')
            with self.repository._connection(write=True) as connection:
                return self.issue(connection, loaded[0]['token_id'], client.client_id, scopes)

    async def load_access_token(self, token):
        from mcp.server.auth.provider import AccessToken
        with durable():
            AgentTokens(self.repository).reserve('oauth-access-ip:' + REQUEST_IP.get(), 120)
            loaded = self.load_token(token, 'access')
            if not loaded:
                return None
            row, grant = loaded
            return AccessToken(token=token, client_id=row['client_id'], scopes=json.loads(row['scopes_json']),
                expires_at=row['expires_at'], resource=self.resource, subject=str(grant['account_id']),
                claims={'iss': self.origin, 'genie_token_id': grant['token_id']})

    async def revoke_token(self, token):
        with durable(), AUTHORIZATION_LOCK:
            loaded = self.load_token(token.token, 'access') or self.load_token(token.token, 'refresh')
            if loaded:
                AgentTokens(self.repository).revoke(loaded[1]['account_id'], loaded[0]['token_id'])

    def credential(self, access_token):
        loaded = self.load_token(access_token.token, 'access')
        if loaded is None:
            raise PermissionError('This connection has expired or been revoked.')
        row, grant = loaded
        return {**grant, 'scopes': json.loads(row['scopes_json'])}
