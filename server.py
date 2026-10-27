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

import workbench
import settings
import authentication


ROOT = Path(__file__).resolve().parent
MAX_JSON_BYTES = 36 * 1024 * 1024
STATIC_FILES = {
    "/": ("dist/index.html", "text/html; charset=utf-8"),
    "/index.html": ("dist/index.html", "text/html; charset=utf-8"),
    "/faq": ("dist/index.html", "text/html; charset=utf-8"),
    "/faq.html": ("dist/index.html", "text/html; charset=utf-8"),
    "/app": ("dist/index.html", "text/html; charset=utf-8"),
    "/dashboard.html": ("dist/index.html", "text/html; charset=utf-8"),
    "/signin": ("dist/index.html", "text/html; charset=utf-8"),
    "/signup": ("dist/index.html", "text/html; charset=utf-8"),
    "/databases": ("dist/index.html", "text/html; charset=utf-8"),
    "/history": ("dist/index.html", "text/html; charset=utf-8"),
    "/account": ("dist/index.html", "text/html; charset=utf-8"),
    "/static/design.css": ("static/design.css", "text/css; charset=utf-8"),
    "/static/favicon.svg": ("static/favicon.svg", "image/svg+xml"),
}


class Handler(BaseHTTPRequestHandler):
    def send_body(self, body, content_type, status=200, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "response_cookie", None):
            self.send_header("Set-Cookie", self.response_cookie)
        if filename:
            safe = str(filename).replace('"', "_").replace("\r", "").replace("\n", "")
            safe = safe.encode("ascii", "replace").decode("ascii")
            self.send_header("Content-Disposition", f'attachment; filename="{safe}"')
        self.end_headers()
        self.wfile.write(body)

    def json(self, value, status=200):
        self.send_body(json.dumps(value, ensure_ascii=False, allow_nan=False).encode(), "application/json; charset=utf-8", status)

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
            return urlparse("//" + self.headers.get("Host", "")).hostname in {"127.0.0.1", "localhost", "::1"}
        except ValueError:
            return False

    def login_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie[authentication.COOKIE_NAME].value if authentication.COOKIE_NAME in cookie else ""
        except Exception:
            return ""

    def account(self):
        return self.accounts().authenticate(self.login_token())

    def set_login_cookie(self, token):
        self.response_cookie = (f"{authentication.COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; "
                                f"Max-Age={authentication.LOGIN_LIFETIME if token else 0}")

    def require_csrf(self):
        expected = authentication.csrf_token(self.login_token())
        supplied = self.headers.get("X-CSRF-Token", "")
        if len(supplied) != 64 or any(char not in "0123456789abcdef" for char in supplied) or not hmac.compare_digest(supplied, expected):
            raise PermissionError("Reload the page before sending this request.")

    def owned_session(self, session_id, user, active_only=False):
        session = workbench.get_repository().get_session(session_id, active_only=active_only)
        if session.get("account_id") != user["account_id"]:
            raise PermissionError("This session is not available for your account.")
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
        if not self.local_host():
            return self.json({"error": "Use the local Data Genie address."}, 403)
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path.startswith("/assets/"):
                filename = unquote(parsed.path[len("/assets/"):])
                if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|webp|woff2)", filename):
                    return self.json({"error": "Not found."}, 404)
                asset = (ROOT / "dist" / "assets" / filename).resolve()
                if asset.parent != (ROOT / "dist" / "assets").resolve() or not asset.is_file():
                    return self.json({"error": "Not found."}, 404)
                return self.send_body(asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
            if parsed.path in STATIC_FILES:
                name, content_type = STATIC_FILES[parsed.path]
                return self.send_body((ROOT / name).read_bytes(), content_type)
            if parsed.path == "/api/auth/session":
                try:
                    user = self.account()
                    return self.json({"user": user, "csrf_token": authentication.csrf_token(self.login_token())})
                except authentication.LoginRequired:
                    if self.login_token():
                        self.set_login_cookie("")
                    return self.json({"user": None})
            user = self.account()
            if parsed.path == "/api/sessions":
                return self.json({"sessions": workbench.get_repository().list_sessions(account_id=user["account_id"])})
            if parsed.path == "/api/status":
                if not self.headers.get("X-Session-ID"):
                    return self.json({"session_required": True, "database": None, "tables": [], "ai": settings.public_ai_settings()})
                with workbench.session_scope(self.session_id(user=user)):
                    return self.json(workbench.database_info())
            session_id = self.session_id(query, user=user)
            if parsed.path == "/api/history":
                if query.get("history_session_id", [None])[0]:
                    self.owned_session(query["history_session_id"][0], user)
                requests = workbench.history_for_session(session_id, query.get("search", [""])[0],
                                                        query.get("operation", [None])[0], query.get("history_session_id", [None])[0])
                return self.json({"requests": requests})
            if parsed.path == "/api/schema":
                return self.json(workbench.schema_for_session(session_id))
            if parsed.path == "/api/sample":
                table = query.get("table", [""])[0]
                with workbench.session_scope(session_id):
                    if table not in workbench.visible_tables():
                        raise ValueError("Unknown table.")
                    rows = workbench.query_rows(f"SELECT * FROM {workbench.quote_identifier(table)} LIMIT 5")
                    return self.json({"table": table, "rows": rows})
            if parsed.path == "/api/download":
                session = workbench.get_repository().get_session(session_id)
                with tempfile.TemporaryDirectory(prefix="data-genie-export-") as directory:
                    path = workbench.export_database(session_id, Path(directory) / "download.sqlite3")
                    return self.send_body(path.read_bytes(), "application/vnd.sqlite3", filename=session["database"])
            return self.json({"error": "Not found."}, 404)
        except authentication.LoginRequired as exc:
            self.set_login_cookie("")
            return self.json({"error": str(exc), "auth_required": True}, 401)
        except PermissionError as exc:
            return self.json({"error": str(exc)}, 403)
        except (ValueError, sqlite3.Error) as exc:
            return self.json({"error": str(exc)}, 400)
        except OSError:
            return self.json({"error": "The requested file could not be read."}, 400)

    def do_POST(self):
        self.response_cookie = None
        if not self.local_host():
            return self.json({"error": "Use the local Data Genie address."}, 403)
        parsed = urlparse(self.path)
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and (urlparse(origin).netloc != host or urlparse(origin).scheme != "http")):
            return self.json({"error": "Cross-origin requests are blocked."}, 403)
        try:
            if parsed.path in {"/api/auth/register", "/api/auth/login"}:
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    raise ValueError("Send account requests as JSON.")
                payload = self.read_json(16 * 1024)
                accounts = self.accounts()
                if parsed.path.endswith("register"):
                    user = accounts.register(payload.get("first_name"), payload.get("last_name"), payload.get("email"), payload.get("password"))
                else:
                    user = accounts.login(payload.get("email"), payload.get("password"), self.client_address[0])
                token = accounts.issue_login(user["account_id"], self.login_token())
                self.set_login_cookie(token)
                return self.json({"user": user, "csrf_token": authentication.csrf_token(token)}, 201 if parsed.path.endswith("register") else 200)
            user = self.account()
            self.require_csrf()
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
            if parsed.path == "/api/sessions/resume":
                payload = self.read_json()
                previous = self.owned_session(payload.get("session_id"), user)
                if previous["ended_at"]:
                    result = workbench.start_session(user["first_name"], user["last_name"], user["email"], path=previous["path"], name=previous["database"], account_id=user["account_id"])
                else:
                    with workbench.session_scope(previous["session_id"]):
                        result = workbench.database_info()
                return self.json(result)
            if parsed.path == "/api/sessions":
                payload = self.read_json()
                # Browser clients choose a file through upload, never an arbitrary server path.
                identity = (user["first_name"], user["last_name"], user["email"])
                mode = payload.get("database_mode")
                if mode is None and payload.get("use_demo") is True:
                    mode = "demo"
                if mode in {"demo", "sample"}:
                    result = workbench.start_sample_session(*identity, account_id=user["account_id"])
                elif mode == "create":
                    result = workbench.create_database_session(*identity, name=payload.get("database_name"), starter=payload.get("starter", False) is True, account_id=user["account_id"])
                elif mode == "upload":
                    contents = base64.b64decode(payload.get("contents", ""), validate=True)
                    result = workbench.start_uploaded_session(*identity, payload.get("name", "connected.sqlite3"), contents, account_id=user["account_id"])
                else:
                    raise ValueError("Choose a database: create a new one, attach a SQLite file, or explicitly use the demo.")
                return self.json(result, 201)
            session_id = self.session_id(user=user)
            if parsed.path == "/api/connect":
                if self.headers.get("Content-Type", "").startswith("application/octet-stream"):
                    contents = self.read_body(workbench.MAX_DATABASE_BYTES)
                    name = unquote(self.headers.get("X-Filename", "connected.sqlite3"))
                else:
                    payload = self.read_json()
                    contents = base64.b64decode(payload.get("contents", ""), validate=True)
                    name = str(payload.get("name", "connected.sqlite3"))
                return self.json(workbench.connect_upload(session_id, name, contents))
            payload = self.read_json()
            if parsed.path == "/api/sessions/end":
                return self.json(workbench.end_session(session_id))
            if parsed.path == "/api/conversation/reset":
                return self.json(workbench.reset_conversation(session_id))
            if parsed.path == "/api/reset":
                return self.json(workbench.reset_session(session_id, sample=payload.get("sample") is True))
            if parsed.path == "/api/databases":
                return self.json(workbench.create_for_session(session_id, payload.get("name"), starter=payload.get("starter", False) is True), 201)
            if parsed.path == "/api/ask":
                return self.json(workbench.submit_request(
                    session_id, payload.get("question", ""), interpreter=payload.get("interpreter", "keywords"),
                    selected_table=payload.get("selected_table")
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
            self.set_login_cookie("")
            return self.json({"error": str(exc), "auth_required": True}, 401)
        except PermissionError as exc:
            return self.json({"error": str(exc)}, 403)
        except authentication.TooManyAttempts as exc:
            return self.json({"error": str(exc)}, 429)
        except (ValueError, TypeError, binascii.Error, sqlite3.Error) as exc:
            return self.json({"error": str(exc)}, 400)
        except OSError:
            return self.json({"error": "The database file could not be accessed."}, 400)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


def main():
    port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
    workbench.get_repository()._initialize()
    if not (ROOT / "dist" / "index.html").is_file():
        raise SystemExit("Build the React frontend first: npm install && npm run build")
    workbench.ensure_demo_database()
    print(f"Data Genie running at http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
