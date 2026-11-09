"""WSGI transport for Gunicorn, sharing the local server's existing routes."""
from email.message import Message
from http import HTTPStatus
from io import BytesIO
from urllib.parse import quote, urlsplit

from .server import Handler
from . import cloud_state
from . import settings, workspace_api
from .client_ip import client_ip


class Request(Handler):
    def __init__(self, environ):
        self.path = quote(environ.get("PATH_INFO", "/"), safe="/%:@!$&'()*+,;=-._~")
        if environ.get("QUERY_STRING"):
            self.path += "?" + environ["QUERY_STRING"]
        self.command = environ.get("REQUEST_METHOD", "GET")
        self.headers = Message()
        for name, value in environ.items():
            if name.startswith("HTTP_"):
                self.headers[name[5:].replace("_", "-")] = value
        for name in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            if environ.get(name):
                self.headers[name.replace("_", "-")] = environ[name]
        self.client_address = (client_ip(environ), 0)
        self.rfile = environ["wsgi.input"]
        self.wfile = BytesIO()
        self.status = 200
        self.response_headers = []
        self.response_cookie = None
        self.response_cookies = []

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, name, value):
        self.response_headers.append((name, str(value)))

    def end_headers(self):
        pass

    def run(self):
        method = {"GET": self.do_GET, "POST": self.do_POST, "OPTIONS": self.do_OPTIONS}.get(self.command)
        if method is None:
            self.send_header("Allow", "GET, POST, OPTIONS")
            self.json({"error": "Method not allowed."}, 405)
        else:
            method()


def application(environ, start_response):
    request = Request(environ)
    hosted = False
    try:
        hosted = bool(settings.public_url())
        if settings.value("GENIE_CLOUD_STATE") == "azure_sql" and not hosted:
            raise cloud_state.StateUnavailable("The cloud HTTPS hostname is not configured.")
        # Reject foreign hosts before opening a cloud connection. Static pages and
        # the liveness probe do not wake a paused SQL database.
        origin = request.headers.get("Origin")
        cross_origin = request.command == "POST" and (
            request.headers.get("Sec-Fetch-Site") == "cross-site"
            or (origin and origin != settings.public_url())
        )
        # External identity and email requests split their own short durable
        # operations so network waits don't lock out other users.
        manages_transaction = (request.command, urlsplit(request.path).path) in {
            ("GET", "/api/auth/providers"), ("GET", "/api/auth/microsoft/start"),
            ("GET", "/api/auth/microsoft/callback"), ("POST", "/api/auth/microsoft/link"),
        }
        manages_transaction = manages_transaction or (
            request.command == "POST" and workspace_api.invitation_route(urlsplit(request.path).path) is not None)
        if hosted and request.local_host() and not cross_origin and request.path.startswith("/api/") and not manages_transaction:
            with cloud_state.transaction():
                request.run()
        else:
            request.run()
    except cloud_state.StateUnavailable as error:
        request.wfile = BytesIO()
        request.response_headers = []
        request.response_cookie = None
        request.response_cookies = []
        request.json({"error": str(error), "code": "cloud_storage_unavailable",
                      "retry_safe": error.retry_safe,
                      "recovery": "retry" if error.retry_safe else "check_history"}, 503)
    except Exception:
        request.wfile = BytesIO()
        request.response_headers = []
        request.response_cookie = None
        request.response_cookies = []
        request.json({"error": "The request could not be completed. Check History before retrying a change."}, 500)
    headers = request.response_headers + [
        ("X-Frame-Options", "DENY"),
        ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
    ]
    if not any(name.lower() == "referrer-policy" for name, _ in headers):
        headers.append(("Referrer-Policy", "same-origin"))
    if hosted:
        headers.append(("Strict-Transport-Security", "max-age=31536000"))
    start_response(str(request.status) + " " + HTTPStatus(request.status).phrase, headers)
    return [request.wfile.getvalue()]
