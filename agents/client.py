"""Small HTTPS API client. Credentials never travel in a URL or a redirect."""

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class AgentError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class AgentClient:
    def __init__(self, url=None, token=None):
        self.url = (url if url is not None else os.environ.get('DATA_GENIE_URL', 'https://data-genie.space')).rstrip('/')
        self.token = token if token is not None else os.environ.get('DATA_GENIE_API_KEY', '')
        try:
            parsed = urlsplit(self.url)
            local = parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1', '::1'}
            if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
                    or parsed.path not in {'', '/'} or (parsed.scheme != 'https' and not local)):
                raise ValueError()
            parsed.port
        except ValueError:
            raise AgentError('DATA_GENIE_URL must be an HTTPS origin, or loopback HTTP for local development.') from None
        if not re.fullmatch(r'dg_[A-Za-z0-9_-]{43}', self.token):
            raise AgentError('Set DATA_GENIE_API_KEY to a key from Account → Agents & API.')
        self.opener = build_opener(NoRedirect())

    def request(self, path, arguments=None):
        body = None if arguments is None else json.dumps(arguments, allow_nan=False).encode()
        request = Request(self.url + path, data=body, headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
            'Content-Type': 'application/json', 'User-Agent': 'Data-Genie-MCP/1.0',
        })
        try:
            with self.opener.open(request, timeout=60) as response:
                data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise AgentError('The result is too large. Select fewer columns or smaller values.')
            result = json.loads(data)
            if not isinstance(result, dict):
                raise AgentError('Data Genie returned an unreadable response.')
            return result
        except HTTPError as error:
            # Do not echo provider bodies, redirect targets, request headers or secrets.
            if error.code == 401:
                message = 'The agent key is missing, expired or revoked. Create a new key in Account.'
            elif error.code == 403:
                message = 'This key or your current workspace permissions do not allow the action.'
            elif error.code == 429:
                message = 'Agent rate limit reached. Wait before retrying.'
            elif error.code in {301, 302, 303, 307, 308}:
                message = 'Redirect blocked. Set DATA_GENIE_URL to the site’s canonical HTTPS origin.'
            else:
                message = 'Data Genie could not complete the action. Check the site before retrying changes.'
                if error.code == 400:
                    try:
                        payload = json.loads(error.read(4096))
                        if isinstance(payload, dict) and isinstance(payload.get('error'), str):
                            message = payload['error']
                    except (ValueError, UnicodeError):
                        pass
            error.close()
            raise AgentError(str(message).replace(self.token, '[redacted]')) from None
        except (URLError, TimeoutError, OSError):
            raise AgentError('Could not reach Data Genie. Check the address and connection; check the site before retrying changes.') from None
        except AgentError:
            raise
        except (ValueError, UnicodeError):
            raise AgentError('Data Genie returned an unreadable response.') from None

    def catalog(self):
        tools = self.request('/api/v1').get('tools')
        if not isinstance(tools, list) or any(not isinstance(tool, dict) or not isinstance(tool.get('name'), str)
                or not isinstance(tool.get('inputSchema'), dict) for tool in tools):
            raise AgentError('Data Genie returned an unreadable tool catalog.')
        return tools

    def call(self, name, arguments):
        if not isinstance(name, str) or not name.replace('_', '').isalpha():
            raise AgentError('Unknown action name.')
        return self.request('/api/v1/actions/' + name, arguments)
