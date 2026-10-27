"""Persistent Phase I metadata and history, separate from connected databases.

Constructing Repository does not touch disk. Each operation uses a fresh SQLite
connection, and lifecycle changes are serialized by SQLite transactions.
"""

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import uuid

from sql_tools import main_verb, tokens


class RepositoryError(ValueError):
    """An invalid repository reference or lifecycle transition."""


SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    account_id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS browser_logins (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    failures INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE
);
CREATE TABLE IF NOT EXISTS databases (
    database_id INTEGER PRIMARY KEY,
    database_name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    database_id INTEGER NOT NULL REFERENCES databases(database_id),
    started_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE TABLE IF NOT EXISTS schema_tables (
    table_id INTEGER PRIMARY KEY,
    database_id INTEGER NOT NULL REFERENCES databases(database_id),
    table_name TEXT NOT NULL,
    is_dropped INTEGER NOT NULL DEFAULT 0 CHECK(is_dropped IN (0,1)),
    schema_sql TEXT,
    dropped_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS active_table_name
    ON schema_tables(database_id,table_name COLLATE NOCASE) WHERE is_dropped=0;
CREATE TABLE IF NOT EXISTS schema_columns (
    table_id INTEGER NOT NULL REFERENCES schema_tables(table_id),
    column_name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    default_value TEXT,
    primary_key_position INTEGER NOT NULL DEFAULT 0,
    is_dropped INTEGER NOT NULL DEFAULT 0 CHECK(is_dropped IN (0,1)),
    PRIMARY KEY(table_id,column_name)
);
CREATE TABLE IF NOT EXISTS column_constraints (
    table_id INTEGER NOT NULL,
    column_name TEXT NOT NULL,
    constraint_type TEXT NOT NULL,
    definition TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(table_id,column_name,constraint_type,definition),
    FOREIGN KEY(table_id,column_name) REFERENCES schema_columns(table_id,column_name)
);
CREATE TABLE IF NOT EXISTS column_references (
    table_id INTEGER NOT NULL,
    column_name TEXT NOT NULL,
    foreign_key_id INTEGER NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    referenced_table_id INTEGER REFERENCES schema_tables(table_id),
    referenced_table_name TEXT NOT NULL,
    referenced_column_name TEXT,
    on_update TEXT NOT NULL,
    on_delete TEXT NOT NULL,
    PRIMARY KEY(table_id,column_name,foreign_key_id,sequence),
    FOREIGN KEY(table_id,column_name) REFERENCES schema_columns(table_id,column_name),
    FOREIGN KEY(referenced_table_id,referenced_column_name)
        REFERENCES schema_columns(table_id,column_name)
);
CREATE TABLE IF NOT EXISTS requests (
    request_id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    request_text TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','confirmed','declined','executed','rejected')),
    error TEXT,
    clarification_json TEXT
);
CREATE TABLE IF NOT EXISTS sql_commands (
    command_id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(request_id),
    sql_text TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('DDL','DML','SELECT')),
    operation TEXT NOT NULL,
    requires_confirmation INTEGER NOT NULL CHECK(requires_confirmation IN (0,1)),
    confirmation_token TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','executed','declined','failed')),
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS ddl_commands (
    command_id INTEGER PRIMARY KEY REFERENCES sql_commands(command_id),
    ddl_operation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dml_commands (
    command_id INTEGER PRIMARY KEY REFERENCES sql_commands(command_id),
    dml_operation TEXT NOT NULL,
    rows_affected INTEGER
);
CREATE TABLE IF NOT EXISTS select_commands (
    command_id INTEGER PRIMARY KEY REFERENCES sql_commands(command_id),
    has_aggregation INTEGER NOT NULL CHECK(has_aggregation IN (0,1))
);
CREATE TABLE IF NOT EXISTS command_targets (
    command_id INTEGER NOT NULL REFERENCES sql_commands(command_id),
    table_name TEXT NOT NULL,
    table_id INTEGER REFERENCES schema_tables(table_id),
    access_type TEXT NOT NULL CHECK(access_type IN ('read','write','define')),
    PRIMARY KEY(command_id,table_name,access_type)
);
CREATE TABLE IF NOT EXISTS results (
    result_id INTEGER PRIMARY KEY,
    command_id INTEGER NOT NULL UNIQUE REFERENCES sql_commands(command_id),
    created_at TEXT NOT NULL,
    result_type TEXT NOT NULL CHECK(result_type IN ('table','summary','message')),
    output_text TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_session ON requests(session_id,request_id);
CREATE INDEX IF NOT EXISTS commands_request ON sql_commands(request_id,command_id);
CREATE TRIGGER IF NOT EXISTS ddl_kind BEFORE INSERT ON ddl_commands
WHEN (SELECT kind FROM sql_commands WHERE command_id=NEW.command_id) != 'DDL'
BEGIN SELECT RAISE(ABORT,'DDL subtype mismatch'); END;
CREATE TRIGGER IF NOT EXISTS dml_kind BEFORE INSERT ON dml_commands
WHEN (SELECT kind FROM sql_commands WHERE command_id=NEW.command_id) != 'DML'
BEGIN SELECT RAISE(ABORT,'DML subtype mismatch'); END;
CREATE TRIGGER IF NOT EXISTS select_kind BEFORE INSERT ON select_commands
WHEN (SELECT kind FROM sql_commands WHERE command_id=NEW.command_id) != 'SELECT'
BEGIN SELECT RAISE(ABORT,'SELECT subtype mismatch'); END;
"""


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def json_safe(value):
    """Represent SQLite BLOBs and nonfinite numbers without invalid JSON."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"type": "blob", "base64": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, sqlite3.Row):
        return json_safe(dict(value))
    return str(value)


def _check_expressions(sql):
    """Keep CHECK expressions in introspection, including nested parentheses."""
    expressions = []
    for match in re.finditer(r"\bCHECK\s*\(", sql or "", re.IGNORECASE):
        start, depth, quote = match.end(), 1, None
        index = start
        while index < len(sql) and depth:
            char = sql[index]
            if quote:
                if char == quote:
                    if index + 1 < len(sql) and sql[index + 1] == quote:
                        index += 1
                    else:
                        quote = None
            elif char in "'\"`":
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            index += 1
        if not depth:
            expressions.append(sql[start:index - 1].strip())
    return expressions


def _table_lifecycle(sql):
    """Identify table CREATE/DROP targets, excluding CREATE INDEX/AS reads."""
    parts = tokens(sql)
    values = [part[1] for part in parts]
    if not values or values[0].upper() not in {"CREATE", "DROP"}:
        return None
    operation, index = values[0].upper(), 1
    if index < len(values) and values[index].upper() in {"TEMP", "TEMPORARY"}:
        index += 1
    if index >= len(values) or values[index].upper() != "TABLE":
        return None
    index += 1
    if index < len(values) and values[index].upper() == "IF":
        index += 3 if operation == "CREATE" else 2
    if index >= len(values):
        return None
    if index + 2 < len(values) and values[index + 1] == ".":
        index += 2
    value = values[index]
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1].replace('""', '"')
    elif value.startswith("`") and value.endswith("`"):
        value = value[1:-1].replace("``", "`")
    elif value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    elif parts[index][0] != "word":
        return None
    return operation, value


class Repository:
    def __init__(self, path):
        self.path = Path(path).expanduser().resolve()
        self._initialized = False
        self._init_lock = threading.Lock()

    def _open(self):
        connection = sqlite3.connect(str(self.path), timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def _initialize(self):
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            connection = self._open()
            try:
                connection.executescript(SCHEMA)
                if "account_id" not in {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}:
                    connection.execute("ALTER TABLE sessions ADD COLUMN account_id INTEGER REFERENCES accounts(account_id)")
                if "conversation_after" not in {row[1] for row in connection.execute("PRAGMA table_info(sessions)")}:
                    connection.execute("ALTER TABLE sessions ADD COLUMN conversation_after INTEGER NOT NULL DEFAULT 0")
                if "summary" not in {row[1] for row in connection.execute("PRAGMA table_info(sql_commands)")}:
                    connection.execute("ALTER TABLE sql_commands ADD COLUMN summary TEXT NOT NULL DEFAULT ''")
                if "clarification_json" not in {row[1] for row in connection.execute("PRAGMA table_info(requests)")}:
                    connection.execute("ALTER TABLE requests ADD COLUMN clarification_json TEXT")
                connection.execute("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id,started_at)")
                connection.commit()
                self.path.chmod(0o600)
            finally:
                connection.close()
            self._initialized = True

    @contextmanager
    def _connection(self, write=False):
        self._initialize()
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _session(connection, session_id, active_only=False):
        row = connection.execute("""
            SELECT s.*,d.database_name AS database,d.path,
                   COALESCE(a.first_name,u.first_name) AS first_name,
                   COALESCE(a.last_name,u.last_name) AS last_name,COALESCE(a.email,u.email) AS email
            FROM sessions s JOIN users u USING(user_id)
            LEFT JOIN accounts a ON a.account_id=s.account_id
            JOIN databases d USING(database_id) WHERE s.session_id=?
        """, (session_id,)).fetchone()
        if row is None:
            raise RepositoryError("Unknown session.")
        if active_only and row["ended_at"] is not None:
            raise RepositoryError("This session has ended. Start a new session.")
        result = dict(row)
        result["table_count"] = connection.execute(
            "SELECT COUNT(*) FROM schema_tables WHERE database_id=? AND is_dropped=0", (row["database_id"],)
        ).fetchone()[0]
        result["duration"] = (
            (datetime.fromisoformat(row["ended_at"]) - datetime.fromisoformat(row["started_at"])).total_seconds()
            if row["ended_at"] else None
        )
        return result

    def start_session(self, first_name, last_name, email, path, name, account_id=None):
        first_name, last_name, email = (str(value or "").strip() for value in (first_name, last_name, email))
        if not first_name or not last_name or not email or "@" not in email:
            raise RepositoryError("First name, last name, and a valid email are required.")
        email = email.lower()
        database_path = str(Path(path).expanduser().resolve())
        if database_path == str(self.path):
            raise RepositoryError("The repository cannot be used as a connected database.")
        database_name = str(name or Path(database_path).name).strip()
        # Verify readability before recording a session; never create a user's file.
        source = sqlite3.connect(Path(database_path).as_uri() + "?mode=ro", uri=True)
        try:
            source.execute("SELECT name FROM sqlite_master LIMIT 1").fetchall()
        finally:
            source.close()
        session_id = str(uuid.uuid4())
        with self._connection(write=True) as connection:
            if account_id is not None:
                account = connection.execute("SELECT * FROM accounts WHERE account_id=?", (account_id,)).fetchone()
                if account is None:
                    raise RepositoryError("Unknown account.")
                first_name, last_name, email = (account[key] for key in ("first_name", "last_name", "email"))
            connection.execute("""
                INSERT INTO users(first_name,last_name,email) VALUES(?,?,?)
                ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name
            """, (first_name, last_name, email))
            user_id = connection.execute("SELECT user_id FROM users WHERE email=?", (email,)).fetchone()[0]
            connection.execute("""
                INSERT INTO databases(database_name,path) VALUES(?,?)
                ON CONFLICT(path) DO UPDATE SET database_name=excluded.database_name
            """, (database_name, database_path))
            database_id = connection.execute("SELECT database_id FROM databases WHERE path=?", (database_path,)).fetchone()[0]
            connection.execute("INSERT INTO sessions(session_id,user_id,database_id,started_at,account_id) VALUES(?,?,?,?,?)",
                               (session_id, user_id, database_id, _now(), account_id))
        try:
            self.sync_schema(database_id, database_path)
        except Exception:
            self.end_session(session_id)
            raise
        return self.get_session(session_id)

    def get_session(self, session_id, active_only=False):
        with self._connection() as connection:
            return self._session(connection, session_id, active_only)

    def list_sessions(self, email=None, account_id=None):
        with self._connection() as connection:
            sql = "SELECT s.session_id FROM sessions s JOIN users u USING(user_id)"
            params = ()
            if account_id is not None:
                sql += " WHERE s.account_id=?"
                params = (account_id,)
            elif email is not None:
                sql += " WHERE u.email=?"
                params = (str(email).strip().lower(),)
            ids = connection.execute(sql + " ORDER BY s.started_at DESC,s.session_id", params).fetchall()
            return [self._session(connection, row[0]) for row in ids]

    def end_session(self, session_id):
        with self._connection(write=True) as connection:
            self._session(connection, session_id)
            connection.execute("UPDATE sessions SET ended_at=COALESCE(ended_at,?) WHERE session_id=?", (_now(), session_id))
            connection.execute("""
                UPDATE sql_commands SET status='declined',completed_at=?
                WHERE status='pending' AND request_id IN
                    (SELECT request_id FROM requests WHERE session_id=?)
            """, (_now(), session_id))
            ids = connection.execute("SELECT request_id FROM requests WHERE session_id=?", (session_id,)).fetchall()
            for row in ids:
                self._update_request(connection, row[0], empty_status="declined")
            return self._session(connection, session_id)

    @staticmethod
    def _read_schema(path, exclude_tables):
        excluded = {str(name).lower() for name in exclude_tables}
        source = sqlite3.connect(Path(path).expanduser().resolve().as_uri() + "?mode=ro", uri=True)
        source.row_factory = sqlite3.Row
        try:
            source.execute("BEGIN")
            tables = source.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
            schema = []
            for table in tables:
                if table["name"].lower() in excluded:
                    continue
                quoted = _quote(table["name"])
                columns = [dict(row) for row in source.execute("PRAGMA table_info(" + quoted + ")")]
                unique_indexes = []
                for index in source.execute("PRAGMA index_list(" + quoted + ")").fetchall():
                    if index["unique"]:
                        names = [row["name"] for row in source.execute("PRAGMA index_info(" + _quote(index["name"]) + ")")]
                        unique_indexes.append(names)
                foreign_keys = [dict(row) for row in source.execute("PRAGMA foreign_key_list(" + quoted + ")")]
                schema.append({"name": table["name"], "sql": table["sql"], "columns": columns,
                               "unique_indexes": unique_indexes, "foreign_keys": foreign_keys})
            return schema
        finally:
            source.close()

    def sync_schema(self, database_id, path, exclude_tables=()):
        database_path = str(Path(path).expanduser().resolve())
        schema = self._read_schema(database_path, exclude_tables)
        with self._connection(write=True) as connection:
            database = connection.execute("SELECT path FROM databases WHERE database_id=?", (database_id,)).fetchone()
            if not database or database["path"] != database_path:
                raise RepositoryError("Schema path does not match the registered database.")
            current = {row["table_name"].lower(): row for row in connection.execute(
                "SELECT * FROM schema_tables WHERE database_id=? AND is_dropped=0", (database_id,))}
            names = {table["name"].lower() for table in schema}
            for key, table in current.items():
                if key not in names:
                    connection.execute("UPDATE schema_tables SET is_dropped=1,dropped_at=? WHERE table_id=?", (_now(), table["table_id"]))
            table_ids = {}
            for table in schema:
                existing = current.get(table["name"].lower())
                if existing:
                    table_id = existing["table_id"]
                    connection.execute("UPDATE schema_tables SET schema_sql=? WHERE table_id=?", (table["sql"], table_id))
                else:
                    table_id = connection.execute("INSERT INTO schema_tables(database_id,table_name,schema_sql) VALUES(?,?,?)",
                                                  (database_id, table["name"], table["sql"])).lastrowid
                table_ids[table["name"].lower()] = table_id
                connection.execute("UPDATE schema_columns SET is_dropped=1 WHERE table_id=?", (table_id,))
                checks = _check_expressions(table["sql"])
                for column in table["columns"]:
                    name = column["name"]
                    connection.execute("""
                        INSERT INTO schema_columns(table_id,column_name,data_type,default_value,primary_key_position)
                        VALUES(?,?,?,?,?) ON CONFLICT(table_id,column_name) DO UPDATE SET
                        data_type=excluded.data_type,default_value=excluded.default_value,
                        primary_key_position=excluded.primary_key_position,is_dropped=0
                    """, (table_id, name, column["type"] or "", column["dflt_value"], column["pk"]))
                    connection.execute("DELETE FROM column_constraints WHERE table_id=? AND column_name=?", (table_id, name))
                    constraints = []
                    if column["pk"]:
                        constraints.append(("PRIMARY KEY", str(column["pk"])))
                    if column["notnull"]:
                        constraints.append(("NOT NULL", ""))
                    if column["dflt_value"] is not None:
                        constraints.append(("DEFAULT", column["dflt_value"]))
                    for members in table["unique_indexes"]:
                        if name in members:
                            constraints.append(("UNIQUE", json.dumps(members)))
                    for expression in checks:
                        if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", expression, re.IGNORECASE):
                            constraints.append(("CHECK", expression))
                    for kind, definition in constraints:
                        connection.execute("INSERT OR IGNORE INTO column_constraints VALUES(?,?,?,?)", (table_id, name, kind, definition))
            # All tables/columns must exist before recording recursive references.
            by_name = {table["name"].lower(): table for table in schema}
            for table in schema:
                table_id = table_ids[table["name"].lower()]
                connection.execute("DELETE FROM column_references WHERE table_id=?", (table_id,))
                for foreign_key in table["foreign_keys"]:
                    target = by_name.get(foreign_key["table"].lower())
                    target_column = foreign_key["to"]
                    source_column = next((column["name"] for column in table["columns"]
                                          if column["name"].lower() == foreign_key["from"].lower()), foreign_key["from"])
                    if target and target_column is None:
                        primary = sorted((column for column in target["columns"] if column["pk"]), key=lambda column: column["pk"])
                        if foreign_key["seq"] < len(primary):
                            target_column = primary[foreign_key["seq"]]["name"]
                    target_id = table_ids.get(foreign_key["table"].lower())
                    if target_id:
                        actual_column = next((column["name"] for column in target["columns"]
                                              if column["name"].lower() == str(target_column).lower()), None)
                        if actual_column is None:
                            target_id = None
                        else:
                            target_column = actual_column
                    connection.execute("""
                        INSERT INTO column_references VALUES(?,?,?,?,?,?,?,?,?)
                    """, (table_id, source_column, foreign_key["id"], foreign_key["seq"], target_id,
                          foreign_key["table"], target_column, foreign_key["on_update"], foreign_key["on_delete"]))
                    connection.execute("INSERT OR IGNORE INTO column_constraints VALUES(?,?,?,?)",
                                       (table_id, source_column, "FOREIGN KEY", foreign_key["table"] + "." + str(target_column or "")))
        return self.get_schema(database_id)

    def get_schema(self, database_id, include_dropped=False):
        with self._connection() as connection:
            database = connection.execute("SELECT path FROM databases WHERE database_id=?", (database_id,)).fetchone()
            if not database:
                raise RepositoryError("Unknown database.")
            sql = "SELECT * FROM schema_tables WHERE database_id=?"
            if not include_dropped:
                sql += " AND is_dropped=0"
            result = []
            for table in connection.execute(sql + " ORDER BY table_name,table_id", (database_id,)):
                item = dict(table)
                item["name"] = item["table_name"]
                item["is_dropped"] = bool(item["is_dropped"])
                item["row_count"] = None
                item["columns"] = []
                column_sql = "SELECT * FROM schema_columns WHERE table_id=?"
                if not include_dropped:
                    column_sql += " AND is_dropped=0"
                for column in connection.execute(column_sql + " ORDER BY rowid", (table["table_id"],)):
                    detail = dict(column)
                    detail.update(name=column["column_name"], type=column["data_type"], primary_key=bool(column["primary_key_position"]), is_dropped=bool(column["is_dropped"]))
                    constraints = [dict(row) for row in connection.execute(
                        "SELECT constraint_type,definition FROM column_constraints WHERE table_id=? AND column_name=? ORDER BY constraint_type,definition",
                        (table["table_id"], column["column_name"]))]
                    detail["constraints"] = sorted({constraint["constraint_type"] for constraint in constraints})
                    detail["constraint_details"] = constraints
                    detail["references"] = [dict(row) for row in connection.execute(
                        "SELECT * FROM column_references WHERE table_id=? AND column_name=? ORDER BY foreign_key_id,sequence",
                        (table["table_id"], column["column_name"]))]
                    item["columns"].append(detail)
                item["foreign_keys"] = [reference for column in item["columns"] for reference in column["references"]]
                result.append(item)
            # Row counts are derived from the connected file, never persisted.
            source = None
            try:
                source = sqlite3.connect(Path(database["path"]).as_uri() + "?mode=ro", uri=True)
                source.execute("BEGIN")
                for item in result:
                    if not item["is_dropped"]:
                        try:
                            item["row_count"] = source.execute("SELECT COUNT(*) FROM " + _quote(item["name"])).fetchone()[0]
                        except sqlite3.Error:
                            pass  # Structure may have changed since the last sync.
            except sqlite3.Error:
                pass  # Historical metadata remains usable if the file is offline.
            finally:
                if source is not None:
                    source.close()
            return result

    def create_request(self, session_id, text):
        text = str(text or "").strip()
        if not text:
            raise RepositoryError("Request text is required.")
        with self._connection(write=True) as connection:
            self._session(connection, session_id, True)
            return connection.execute("INSERT INTO requests(session_id,request_text,submitted_at) VALUES(?,?,?)", (session_id, text, _now())).lastrowid

    def reject_request(self, request_id, error, clarification=None):
        with self._connection(write=True) as connection:
            request = connection.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if not request:
                raise RepositoryError("Unknown request.")
            if connection.execute("SELECT 1 FROM sql_commands WHERE request_id=?", (request_id,)).fetchone():
                raise RepositoryError("A request with commands cannot be rejected directly.")
            metadata = json.dumps(clarification, ensure_ascii=False, allow_nan=False) if clarification is not None else None
            connection.execute("UPDATE requests SET status='rejected',error=?,clarification_json=? WHERE request_id=?", (str(error), metadata, request_id))

    @staticmethod
    def _request_record(row):
        result = dict(row)
        metadata = json.loads(result.pop("clarification_json", None) or "{}")
        for key in ("needs_clarification", "choices", "suggestions", "intent", "task"):
            if key in metadata:
                result[key] = metadata[key]
        result["text"] = result["request_text"]
        return result

    def pending_intent(self, session_id):
        with self._connection() as connection:
            session = self._session(connection, session_id, True)
            row = connection.execute("SELECT * FROM requests WHERE session_id=? AND request_id>? ORDER BY request_id DESC LIMIT 1", (session_id, session["conversation_after"])).fetchone()
            return self._request_record(row).get("intent", "") if row else ""

    def add_command(self, request_id, sql, kind, requires_confirmation, targets=(), operation=None, has_aggregation=False, summary=""):
        kind = str(kind).upper().replace("_COMMAND", "")
        if kind not in {"DDL", "DML", "SELECT"}:
            raise RepositoryError("Command kind must be DDL, DML, or SELECT.")
        sql = str(sql or "").strip()
        if not sql:
            raise RepositoryError("SQL text is required.")
        inferred = main_verb(sql).upper()
        operation = str(operation or ("SELECT" if kind == "SELECT" else inferred)).upper()
        allowed = {"DDL": {"CREATE", "ALTER", "DROP"}, "DML": {"INSERT", "UPDATE", "DELETE", "REPLACE"}, "SELECT": {"SELECT", "WITH"}}
        if operation not in allowed[kind]:
            raise RepositoryError("Operation does not match the command kind.")
        if inferred not in allowed[kind]:
            raise RepositoryError("SQL text does not match the command kind.")
        requires_confirmation = bool(requires_confirmation or operation in {"DELETE", "DROP"})
        token = secrets.token_urlsafe(32) if requires_confirmation else None
        with self._connection(write=True) as connection:
            request = connection.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if not request:
                raise RepositoryError("Unknown request.")
            session = self._session(connection, request["session_id"], True)
            if request["status"] not in {"pending", "confirmed"}:
                raise RepositoryError("This request is already finished.")
            earlier_lifecycle = [event for item in connection.execute(
                "SELECT sql_text FROM sql_commands WHERE request_id=? ORDER BY command_id", (request_id,))
                for event in [_table_lifecycle(item["sql_text"])] if event]
            current_lifecycle = _table_lifecycle(sql)
            command_id = connection.execute("""
                INSERT INTO sql_commands(request_id,sql_text,summary,kind,operation,requires_confirmation,confirmation_token,created_at)
                VALUES(?,?,?,?,?,?,?,?)
            """, (request_id, sql, str(summary or "")[:500], kind, operation, int(requires_confirmation), token, _now())).lastrowid
            if kind == "DDL":
                connection.execute("INSERT INTO ddl_commands VALUES(?,?)", (command_id, operation))
            elif kind == "DML":
                connection.execute("INSERT INTO dml_commands(command_id,dml_operation) VALUES(?,?)", (command_id, operation))
            else:
                connection.execute("INSERT INTO select_commands VALUES(?,?)", (command_id, int(bool(has_aggregation))))
            for target in targets:
                name = str(target.get("table_name", target.get("name", ""))).strip()
                access = str(target.get("access_type", "read" if kind == "SELECT" else "define" if kind == "DDL" else "write")).lower()
                if not name or access not in {"read", "write", "define"}:
                    raise RepositoryError("A target needs a table name and read, write, or define access.")
                row = connection.execute("SELECT table_id,table_name FROM schema_tables WHERE database_id=? AND table_name=? COLLATE NOCASE AND is_dropped=0",
                                         (session["database_id"], name)).fetchone()
                future = any(event == "CREATE" and table.lower() == name.lower()
                             for event, table in earlier_lifecycle)
                recreated = (current_lifecycle and current_lifecycle[0] == "CREATE"
                             and current_lifecycle[1].lower() == name.lower()) and any(
                    event == "DROP" and table.lower() == name.lower() for event, table in earlier_lifecycle)
                if row is None and not (current_lifecycle and current_lifecycle[0] == "CREATE"
                                        and current_lifecycle[1].lower() == name.lower()) and not future:
                    raise RepositoryError("Unknown target table: " + name + ".")
                if future or recreated:
                    row = None  # Earlier commands will replace the current table instance.
                connection.execute("INSERT OR IGNORE INTO command_targets VALUES(?,?,?,?)", (command_id, row["table_name"] if row else name, row["table_id"] if row else None, access))
            return self._command(connection, command_id)

    @staticmethod
    def _command(connection, command_id, session_id=None):
        row = connection.execute("""
            SELECT c.*,r.session_id FROM sql_commands c JOIN requests r USING(request_id)
            WHERE c.command_id=?
        """, (command_id,)).fetchone()
        if row is None or (session_id is not None and row["session_id"] != session_id):
            raise RepositoryError("Unknown command for this session.")
        result = dict(row)
        result["sql"] = result.pop("sql_text")
        result["requires_confirmation"] = bool(result["requires_confirmation"])
        result["targets"] = [dict(target) for target in connection.execute("SELECT table_id,table_name,access_type FROM command_targets WHERE command_id=? ORDER BY table_name,access_type", (command_id,))]
        stored = connection.execute("SELECT * FROM results WHERE command_id=?", (command_id,)).fetchone()
        result["result"] = None
        if stored:
            result["result"] = {"result_id": stored["result_id"], "created_at": stored["created_at"], "result_type": stored["result_type"], "output_text": stored["output_text"], "payload": json.loads(stored["payload_json"])}
        if result["kind"] == "SELECT":
            subtype = connection.execute("SELECT has_aggregation FROM select_commands WHERE command_id=?", (command_id,)).fetchone()
            result["has_aggregation"] = bool(subtype[0])
        elif result["kind"] == "DML":
            result["rows_affected"] = connection.execute("SELECT rows_affected FROM dml_commands WHERE command_id=?", (command_id,)).fetchone()[0]
        return result

    def get_command(self, command_id, session_id=None):
        with self._connection() as connection:
            return self._command(connection, command_id, session_id)

    def get_request(self, request_id):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if not row:
                raise RepositoryError("Unknown request.")
            result = self._request_record(row)
            result["commands"] = [self._command(connection, item[0]) for item in connection.execute("SELECT command_id FROM sql_commands WHERE request_id=? ORDER BY command_id", (request_id,))]
            return result

    @staticmethod
    def _update_request(connection, request_id, empty_status=None):
        rows = connection.execute("SELECT status,error FROM sql_commands WHERE request_id=?", (request_id,)).fetchall()
        statuses = [row["status"] for row in rows]
        if not statuses:
            if empty_status:
                connection.execute("UPDATE requests SET status=? WHERE request_id=? AND status IN ('pending','confirmed')", (empty_status, request_id))
            return
        if "failed" in statuses:
            status = "rejected"
        elif "declined" in statuses:
            status = "declined"
        elif any(status in {"pending", "running"} for status in statuses):
            return
        else:
            status = "executed"
        error = next((row["error"] for row in rows if row["error"]), None)
        connection.execute("UPDATE requests SET status=?,error=? WHERE request_id=?", (status, error, request_id))

    @staticmethod
    def _verify_token(command, token):
        if command["requires_confirmation"]:
            if not isinstance(token, str) or not secrets.compare_digest(command["confirmation_token"] or "", token):
                raise RepositoryError("The confirmation token is missing or invalid.")

    def claim_command(self, session_id, command_id, token=None):
        with self._connection(write=True) as connection:
            session = self._session(connection, session_id, True)
            command = self._command(connection, command_id, session_id)
            self._verify_token(command, token)
            if command["status"] != "pending":
                raise RepositoryError("This command has already been handled.")
            if connection.execute("""
                SELECT 1 FROM sql_commands WHERE request_id=? AND command_id<? AND status!='executed'
            """, (command["request_id"], command_id)).fetchone():
                raise RepositoryError("Run the earlier commands in this request first.")
            connection.execute("""
                UPDATE command_targets SET table_id=(
                    SELECT t.table_id FROM schema_tables t WHERE t.database_id=?
                    AND t.table_name=command_targets.table_name COLLATE NOCASE AND t.is_dropped=0
                ) WHERE command_id=? AND table_id IS NULL
            """, (session["database_id"], command_id))
            changed = connection.execute("UPDATE sql_commands SET status='running',started_at=? WHERE command_id=? AND status='pending'", (_now(), command_id)).rowcount
            if changed != 1:
                raise RepositoryError("This command has already been handled.")
            if command["requires_confirmation"]:
                connection.execute("UPDATE requests SET status='confirmed' WHERE request_id=?", (command["request_id"],))
            return self._command(connection, command_id)

    def decline_command(self, session_id, command_id, token=None):
        with self._connection(write=True) as connection:
            self._session(connection, session_id, True)
            command = self._command(connection, command_id, session_id)
            self._verify_token(command, token)
            if command["status"] != "pending":
                raise RepositoryError("This command has already been handled.")
            connection.execute("UPDATE sql_commands SET status='declined',completed_at=? WHERE command_id=?", (_now(), command_id))
            self._update_request(connection, command["request_id"])
            return self._command(connection, command_id)

    def fail_command(self, command_id, error):
        with self._connection(write=True) as connection:
            command = self._command(connection, command_id)
            if command["status"] not in {"pending", "running"}:
                raise RepositoryError("This command has already been handled.")
            connection.execute("UPDATE sql_commands SET status='failed',error=?,completed_at=? WHERE command_id=?", (str(error), _now(), command_id))
            self._update_request(connection, command["request_id"])
            return self._command(connection, command_id)

    def finish_command(self, command_id, result, result_type="table"):
        if result_type not in {"table", "summary", "message"}:
            raise RepositoryError("Result type must be table, summary, or message.")
        payload = json_safe(result)
        payload_json = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        output_text = payload.get("output_text", payload.get("message", "")) if isinstance(payload, dict) else ""
        if not output_text:
            output_text = payload_json
        with self._connection(write=True) as connection:
            command = self._command(connection, command_id)
            if command["status"] != "running":
                raise RepositoryError("Only a claimed command can be completed.")
            session = self._session(connection, command["session_id"])
            # CREATE targets are resolved only once the real table has been synced.
            connection.execute("""
                UPDATE command_targets SET table_id=(
                    SELECT t.table_id FROM schema_tables t WHERE t.database_id=?
                    AND t.table_name=command_targets.table_name COLLATE NOCASE AND t.is_dropped=0
                ) WHERE command_id=? AND table_id IS NULL
            """, (session["database_id"], command_id))
            connection.execute("INSERT INTO results(command_id,created_at,result_type,output_text,payload_json) VALUES(?,?,?,?,?)", (command_id, _now(), result_type, str(output_text), payload_json))
            if command["kind"] == "DML":
                affected = payload.get("changes", payload.get("rows_affected", 0)) if isinstance(payload, dict) else 0
                connection.execute("UPDATE dml_commands SET rows_affected=? WHERE command_id=?", (int(affected or 0), command_id))
            connection.execute("UPDATE sql_commands SET status='executed',completed_at=? WHERE command_id=?", (_now(), command_id))
            self._update_request(connection, command["request_id"])
            return self._command(connection, command_id)

    def history(self, session_id, search="", operation=None):
        with self._connection() as connection:
            self._session(connection, session_id)
            clauses, params = ["r.session_id=?"], [session_id]
            if search:
                clauses.append("(instr(lower(r.request_text),lower(?))>0 OR EXISTS(SELECT 1 FROM sql_commands c WHERE c.request_id=r.request_id AND instr(lower(c.sql_text),lower(?))>0))")
                params.extend((str(search), str(search)))
            if operation:
                clauses.append("EXISTS(SELECT 1 FROM sql_commands c WHERE c.request_id=r.request_id AND (c.operation=? OR c.kind=?))")
                params.extend((str(operation).upper(), str(operation).upper()))
            rows = connection.execute("SELECT r.* FROM requests r WHERE " + " AND ".join(clauses) + " ORDER BY r.request_id DESC", params).fetchall()
            result = []
            for row in rows:
                request = self._request_record(row)
                request["commands"] = [self._command(connection, command[0]) for command in connection.execute("SELECT command_id FROM sql_commands WHERE request_id=? ORDER BY command_id", (row["request_id"],))]
                result.append(request)
            return result

    def conversation(self, session_id, limit=8):
        """Read bounded conversation facts, without loading saved result rows."""
        with self._connection() as connection:
            session = self._session(connection, session_id, True)
            rows = connection.execute("""
                SELECT request_id,request_text,status,error,clarification_json FROM requests
                WHERE session_id=? AND request_id>? ORDER BY request_id DESC LIMIT ?
            """, (session_id, session["conversation_after"], limit)).fetchall()
            turns, size = [], 0
            for row in rows:
                commands = []
                for command in connection.execute("""SELECT c.command_id,c.sql_text,c.summary,c.operation,c.status,c.error,
                        r.output_text,r.result_type FROM sql_commands c LEFT JOIN results r USING(command_id)
                        WHERE c.request_id=? ORDER BY c.command_id""", (row["request_id"],)):
                    targets = [dict(target) for target in connection.execute("SELECT table_name,access_type FROM command_targets WHERE command_id=?", (command["command_id"],))]
                    outcome = {"type":command["result_type"]} if command["result_type"] else None
                    output = command["output_text"] or ""
                    # Old programmatic results can store JSON here. Never send row payloads.
                    if outcome and output and not output.lstrip().startswith(("{", "[")):
                        outcome["message"] = output[:500]
                    commands.append({"sql": command["sql_text"], "operation": command["operation"],
                                     "status": command["status"], "tables": [target["table_name"] for target in targets],
                                     "targets": targets, "summary": command["summary"], "result": outcome,
                                     "error": command["error"]})
                turn = {"request_id": row["request_id"], "question": row["request_text"], "status": row["status"], "commands": commands}
                if row["error"]:
                    turn["clarification"] = row["error"]
                metadata = json.loads(row["clarification_json"] or "{}")
                for key in ("needs_clarification", "intent", "choices", "task"):
                    if key in metadata:
                        turn[key] = metadata[key]
                length = len(json.dumps(turn))
                if size + length > 24000:
                    break
                turns.append(turn)
                size += length
            return list(reversed(turns))

    def reset_conversation(self, session_id):
        with self._connection(write=True) as connection:
            self._session(connection, session_id, True)
            pending = connection.execute("""SELECT 1 FROM sql_commands c JOIN requests r USING(request_id)
                WHERE r.session_id=? AND c.status IN ('pending','running') LIMIT 1""", (session_id,)).fetchone()
            if pending:
                raise RepositoryError("Review the pending request before starting a new conversation.")
            boundary = connection.execute("SELECT COALESCE(MAX(request_id),0) FROM requests WHERE session_id=?", (session_id,)).fetchone()[0]
            connection.execute("UPDATE sessions SET conversation_after=? WHERE session_id=?", (boundary, session_id))
            return boundary
