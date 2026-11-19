"""MCP bridge transport checks, including a real SDK stdio round trip."""

import asyncio
from http.server import ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from agents.client import AgentClient, AgentError, NoRedirect
from tests import test_agent_api as api_fixture
from tests.test_http import HttpHarness, QuietHandler


class AgentClientTests(unittest.TestCase):
    token = 'dg_' + 'a' * 43

    def test_only_https_or_loopback_http_and_no_embedded_credentials(self):
        for url in ('http://example.com', 'https://name:password@example.com', 'https://example.com/path',
                    'https://example.com/?key=secret', 'https://example.com/#fragment', 'file:///tmp/key'):
            with self.assertRaises(AgentError):
                AgentClient(url, self.token)
        self.assertEqual(AgentClient('http://127.0.0.1:8000', self.token).url, 'http://127.0.0.1:8000')
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))

    def test_tokens_are_headers_only_and_redirects_never_follow(self):
        client = AgentClient('https://data-genie.space', self.token)
        with patch.object(client.opener, 'open', side_effect=HTTPError('https://other.example', 302, 'redirect', {}, io.BytesIO())) as send:
            with self.assertRaisesRegex(AgentError, 'Redirect blocked'):
                client.catalog()
            request = send.call_args.args[0]
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.token)
            self.assertNotIn(self.token, request.full_url)

    def test_malformed_error_bodies_and_tool_catalogs_are_handled(self):
        client = AgentClient('https://data-genie.space', self.token)
        with patch.object(client.opener, 'open', side_effect=HTTPError(client.url, 400, 'bad request', {}, io.BytesIO(b'[]'))):
            with self.assertRaisesRegex(AgentError, 'could not complete'):
                client.catalog()
        for payload in ({}, {'tools': None}, {'tools': [None]}, {'tools': [{'name': 'query'}]}):
            with patch.object(client, 'request', return_value=payload):
                with self.assertRaisesRegex(AgentError, 'unreadable tool catalog'):
                    client.catalog()
        with patch.object(client.opener, 'open', return_value=io.BytesIO(b'[]')):
            with self.assertRaisesRegex(AgentError, 'unreadable response'):
                client.catalog()

    def test_large_response_keeps_the_useful_size_error(self):
        client = AgentClient('https://data-genie.space', self.token)
        with patch.object(client.opener, 'open', return_value=io.BytesIO(b'x' * (8 * 1024 * 1024 + 1))):
            with self.assertRaisesRegex(AgentError, 'too large'):
                client.catalog()


@unittest.skipUnless(importlib.util.find_spec('mcp'), 'Install agents/requirements.txt for the SDK protocol check.')
class AgentProtocolTests(HttpHarness, unittest.TestCase):
    key = api_fixture.AgentApiTests.key

    def test_official_client_can_discover_query_and_receive_permission_errors(self):
        self.workspace_id = self.session['access']['workspace_id']
        key = self.key(['databases:read'])
        try:
            server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        except PermissionError:
            self.skipTest('This environment blocks loopback listeners; run the MCP check with network access.')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            asyncio.run(self.exchange(server.server_address[1], key))
        finally:
            server.shutdown(); server.server_close(); thread.join(3)

    async def exchange(self, port, key):
        from mcp import ClientSession, StdioServerParameters, stdio_client
        params = StdioServerParameters(command=sys.executable,
            args=[str(Path(__file__).resolve().parents[1] / 'agents/server.py')],
            env={'DATA_GENIE_URL': 'http://127.0.0.1:' + str(port), 'DATA_GENIE_API_KEY': key['token']})
        async with asyncio.timeout(30):
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    self.assertIn('database_schema', {tool.name for tool in tools.tools})
                    self.assertNotIn('prepare_change', {tool.name for tool in tools.tools})
                    result = await session.call_tool('query', {'database_id': self.session['database_id'], 'sql': 'SELECT * FROM notes'})
                    self.assertFalse(result.is_error)
                    self.assertEqual(len(result.structured_content['rows']), 2)
                    failed_query = await session.call_tool('query', {'database_id': self.session['database_id'], 'sql': 'SELECT missing_column FROM notes'})
                    self.assertTrue(failed_query.is_error)
                    self.assertFalse(failed_query.structured_content['matched'])
                    denied = await session.call_tool('create_database', {'name': 'Denied', 'idempotency_key': 'should-not-create'})
                    self.assertTrue(denied.is_error)
                    self.assertNotIn(key['token'], str(denied))
