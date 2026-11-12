"""Loopback HTTP adapter for the shared Data Genie application service."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
import base64
import binascii
import json
import hmac
import mimetypes
import re
import os
import sqlite3
import sys
import tempfile
import errno

from . import workbench
from . import settings
from . import authentication
from . import microsoft_auth
from . import workspace_api
from . import agent_api
from .access_control import session_access
from .connections import ConnectionFailure


ROOT = Path(__file__).resolve().parents[1]
MAX_JSON_BYTES = 36 * 1024 * 1024
STATIC_FILES = {
    "/favicon.svg": ("frontend/public/favicon.svg", "image/svg+xml"),
    "/": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/index.html": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/faq": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/contact": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/contact.html": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/faq.html": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/app": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/dashboard.html": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/signin": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/signup": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/databases": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/history": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/account": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/workspaces": ("frontend/dist/index.html", "text/html; charset=utf-8"),
    "/static/design.css": ("frontend/src/styles/design.css", "text/css; charset=utf-8"),
    "/static/favicon.svg": ("frontend/public/favicon.svg", "image/svg+xml"),
}


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # OAuth authorization codes and state must not enter local request logs.
        self.log_message('"%s %s %s" %s %s', self.command, urlparse(self.path).path,
                         self.request_version, str(code), str(size))

    def send_body(self, body, content_type, status=200, filename=None, headers=None):
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "response_cookie", None):
            self.send_header("Set-Cookie", self.response_cookie)
        for cookie in getattr(self, "response_cookies", []):
            self.send_header("Set-Cookie", cookie)
        if filename:
            safe = str(filename).replace('"', "_").replace("\r", "").replace("\n", "")
            safe = safe.encode("ascii", "replace").decode("ascii")
            self.send_header("Content-Disposition", f'attachment; filename="{safe}"')
        self.end_headers()
        self.wfile.write(body)

    def json(self, value, status=200, headers=None):
        self.send_body(json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), "application/json; charset=utf-8", status, headers=headers)

    def read_body(self, maximum=MAX_JSON_BYTES):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 <= length <= maximum:
            raise ValueError("Request body exceeds the permitted size.")
        return self.rfile.read(length)

    def read_json(self, maximum=MAX_JSON_BYTES):
        value = json.loads(self.read_body(maximum) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("Provide a JSON object.")
        return value

    def accounts(self):
        return authentication.Accounts(workbench.get_repository())

    def local_host(self):
        try:
            host = self.headers.get("Host", "")
            public = settings.public_url()
            if public:
                return host.lower() == urlparse(public).netloc.lower()
            return urlparse("//" + host).hostname in {"127.0.0.1", "localhost", "::1"}
        except ValueError:
            return False

    def login_token(self):
        return self.cookie_value(authentication.COOKIE_NAME)

    def cookie_value(self, name):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie[name].value if name in cookie else ""
        except Exception:
            return ""

    def account(self):
        return self.accounts().authenticate(self.login_token())

    def set_login_cookie(self, token):
        self.response_cookie = (f"{authentication.COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; "
                                f"Max-Age={authentication.LOGIN_LIFETIME if token else 0}")
        if settings.public_url():
            self.response_cookie += "; Secure"

    def set_microsoft_cookie(self, token):
        value = (f"{microsoft_auth.COOKIE_NAME}={token}; Path=/api/auth/microsoft; HttpOnly; SameSite=Lax; "
                 f"Max-Age={microsoft_auth.FLOW_LIFETIME if token else 0}")
        if settings.public_url():
            value += "; Secure"
        self.response_cookies = [value]

    def redirect(self, location):
        return self.send_body(b"", "text/plain; charset=utf-8", 303, headers={"Location": location,
                              "Referrer-Policy": "no-referrer"})

    def microsoft_config(self):
        config = microsoft_auth.configuration()
        if config and urlparse(config["redirect_uri"]).netloc.lower() == self.headers.get("Host", "").lower():
            return config
        return None

    def microsoft_get(self, path, query):
        config = self.microsoft_config()
        record = None
        try:
            if not config:
                raise microsoft_auth.MicrosoftError("unavailable")
            if len(self.path) > 16 * 1024 or any(len(values) != 1 for values in query.values()):
                raise microsoft_auth.MicrosoftError()
            browser = self.cookie_value(microsoft_auth.COOKIE_NAME)
            if path.endswith("/start"):
                intent = query.get("intent", ["signin"])[0]
                if intent not in {"signin", "link"}:
                    raise microsoft_auth.MicrosoftError()
                with microsoft_auth.durable():
                    self.accounts()._reserve_attempt(self.client_address[0], "microsoft")
                    store = microsoft_auth.FlowStore(workbench.get_repository())
                    if intent == "link":
                        record = store.consume(browser, grant=True)
                        store.active_link(record)
                        # This same-origin hop must still be made by the login
                        # that confirmed its password, not a replacement login.
                        if record["login_hash"] != authentication.token_hash(self.login_token()):
                            raise microsoft_auth.MicrosoftError("link_expired")
                flow = microsoft_auth.begin(config)  # Network outside cloud lock.
                browser = microsoft_auth.new_browser_token()
                with microsoft_auth.durable():
                    store = microsoft_auth.FlowStore(workbench.get_repository())
                    if record:
                        store.active_link(record)
                    store.save(browser, flow, intent=intent,
                               account_id=record["account_id"] if record else None,
                               login_hash=record["login_hash"] if record else (
                                   authentication.token_hash(self.login_token()) if self.login_token() else None))
                self.set_microsoft_cookie(browser)
                return self.redirect(flow["auth_uri"])
            with microsoft_auth.durable():
                record = microsoft_auth.FlowStore(workbench.get_repository()).consume(
                    browser, state=query.get("state", [None])[0])
            identity = microsoft_auth.finish(config, record["payload"], {key: values[0] for key, values in query.items()})
            with microsoft_auth.durable():
                accounts = self.accounts()
                if record["intent"] == "link":
                    microsoft_auth.FlowStore(workbench.get_repository()).active_link(record)
                    user = accounts.link_microsoft(record["account_id"], identity)
                    # Replace the login that granted this link, even when the
                    # Strict app cookie is absent on the cross-site callback.
                    with workbench.get_repository()._connection(write=True) as connection:
                        connection.execute("DELETE FROM browser_logins WHERE token_hash=?", (record["login_hash"],))
                else:
                    user = accounts.microsoft_login(identity, self.client_address[0])
                    if record["login_hash"]:
                        with workbench.get_repository()._connection(write=True) as connection:
                            connection.execute("DELETE FROM browser_logins WHERE token_hash=?", (record["login_hash"],))
                token = accounts.issue_login(user["account_id"], self.login_token())
            self.set_login_cookie(token)
            self.set_microsoft_cookie("")
            return self.redirect("/account?microsoft=linked" if record["intent"] == "link" else "/databases")
        except authentication.MicrosoftAccountError as error:
            code = {"identity_in_use": "already_linked", "invalid_identity": "invalid"}.get(error.code, error.code)
        except microsoft_auth.MicrosoftError as error:
            code = error.code
        except authentication.TooManyAttempts:
            code = "rate_limited"
        self.set_microsoft_cookie("")
        target = "/account" if record and record["intent"] in {"link", "link_grant"} else "/signin"
        return self.redirect(target + "?microsoft_error=" + code)

    def require_csrf(self):
        expected = authentication.csrf_token(self.login_token())
        supplied = self.headers.get("X-CSRF-Token", "")
        if len(supplied) != 64 or any(char not in "0123456789abcdef" for char in supplied) or not hmac.compare_digest(supplied, expected):
            raise PermissionError("Reload the page before sending this request.")

    def owned_session(self, session_id, user, active_only=False, check_access=True):
        session = workbench.get_repository().get_session(session_id)
        if session.get("account_id") != user["account_id"]:
            raise PermissionError("This session is not available for your account.")
        if check_access:
            session_access(workbench.get_repository(), session)
        if active_only and session.get("ended_at") is not None:
            raise workbench.RepositoryError("This session has ended. Start a new session.")
        return session

    def session_id(self, query=None, user=None):
        session_id = self.headers.get("X-Session-ID")
        if not session_id and query:
            session_id = query.get("session_id", [None])[0]
        if not session_id:
            raise PermissionError("Start a session first.")
        self.owned_session(session_id, user or self.account(), active_only=True)
        return session_id

    def do_GET(self):
        self.response_cookie = None
        self.response_cookies = []
        # Keep old App Service bookmarks usable without allowing API writes on
        # a second origin. Only Azure's own configured hostname may redirect.
        public = settings.public_url()
        azure_host = os.environ.get("WEBSITE_HOSTNAME", "").strip().lower()
        host = self.headers.get("Host", "").lower()
        if (public and azure_host.endswith(".azurewebsites.net")
                and host == azure_host and host != urlparse(public).netloc.lower()):
            self.send_response(308)
            self.send_header("Location", public + "/" + self.path.lstrip("/"))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self.local_host():
            return self.json({"error": "Use the local Data Genie address."}, 403)
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/healthz":
                return self.json({"status": "ok"})
            if parsed.path.startswith("/assets/"):
                filename = unquote(parsed.path[len("/assets/"):])
                if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|webp|woff2)", filename):
                    return self.json({"error": "Not found."}, 404)
                asset = (ROOT / "frontend" / "dist" / "assets" / filename).resolve()
                if asset.parent != (ROOT / "frontend" / "dist" / "assets").resolve() or not asset.is_file():
                    return self.json({"error": "Not found."}, 404)
                return self.send_body(asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
            if parsed.path in STATIC_FILES:
                name, content_type = STATIC_FILES[parsed.path]
                return self.send_body((ROOT / name).read_bytes(), content_type)
            if not parsed.path.startswith("/api/"):
                return self.json({"error": "Not found."}, 404)
            if parsed.path == "/api/auth/providers":
                return self.json({"microsoft": {"enabled": bool(self.microsoft_config())}})
            if parsed.path in {"/api/auth/microsoft/start", microsoft_auth.CALLBACK_PATH}:
                return self.microsoft_get(parsed.path, query)
            if parsed.path == "/api/auth/session":
                try:
                    user = self.account()
                    return self.json({"user": user, "csrf_token": authentication.csrf_token(self.login_token())})
                except authentication.LoginRequired:
                    return self.json({"user": None})
            if agent_api.handle(self, parsed.path):
                return
            user = self.account()
            if agent_api.browser_get(self, parsed.path, user):
                return
            if workspace_api.get(self, parsed.path, user):
                return
            if parsed.path == "/api/sessions":
                sessions = []
                for session in workbench.get_repository().list_sessions(account_id=user["account_id"]):
                    try:
                        access = session_access(workbench.get_repository(), session)
                    except PermissionError:
                        continue
                    sessions.append({**session, "access": access})
                return self.json({"sessions": sessions})
            if parsed.path == "/api/status":
                if not self.headers.get("X-Session-ID"):
                    return self.json({"session_required": True, "database": None, "tables": [], "ai": settings.public_ai_settings()})
                try:
                    with workbench.session_scope(self.session_id(user=user)):
                        return self.json(workbench.database_info())
                except workbench.RepositoryError as error:
                    return self.json({"error": str(error), "code": "session_unavailable", "recovery": "choose_database"}, 400)
            if parsed.path == "/api/history":
                explicit = query.get("history_session_id", [None])[0]
                session_id = self.headers.get("X-Session-ID") or explicit
                if not session_id:
                    raise ValueError("Choose a saved session to view its history.")
                self.owned_session(session_id, user, check_access=not bool(explicit))
                if explicit:
                    self.owned_session(explicit, user)
                search, operation = query.get("search", [""])[0], query.get("operation", [None])[0]
                paginated = "limit" in query or "offset" in query
                limit = int(query.get("limit", [20])[0]) if paginated else None
                offset = int(query.get("offset", [0])[0])
                request_id = int(query["request_id"][0]) if "request_id" in query else None
                include_pending = query.get("include_pending", ["0"])[0]
                if include_pending not in {"0", "1"}:
                    raise ValueError("Choose include_pending=0 or 1.")
                refresh_pending = explicit is None or self.headers.get("X-Session-ID") == explicit
                requests = workbench.history_for_session(session_id, search, operation, explicit,
                                                        refresh_pending=refresh_pending, limit=limit, offset=offset,
                                                        request_id=request_id)
                result = {"requests": requests}
                if paginated:
                    total = workbench.get_repository().history_count(explicit or session_id, search, operation, request_id)
                    result.update(total=total, limit=limit, offset=offset, has_more=offset + len(requests) < total)
                if include_pending == "1":
                    present = {request["request_id"] for request in requests}
                    result["pending_requests"] = [request for request in workbench.history_for_session(
                        session_id, history_session_id=explicit, refresh_pending=refresh_pending, pending_only=True)
                        if request["request_id"] not in present]
                return self.json(result)
            session_id = self.session_id(query, user=user)
            if parsed.path == "/api/schema":
                return self.json(workbench.schema_for_session(session_id))
            if parsed.path == "/api/results/page":
                return self.json(workbench.result_page(session_id, int(query.get("command_id", ["0"])[0]), int(query.get("offset", ["0"])[0])))
            if parsed.path == "/api/sample":
                table = query.get("table", [""])[0]
                with workbench.session_scope(session_id):
                    if table not in workbench.visible_tables():
                        raise ValueError("Unknown table.")
                    rows = workbench.query_rows(f"SELECT * FROM {workbench.quote_identifier(table)} LIMIT 5")
                    return self.json({"table": table, "rows": rows})
            if parsed.path == "/api/download":
                session = workbench.get_repository().get_session(session_id)
                session_access(workbench.get_repository(), session, "export")
                with tempfile.TemporaryDirectory(prefix="data-genie-export-") as directory:
                    path = workbench.export_database(session_id, Path(directory) / "download.sqlite3")
                    return self.send_body(path.read_bytes(), "application/vnd.sqlite3", filename=session["database"])
            return self.json({"error": "Not found."}, 404)
        except authentication.LoginRequired as exc:
            return self.json({"error": str(exc), "auth_required": True}, 401)
        except PermissionError as exc:
            return self.json({"error": str(exc)}, 403)
        except ConnectionFailure as exc:
            return self.json(exc.payload(), exc.status)
        except (ValueError, sqlite3.Error) as exc:
            return self.json({"error": str(exc)}, 400)
        except OSError:
            return self.json({"error": "The requested file could not be read."}, 400)

    def do_POST(self):
        self.response_cookie = None
        self.response_cookies = []
        if not self.local_host():
            return self.json({"error": "Use the local Data Genie address."}, 403)
        parsed = urlparse(self.path)
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        expected = settings.public_url() or ("http://" + host)
        if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin != expected):
            return self.json({"error": "Cross-origin requests are blocked."}, 403)
        try:
            if agent_api.handle(self, parsed.path):
                return
            if parsed.path == "/api/auth/microsoft/link":
                if not self.microsoft_config():
                    return self.json({"error": "Microsoft sign-in is unavailable right now."}, 503)
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise ValueError("Send account requests as JSON.")
                payload = self.read_json(16 * 1024)
                with microsoft_auth.durable():
                    user = self.account()
                    self.require_csrf()
                    self.accounts().verify_password(user["account_id"], payload.get("password"), self.client_address[0])
                    browser = microsoft_auth.new_browser_token()
                    microsoft_auth.FlowStore(workbench.get_repository()).save(
                        browser, {}, intent="link_grant", account_id=user["account_id"],
                        login_hash=authentication.token_hash(self.login_token()))
                self.set_microsoft_cookie(browser)
                return self.json({"url": "/api/auth/microsoft/start?intent=link"})
            if parsed.path in {"/api/auth/register", "/api/auth/login"}:
                accounts = self.accounts()
                try:
                    if not self.headers.get("Content-Type", "").startswith("application/json"):
                        raise ValueError("Send account requests as JSON.")
                    payload = self.read_json(16 * 1024)
                except (ValueError, TypeError):
                    # Invalid bodies still spend IP capacity without inventing an email key.
                    accounts._reserve_attempt(self.client_address[0], parsed.path.rsplit("/", 1)[1])
                    raise
                if parsed.path.endswith("register"):
                    user = accounts.register(payload.get("first_name"), payload.get("last_name"), payload.get("email"), payload.get("password"), self.client_address[0])
                else:
                    user = accounts.login(payload.get("email"), payload.get("password"), self.client_address[0])
                token = accounts.issue_login(user["account_id"], self.login_token())
                self.set_login_cookie(token)
                return self.json({"user": user, "csrf_token": authentication.csrf_token(token)}, 201 if parsed.path.endswith("register") else 200)
            user = self.account()
            self.require_csrf()
            if agent_api.browser_post(self, parsed.path, user):
                return
            if parsed.path == "/api/auth/logout":
                self.accounts().logout(self.login_token())
                self.set_login_cookie("")
                return self.json({"signed_out": True})
            if parsed.path == "/api/auth/password":
                payload = self.read_json()
                self.accounts().change_password(user["account_id"], payload.get("current_password"), payload.get("new_password"))
                token = self.accounts().issue_login(user["account_id"])
                self.set_login_cookie(token)
                return self.json({"user": user, "csrf_token": authentication.csrf_token(token), "message": "Password updated. Other logins have been signed out."})
            if workspace_api.post(self, parsed.path, user):
                return
            if parsed.path == "/api/sessions/end":
                # Ending an owned session also works after its database grant was revoked.
                current = self.owned_session(self.headers.get("X-Session-ID"), user, check_access=False)
                return self.json(workbench.end_session(current["session_id"]))
            if parsed.path == "/api/sessions/resume":
                payload = self.read_json()
                previous = self.owned_session(payload.get("session_id"), user)
                current = self.owned_session(self.headers["X-Session-ID"], user, check_access=False) if self.headers.get("X-Session-ID") else None
                result = workbench.resume_session(previous["session_id"])
                if current and current["session_id"] != result["session_id"]:
                    workbench.end_session(current["session_id"])
                return self.json(result)
            if parsed.path == "/api/connections/test":
                payload = self.read_json(16 * 1024)
                workspace_api.owned_workspace(user["account_id"], payload.get("workspace_id"))
                return self.json(workbench.test_postgres_connection(payload))
            if parsed.path == "/api/sessions":
                payload = self.read_json()
                # Browser clients choose a file through upload, never an arbitrary server path.
                identity = (user["first_name"], user["last_name"], user["email"])
                mode = payload.get("database_mode")
                workspace_id = workspace_api.owned_workspace(user["account_id"], payload.get("workspace_id"))
                previous = self.owned_session(self.headers["X-Session-ID"], user, check_access=False) if self.headers.get("X-Session-ID") else None
                if mode is None and payload.get("use_demo") is True:
                    mode = "demo"
                if mode == "postgresql":
                    result = workbench.start_postgres_session(user["account_id"], payload)
                elif mode in {"demo", "sample"}:
                    result = workbench.start_sample_session(*identity, account_id=user["account_id"])
                elif mode == "create":
                    result = workbench.create_database_session(*identity, name=payload.get("database_name"), starter=payload.get("starter", False) is True, account_id=user["account_id"])
                elif mode == "upload":
                    contents = base64.b64decode(payload.get("contents", ""), validate=True)
                    result = workbench.start_uploaded_session(*identity, payload.get("name", "connected.sqlite3"), contents, account_id=user["account_id"])
                else:
                    raise ValueError("Choose a database: create a new one, attach a SQLite file, or explicitly use the demo.")
                result = workspace_api.attach_session(user["account_id"], workspace_id, result)
                if previous and previous["session_id"] != result["session_id"]:
                    workbench.end_session(previous["session_id"])
                return self.json(result, 201)
            session_id = self.session_id(user=user)
            if parsed.path == "/api/connect":
                current_access = session_access(workbench.get_repository(), self.owned_session(session_id, user))
                workspace_id = workspace_api.owned_workspace(user["account_id"], current_access["workspace_id"])
                if self.headers.get("Content-Type", "").startswith("application/octet-stream"):
                    contents = self.read_body(workbench.MAX_DATABASE_BYTES)
                    name = unquote(self.headers.get("X-Filename", "connected.sqlite3"))
                else:
                    payload = self.read_json()
                    contents = base64.b64decode(payload.get("contents", ""), validate=True)
                    name = str(payload.get("name", "connected.sqlite3"))
                result = workbench.connect_upload(session_id, name, contents)
                return self.json(workspace_api.attach_session(user["account_id"], workspace_id, result))
            payload = self.read_json()
            if parsed.path == "/api/sessions/end":
                return self.json(workbench.end_session(session_id))
            if parsed.path == "/api/conversation/reset":
                return self.json(workbench.reset_conversation(session_id))
            if parsed.path == "/api/reset":
                access = session_access(workbench.get_repository(), self.owned_session(session_id, user))
                workspace_id = workspace_api.owned_workspace(user["account_id"], access["workspace_id"])
                result = workbench.reset_session(session_id, sample=payload.get("sample") is True)
                return self.json(workspace_api.attach_session(user["account_id"], workspace_id, result))
            if parsed.path == "/api/databases":
                access = session_access(workbench.get_repository(), self.owned_session(session_id, user))
                workspace_id = workspace_api.owned_workspace(user["account_id"], access["workspace_id"])
                result = workbench.create_for_session(session_id, payload.get("name"), starter=payload.get("starter", False) is True)
                return self.json(workspace_api.attach_session(user["account_id"], workspace_id, result), 201)
            if parsed.path == "/api/ask":
                return self.json(workbench.submit_request(
                    session_id, payload.get("question", ""), interpreter=payload.get("interpreter", "keywords"),
                    selected_table=payload.get("selected_table"), attachments=payload.get('attachments')
                ))
            if parsed.path == "/api/query":
                if "confirmed" in payload:
                    raise ValueError("Confirm a stored command with its session token instead of submitting confirmed SQL.")
                return self.json(workbench.submit_request(session_id, payload.get("sql", ""), raw_sql=True))
            if parsed.path in {"/api/commands/confirm", "/api/commands/decline"}:
                action = workbench.confirm_command if parsed.path.endswith("/confirm") else workbench.decline_command
                return self.json(action(session_id, int(payload.get("command_id", 0)), payload.get("confirmation_token")))
            return self.json({"error": "Not found."}, 404)
        except authentication.LoginRequired as exc:
            return self.json({"error": str(exc), "auth_required": True}, 401)
        except PermissionError as exc:
            return self.json({"error": str(exc)}, 403)
        except authentication.TooManyAttempts as exc:
            return self.json({"error": str(exc), "retry_after": exc.retry_after}, 429,
                             headers={"Retry-After": str(exc.retry_after)})
        except ConnectionFailure as exc:
            return self.json(exc.payload(), exc.status)
        except (ValueError, TypeError, binascii.Error, sqlite3.Error) as exc:
            return self.json({"error": str(exc)}, 400)
        except OSError:
            return self.json({"error": "The database file could not be accessed."}, 400)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


def main():
    try:
        port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
        if not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise SystemExit("Choose a port between 1 and 65535, for example: npm start -- 8001") from None
    workbench.get_repository()._initialize()
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise SystemExit("Build the React frontend first: npm install && npm run build")
    workbench.ensure_demo_database()
    try:
        with ThreadingHTTPServer(("127.0.0.1", port), Handler) as app:
            print(f"Data Genie running at http://127.0.0.1:{port}", flush=True)
            app.serve_forever()
    except KeyboardInterrupt:
        print("\nData Genie stopped.")
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise SystemExit(f"Port {port} is already in use. Stop the other instance or run: npm start -- 8001") from None
        raise SystemExit("Data Genie could not start. Check the selected port and local network permissions.") from None


if __name__ == "__main__":
    main()
