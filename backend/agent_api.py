"""Bearer-only versioned API, separate from browser cookies and approval routes."""

import re

from . import authentication, workbench
from .agent_actions import AgentActions, TOOLS
from .agent_tokens import AgentTokens


def openapi():
    paths = {}
    for item in TOOLS:
        paths['/api/v1/actions/' + item['name']] = {'post': {
            'operationId': item['name'], 'description': item['description'],
            'security': [{'agentKey': []}],
            'requestBody': {'required': True, 'content': {'application/json': {'schema': item['inputSchema']}}},
            'responses': {'200': {'description': 'Action result'}, '400': {'description': 'Invalid arguments'},
                          '401': {'description': 'Missing, expired or revoked key'}, '403': {'description': 'Permission denied'},
                          '429': {'description': 'Rate limit reached'}},
        }}
    return {'openapi': '3.1.0', 'info': {'title': 'Data Genie agent API', 'version': '1.0.0'},
            'paths': paths, 'components': {'securitySchemes': {'agentKey': {'type': 'http', 'scheme': 'bearer'}}}}


def handle(handler, path):
    if path != '/api/v1' and not path.startswith('/api/v1/'):
        return False
    try:
        if path == '/api/v1/openapi.json' and handler.command == 'GET':
            handler.json(openapi())
            return True
        tokens = AgentTokens(workbench.get_repository())
        credential = tokens.authenticate(handler.headers.get('Authorization'), handler.client_address[0])
        actions = AgentActions(workbench.get_repository(), credential)
        if path == '/api/v1' and handler.command == 'GET':
            handler.json({'version': '1', 'workspace_id': credential['workspace_id'], 'tools': actions.catalog(),
                          'limits': {'requests_per_minute': 60, 'rows_per_query': 50},
                          'review': 'Database changes require confirmation in the signed-in site. Agents cannot confirm, publish or change permissions.'})
            return True
        match = re.fullmatch(r'/api/v1/actions/([a-z_]+)', path)
        if match and handler.command == 'POST':
            if not handler.headers.get('Content-Type', '').startswith('application/json'):
                raise ValueError('Send action arguments as JSON.')
            handler.json(actions.call(match[1], handler.read_json(64 * 1024)))
        else:
            handler.json({'error': 'Unknown API route.'}, 404)
    except authentication.LoginRequired as error:
        handler.json({'error': str(error)}, 401, headers={'WWW-Authenticate': 'Bearer realm="Data Genie"'})
    except authentication.TooManyAttempts as error:
        handler.json({'error': 'Too many agent requests. Try again shortly.', 'retry_after': error.retry_after}, 429,
                     headers={'Retry-After': str(error.retry_after)})
    return True


def browser_get(handler, path, user):
    if path == '/api/oauth/flow':
        from urllib.parse import urlparse, parse_qs
        from .oauth_provider import OAuthProvider
        from . import settings
        origin = settings.public_url() or 'http://' + handler.headers['Host']
        flow = parse_qs(urlparse(handler.path).query).get('flow', [''])[0]
        handler.json(OAuthProvider(origin).flow_info(user['account_id'], flow))
        return True
    if path != '/api/agent-tokens':
        return False
    handler.json(AgentTokens(workbench.get_repository()).list(user['account_id']))
    return True


def browser_post(handler, path, user):
    if path == '/api/oauth/consent':
        from .oauth_provider import OAuthProvider
        from . import settings
        origin = settings.public_url() or 'http://' + handler.headers['Host']
        handler.json(OAuthProvider(origin).consent(user['account_id'], handler.read_json(16384)))
        return True
    if path not in {'/api/agent-tokens', '/api/agent-tokens/revoke'}:
        return False
    payload = handler.read_json(16 * 1024)
    service = AgentTokens(workbench.get_repository())
    if path.endswith('/revoke'):
        handler.json(service.revoke(user['account_id'], payload.get('token_id')))
    else:
        handler.accounts().verify_password(user['account_id'], payload.get('password'), handler.client_address[0])
        handler.json(service.create(user['account_id'], payload), 201)
    return True
