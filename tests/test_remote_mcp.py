"""First-party OAuth and real SDK HTTP transport using isolated fixture accounts."""

import base64
import hashlib
import importlib.util
import json
import re
import time
import unittest
from unittest.mock import patch
import asyncio
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlencode, urlsplit, parse_qs

from backend import workbench
from backend.oauth_provider import digest
from tests.test_http import HttpHarness, QuietHandler


AVAILABLE = all(importlib.util.find_spec(name) for name in ('mcp', 'a2wsgi', 'cryptography'))


@unittest.skipUnless(AVAILABLE, 'Install azure/requirements.txt for hosted MCP/OAuth checks.')
class RemoteMcpTests(HttpHarness, unittest.TestCase):
    origin = 'http://127.0.0.1:8000'
    callback = 'https://client.example.test/callback'
    verifier = 'a' * 64

    def request(self, method, path, payload=None, session_id=None, extra_headers=None, raw=False):
        return super().request(method, path, payload, session_id,
            {'Host': urlsplit(self.origin).netloc, **(extra_headers or {})}, raw)

    def register(self):
        status, result = self.request('POST', '/register', {'client_name': 'Fixture agent',
            'redirect_uris': [self.callback], 'token_endpoint_auth_method': 'none',
            'grant_types': ['authorization_code', 'refresh_token'], 'response_types': ['code'],
            'scope': 'databases:read queries:prepare reports:read reports:write'})
        self.assertEqual(status, 201, result)
        return result

    def authorize(self, client):
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip('=')
        params = {'client_id': client['client_id'], 'redirect_uri': self.callback, 'response_type': 'code',
            'code_challenge': challenge, 'code_challenge_method': 'S256', 'state': 'fixture-state',
            'scope': client['scope'], 'resource': self.origin + '/mcp'}
        status, _ = self.request('GET', '/authorize?' + urlencode(params), raw=True)
        self.assertEqual(status, 302, self.last_headers)
        location = re.search(r'(?im)^location: (.+)\r?$', self.last_headers).group(1).strip()
        return parse_qs(urlsplit(location).query)['flow'][0]

    def grant(self):
        client = self.register(); flow = self.authorize(client)
        status, info = self.request('GET', '/api/oauth/flow?flow=' + flow)
        self.assertEqual(status, 200, info)
        self.assertEqual(info['callback'], self.callback)
        status, approved = self.request('POST', '/api/oauth/consent', {'flow': flow, 'approve': True,
            'workspace_id': self.session['access']['workspace_id'], 'scopes': ['databases:read', 'reports:read']})
        self.assertEqual(status, 200, approved)
        values = parse_qs(urlsplit(approved['url']).query)
        self.assertEqual(values['state'], ['fixture-state'])
        return client, flow, values['code'][0]

    def token(self, client, code=None, refresh=None, **changes):
        payload = {'client_id': client['client_id'], 'resource': self.origin + '/mcp'}
        payload.update({'grant_type': 'refresh_token', 'refresh_token': refresh} if refresh else {
            'grant_type': 'authorization_code', 'code': code, 'code_verifier': self.verifier, 'redirect_uri': self.callback})
        payload.update(changes)
        return self.request('POST', '/token', urlencode(payload).encode(), extra_headers={'Content-Type': 'application/x-www-form-urlencoded'})

    def rpc(self, method, token=None, params=None):
        headers = {'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        return self.request('POST', '/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}}, extra_headers=headers)

    def test_discovery_is_public_but_mcp_requires_oauth(self):
        status, metadata = self.request('GET', '/.well-known/oauth-authorization-server')
        self.assertEqual(status, 200, metadata)
        self.assertIn('S256', metadata['code_challenge_methods_supported'])
        status, protected = self.request('GET', '/.well-known/oauth-protected-resource/mcp')
        self.assertEqual(status, 200, protected)
        self.assertEqual(protected['resource'], self.origin + '/mcp')
        self.assertEqual(self.rpc('tools/list')[0], 401)
        self.assertIn('resource_metadata=', self.last_headers)

    def test_hosted_metadata_and_anonymous_challenge_do_not_wake_sql(self):
        from backend import cloud_state
        from backend import settings
        from backend.wsgi import application
        from io import BytesIO
        with patch.object(settings, 'public_url', return_value='https://genie.example.test'), \
                patch.object(cloud_state, 'connect', side_effect=AssertionError('Metadata must not connect to SQL')):
            for path, expected in (('/.well-known/oauth-authorization-server', 200),
                                   ('/.well-known/oauth-protected-resource/mcp', 200), ('/mcp', 401)):
                response = {}
                def start(status, headers):
                    response['status'] = int(status.split()[0])
                body = b''.join(application({'REQUEST_METHOD': 'GET', 'PATH_INFO': path, 'QUERY_STRING': '',
                    'HTTP_HOST': 'genie.example.test', 'REMOTE_ADDR': '127.0.0.1', 'wsgi.url_scheme': 'https',
                    'SERVER_NAME': 'genie.example.test', 'SERVER_PORT': '443', 'SERVER_PROTOCOL': 'HTTP/1.1',
                    'wsgi.input': BytesIO()}, start))
                self.assertEqual(response['status'], expected, body)

    def test_browser_consent_pkce_one_use_codes_and_live_tools(self):
        client, flow, code = self.grant()
        self.assertEqual(self.token(client, code, code_verifier='wrong')[0], 400)
        status, issued = self.token(client, code)
        self.assertEqual(status, 200, issued)
        self.assertEqual(self.token(client, code)[0], 400)
        self.assertEqual(self.request('GET', '/api/oauth/flow?flow=' + flow)[0], 400)
        access = issued['access_token']
        status, initialized = self.rpc('initialize', access, {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'Fixture', 'version': '1'}})
        self.assertEqual(status, 200, initialized)
        status, tools = self.rpc('tools/list', access)
        self.assertEqual(status, 200, tools)
        names = {tool['name'] for tool in tools['result']['tools']}
        self.assertIn('query', names); self.assertNotIn('prepare_change', names)
        status, result = self.rpc('tools/call', access, {'name': 'query', 'arguments': {'database_id': self.session['database_id'], 'sql': 'SELECT * FROM notes'}})
        self.assertEqual(status, 200, result)
        self.assertFalse(result['result']['isError'])
        self.assertEqual(len(result['result']['structuredContent']['rows']), 2)

    def test_refresh_rotation_resource_binding_and_revocation(self):
        client, _, code = self.grant()
        self.assertEqual(self.token(client, code, resource='https://other.example/mcp')[0], 400)
        _, issued = self.token(client, code)
        status, rotated = self.token(client, refresh=issued['refresh_token'])
        self.assertEqual(status, 200, rotated)
        self.assertNotEqual(rotated['access_token'], issued['access_token'])
        self.assertEqual(self.token(client, refresh=issued['refresh_token'])[0], 400)
        self.assertEqual(self.rpc('tools/list', issued['access_token'])[0], 401)
        keys = self.request('GET', '/api/agent-tokens')[1]['tokens']
        self.request('POST', '/api/agent-tokens/revoke', {'token_id': keys[0]['token_id']})
        self.assertEqual(self.rpc('tools/list', rotated['access_token'])[0], 401)
        self.assertEqual(self.token(client, refresh=rotated['refresh_token'])[0], 400)

    def test_consent_requires_csrf_and_deny_creates_no_grant(self):
        client = self.register(); flow = self.authorize(client)
        csrf, self.csrf = self.csrf, ''
        self.assertEqual(self.request('POST', '/api/oauth/consent', {'flow': flow, 'approve': True})[0], 403)
        self.csrf = csrf
        status, denied = self.request('POST', '/api/oauth/consent', {'flow': flow, 'approve': False})
        self.assertEqual(status, 200, denied)
        self.assertEqual(parse_qs(urlsplit(denied['url']).query)['error'], ['access_denied'])
        self.assertEqual(self.request('GET', '/api/agent-tokens')[1]['tokens'], [])

    def test_keys_are_not_accepted_as_mcp_oauth_tokens_and_hosts_are_checked(self):
        _, key = self.request('POST', '/api/agent-tokens', {'name': 'Fixture', 'workspace_id': self.session['access']['workspace_id'],
            'scopes': ['databases:read'], 'password': self.password})
        self.assertEqual(self.rpc('tools/list', key['token'])[0], 401)
        self.assertEqual(self.request('GET', '/.well-known/oauth-authorization-server', extra_headers={'Host': 'evil.example'})[0], 403)

    def test_invalid_redirects_and_scope_expansion_are_rejected(self):
        status, _ = self.request('POST', '/register', {'redirect_uris': ['http://evil.example/callback']})
        self.assertEqual(status, 400)
        client = self.register(); flow = self.authorize(client)
        status, result = self.request('POST', '/api/oauth/consent', {'flow': flow, 'approve': True,
            'workspace_id': self.session['access']['workspace_id'], 'scopes': ['databases:create']})
        self.assertEqual(status, 400, result)

    def test_confidential_client_secrets_and_opaque_tokens_stay_private(self):
        status, client = self.request('POST', '/register', {'client_name': 'Secret client',
            'redirect_uris': [self.callback], 'grant_types': ['authorization_code', 'refresh_token'],
            'response_types': ['code'], 'scope': 'reports:read'})
        self.assertEqual(status, 201, client)
        with workbench.get_repository()._connection() as connection:
            saved = connection.execute('SELECT encrypted_json FROM oauth_clients WHERE client_id=?', (client['client_id'],)).fetchone()[0]
            self.assertNotIn(client['client_secret'], saved)
        flow = self.authorize(client)
        _, approved = self.request('POST', '/api/oauth/consent', {'flow': flow, 'approve': True,
            'workspace_id': self.session['access']['workspace_id'], 'scopes': ['reports:read']})
        code = parse_qs(urlsplit(approved['url']).query)['code'][0]
        self.assertEqual(self.token(client, code, client_secret='wrong')[0], 401)
        status, issued = self.token(client, code, client_secret=client['client_secret'])
        self.assertEqual(status, 200, issued)
        with workbench.get_repository()._connection() as connection:
            saved = json.dumps([dict(row) for row in connection.execute('SELECT * FROM oauth_tokens')])
            self.assertNotIn(issued['access_token'], saved)
            self.assertNotIn(issued['refresh_token'], saved)

    def test_default_clients_can_offer_all_actions_without_automatic_grants(self):
        from backend.agent_tokens import SCOPES
        status, client = self.request('POST', '/register', {'client_name': 'Default client',
            'redirect_uris': [self.callback], 'token_endpoint_auth_method': 'none'})
        self.assertEqual(status, 201, client)
        self.assertEqual(set(client['scope'].split()), set(SCOPES))
        flow = self.authorize(client)
        status, info = self.request('GET', '/api/oauth/flow?flow=' + flow)
        self.assertEqual(status, 200, info)
        self.assertEqual(set(info['scopes']), set(SCOPES))
        self.assertEqual(self.request('GET', '/api/agent-tokens')[1]['tokens'], [])

    def test_real_sdk_http_client_uses_authorized_tools(self):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        except PermissionError:
            self.skipTest('This environment blocks loopback listeners.')
        self.origin = 'http://127.0.0.1:' + str(server.server_address[1])
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            client, _, code = self.grant()
            _, issued = self.token(client, code)
            async def check():
                import httpx2
                from mcp import ClientSession
                from mcp.client.streamable_http import streamable_http_client
                async with httpx2.AsyncClient(headers={'Authorization': 'Bearer ' + issued['access_token']}, timeout=20) as http:
                    async with streamable_http_client(self.origin + '/mcp', http_client=http, terminate_on_close=False) as streams:
                        async with ClientSession(streams[0], streams[1]) as session:
                            await session.initialize()
                            tools = await session.list_tools()
                            self.assertIn('query', {tool.name for tool in tools.tools})
                            result = await session.call_tool('query', {'database_id': self.session['database_id'], 'sql': 'SELECT * FROM notes'})
                            self.assertFalse(result.is_error)
                            self.assertEqual(len(result.structured_content['rows']), 2)
            asyncio.run(check())
        finally:
            server.shutdown(); server.server_close(); thread.join(3)
