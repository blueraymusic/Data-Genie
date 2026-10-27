"""Application services shared by the CLI and HTTP interface.

Repository records describe sessions and outcomes. User table rows stay in their
own SQLite files. A session's database path never changes.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import sqlite3
import tempfile
import threading
import uuid

import keywords
import gemini_provider
from request_validation import RequestClarification, validate_request
from request_context import contextual_read
from conversation import followup_plan
import settings
from database_files import create_database_file, database_filename
from repository import Repository, RepositoryError
from sql_tools import execute, quote_identifier, row_dict, statement_details, validate_sql


ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "db" / "genie_demo.sqlite3"
REPOSITORY_PATH = ROOT / "db" / "data_genie_repository.sqlite3"
UPLOAD_DIRECTORY = ROOT / "db" / "uploads"
DATABASE_DIRECTORY = ROOT / "db" / "databases"
SHOP_DB_PATH = ROOT / "db" / "shop_sample.sqlite3"
MAX_DATABASE_BYTES = 25 * 1024 * 1024
# Fallbacks support low-level helpers in tests and scripts without a session.
ACTIVE_DB_PATH = DEFAULT_DB_PATH
ACTIVE_DB_NAME = "sales_db.sqlite3"
KeywordError = keywords.KeywordError

_session = ContextVar("data_genie_session", default=None)
_database_override = ContextVar("data_genie_database_override", default=None)
_state_lock = threading.RLock()
_repositories = {}
_database_locks = {}


class Conn(sqlite3.Connection):
    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self.close()


def get_repository():
    path = Path(REPOSITORY_PATH).expanduser().resolve()
    with _state_lock:
        if path not in _repositories:
            _repositories[path] = Repository(path)
        return _repositories[path]


def _path():
    current = _session.get()
    return Path(_database_override.get() or (current["path"] if current else ACTIVE_DB_PATH)).resolve()


def _lock(path):
    with _state_lock:
        return _database_locks.setdefault(str(Path(path).resolve()), threading.RLock())


def db(readonly=False):
    path = _path()
    if readonly:
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, factory=Conn, timeout=10)
    else:
        connection = sqlite3.connect(path, factory=Conn, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def session_scope(session_id, active_only=True):
    session = get_repository().get_session(session_id, active_only=active_only)
    token = _session.set(session)
    try:
        yield session
    finally:
        _session.reset(token)


@contextmanager
def _shadow_scope(path):
    token = _database_override.set(path)
    try:
        yield
    finally:
        _database_override.reset(token)


def ensure_demo_database():
    if DEFAULT_DB_PATH.exists():
        return
    DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DEFAULT_DB_PATH, factory=Conn) as connection:
        connection.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL);
            CREATE TABLE sales(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
                sale_date TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>=0), revenue REAL NOT NULL);
            INSERT INTO products(name,category) VALUES('Notebook','Office'),('Lamp','Home'),('Pen','Office');
            INSERT INTO sales(product_id,sale_date,units,revenue) VALUES
                (1,'2026-01-10',5,25),(2,'2026-01-22',2,60),(3,'2026-02-03',9,18),
                (1,'2026-02-14',4,20),(2,'2026-03-01',3,90);
        """)


def ensure_shop_database(path=None):
    """A separate, explicitly selected sample matching the homepage examples."""
    with _state_lock:
        sample_path = Path(path) if path is not None else SHOP_DB_PATH
        if sample_path.exists():
            return sample_path
        sample_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(sample_path, factory=Conn) as connection:
            connection.executescript("""
                PRAGMA foreign_keys=ON;
                CREATE TABLE customers(customer_id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,state TEXT);
                CREATE TABLE products(product_id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT,price REAL NOT NULL);
                CREATE TABLE sales(sale_id INTEGER PRIMARY KEY,customer_id INTEGER REFERENCES customers(customer_id),
                    product_id INTEGER REFERENCES products(product_id),sale_date TEXT,amount REAL NOT NULL);
                INSERT INTO customers VALUES
                    (1,'Ana Brooks','ana.brooks@example.com','Illinois'),
                    (2,'Jon Reyes','jon.reyes@example.com','Missouri'),
                    (5,'Priya Nair','priya.nair@example.com','Missouri'),
                    (9,'Tom Whitaker','tom.w@example.com','Missouri'),
                    (10,'Avery Chen','avery.chen@example.com','Iowa'),
                    (11,'Sam Patel','sam.patel@example.com','Kansas');
                INSERT INTO products VALUES
                    (1,'Trail pack','Outdoor',61.40),(2,'Mixing bowl','Kitchen',48.75),
                    (3,'Desk organizer','Office',37.20),(4,'Building blocks','Toys',22.90);
                INSERT INTO sales VALUES
                    (1,2,1,'2023-02-12',61.40),(2,5,2,'2023-03-08',48.75),(3,9,3,'2023-10-09',37.20),
                    (4,2,4,'2026-08-12',22.90),(5,5,1,'2026-09-05',61.40),(6,9,2,'2026-09-06',48.75),
                    (7,10,3,'2026-10-10',37.20),(8,11,4,'2026-10-11',22.90);
            """)
    return sample_path


def visible_tables():
    with db(readonly=True) as connection:
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return [name for name in names if not (_path() == DEFAULT_DB_PATH.resolve() and name == "preset_answers")]


def table_schema(name):
    with db(readonly=True) as connection:
        quoted = quote_identifier(name)
        columns = []
        for column in connection.execute(f"PRAGMA table_info({quoted})"):
            constraints = []
            if column["pk"]:
                constraints.append("PRIMARY KEY")
            if column["notnull"]:
                constraints.append("NOT NULL")
            columns.append({"name": column["name"], "type": column["type"], "primary_key": bool(column["pk"]),
                            "not_null": bool(column["notnull"]), "default": column["dflt_value"], "constraints": constraints})
        keys = [dict(row) for row in connection.execute(f"PRAGMA foreign_key_list({quoted})")]
        for key in keys:
            key["single_column"] = sum(other["id"] == key["id"] for other in keys) == 1
        count = connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0]
    return {"name": name, "row_count": count, "columns": columns, "foreign_keys": keys}


def query_rows(sql, params=()):
    with db(readonly=True) as connection:
        return [row_dict(row) for row in connection.execute(sql, params).fetchall()]


def execute_sql(sql, operation):
    with db(readonly=(operation == "read")) as connection:
        # Preparation authorizes the actual SQLite operations, including CTEs.
        statement_details(connection, sql)
        return execute(connection, sql, operation)


def keyword_plan(question):
    return keywords.plan(question, visible_tables(), table_schema)


def database_info():
    current = _session.get()
    tables = visible_tables()
    path = _path()
    if path in {DEFAULT_DB_PATH.resolve(), SHOP_DB_PATH.resolve()} or (path.parent == DATABASE_DIRECTORY.resolve() and path.name.startswith("sample-")):
        source = "demo"
    elif path.is_relative_to(UPLOAD_DIRECTORY.resolve()):
        source = "uploaded"
    elif path.is_relative_to(DATABASE_DIRECTORY.resolve()):
        source = "created"
    else:
        source = "attached"
    return {**(current or {}), "database": current["database"] if current else ACTIVE_DB_NAME,
            "tables": tables, "table_count": len(tables), "source": source,
            "table_details": [table_schema(name) for name in tables], "ai": settings.public_ai_settings()}


def database_structure():
    """Return a readable whole-database structure without asking an AI to invent PRAGMA SQL."""
    rows = []
    for table in visible_tables():
        detail = table_schema(table)
        references = {key.get("from"): f"{key.get('table')}.{key.get('to')}" for key in detail["foreign_keys"]}
        for column in detail["columns"]:
            rows.append({
                "table": table,
                "column": column["name"],
                "type": column["type"] or "",
                "primary_key": bool(column["primary_key"]),
                "required": bool(column["not_null"]),
                "references": references.get(column["name"]) or "",
            })
    return rows


def _sync(session):
    excluded = ("preset_answers",) if Path(session["path"]).resolve() == DEFAULT_DB_PATH.resolve() else ()
    return get_repository().sync_schema(session["database_id"], session["path"], exclude_tables=excluded)


def _validate_database(path):
    path = Path(path).expanduser().resolve()
    if path == Path(REPOSITORY_PATH).expanduser().resolve():
        raise ValueError("Choose a data database, separate from the Data Genie repository.")
    if not path.is_file():
        raise ValueError("That database does not exist. Attach an existing SQLite file or create a new database first.")
    with path.open("rb") as stream:
        if stream.read(16) != b"SQLite format 3\x00":
            raise ValueError("Choose a valid SQLite database file.")
    try:
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, factory=Conn) as connection:
            check = connection.execute("PRAGMA quick_check").fetchone()
            if check is None or check[0] != "ok":
                raise ValueError("The selected database failed its integrity check.")
    except sqlite3.Error as exc:
        raise ValueError("This file is not a readable SQLite database.") from exc
    return path


def start_session(first_name, last_name, email, path=None, name=None, use_demo=False, account_id=None):
    if use_demo or path is None:
        ensure_demo_database()
        path = DEFAULT_DB_PATH
    path = _validate_database(path)
    with _lock(path):
        session = get_repository().start_session(first_name, last_name, email, str(path), name or path.name, account_id=account_id)
        _sync(session)
        with session_scope(session["session_id"]):
            return database_info()


def create_database_session(first_name, last_name, email, path=None, name=None, starter=True, account_id=None):
    """Create a new data file and start its session; failure never overwrites data."""
    display_name = database_filename(name or (Path(path).name if path else "my_database.sqlite3"))
    destination = Path(path).expanduser().resolve() if path is not None else DATABASE_DIRECTORY / (uuid.uuid4().hex + ".sqlite3")
    if destination.resolve() == Path(REPOSITORY_PATH).expanduser().resolve():
        raise ValueError("The repository cannot be used as a data database.")
    created = create_database_file(destination, starter=starter)
    try:
        result = start_session(first_name, last_name, email, path=created, name=display_name, account_id=account_id)
        result["source"] = "created"
        return result
    except Exception:
        created.unlink(missing_ok=True)
        raise


def create_for_session(session_id, name, starter=True):
    current = get_repository().get_session(session_id, active_only=True)
    result = create_database_session(current["first_name"], current["last_name"], current["email"], name=name, starter=starter, account_id=current.get("account_id"))
    end_session(session_id)
    return result


def end_session(session_id):
    session = get_repository().get_session(session_id)
    with _lock(session["path"]):
        return get_repository().end_session(session_id)


def list_user_sessions(email):
    if not email:
        raise ValueError("An email is required to list sessions.")
    return get_repository().list_sessions(email=email)


def schema_for_session(session_id):
    with session_scope(session_id) as session, _lock(_path()):
        tables = _sync(session)
        return {"session_id": session_id, "database": session["database"], "tables": tables}


def history_for_session(session_id, search="", operation=None, history_session_id=None):
    repository = get_repository()
    current = repository.get_session(session_id)
    target_id = history_session_id or session_id
    target = repository.get_session(target_id)
    if current["user_id"] != target["user_id"]:
        raise ValueError("That history belongs to a different user.")
    if current.get("account_id") != target.get("account_id"):
        raise ValueError("That history belongs to a different account.")
    requests = repository.history(target_id, search=search, operation=operation)
    # A restored confirmation must show a fresh preview, including after reload.
    if target_id == session_id and current["ended_at"] is None:
        with session_scope(session_id), _lock(current["path"]):
            for request in requests:
                pending = [command for command in request["commands"] if command["status"] == "pending" and command["requires_confirmation"]]
                if not pending:
                    continue
                try:
                    plans = _prepare_plans([{"sql": command["sql"]} for command in pending])
                    for command, plan in zip(pending, plans):
                        command["preview"] = plan.get("preview")
                except (ValueError, sqlite3.Error) as exc:
                    for command in pending:
                        command["preview_error"] = "The database changed. Decline this request and prepare it again. " + str(exc)
    return requests


def _display(command, visualization=None):
    sql = command["sql"]
    visualization = visualization or ("line" if " AS period" in sql else "bar" if " AS label" in sql else "table")
    return {"matched": True, "session_id": command["session_id"], "request_id": command["request_id"],
            "command_id": command["command_id"], "confirmation_token": command["confirmation_token"],
            "requires_confirmation": command["requires_confirmation"] and command["status"] == "pending",
            "operation": "read" if command["kind"] == "SELECT" else "write", "sql_operation": command["operation"],
            "kind": command["kind"], "status": command["status"], "sql": sql, "visualization": visualization,
            "answer": f"{command['operation'].title()} command.", "rows": [], "changes": 0, "targets": command.get("targets", [])}


def _run_command(session_id, command_id, token=None, summary=None, visualization=None):
    repository = get_repository()
    command = repository.get_command(command_id, session_id)
    earlier = [item for item in repository.get_request(command["request_id"])["commands"] if item["command_id"] < command_id]
    if any(item["status"] != "executed" for item in earlier):
        raise ValueError("Run the earlier commands in this request first. A declined or failed step prevents later execution.")
    command = repository.claim_command(session_id, command_id, token)
    response = _display(command, visualization)
    if summary:
        response["answer"] = summary
    try:
        result = execute_sql(command["sql"], response["operation"])
        response.update(result)
        response.update(status="executed", requires_confirmation=False, schema_changed=command["kind"] == "DDL")
        response["message"] = f"{result['changes']} row(s) affected." if response["operation"] == "write" else f"{len(result['rows'])} row(s) returned."
        if command["kind"] == "DDL":
            _sync(_session.get())
        result_type = "summary" if command.get("has_aggregation") else "table" if response["operation"] == "read" or result["rows"] else "message"
        response["result_type"] = result_type
        if command["kind"] == "DDL":
            table = next((target["table_name"] for target in command.get("targets", []) if target["access_type"] == "define"), "table")
            verb = {"CREATE": "Created", "ALTER": "Changed", "DROP": "Dropped"}.get(command["operation"], "Changed")
            response["message"] = f"{verb} table {table}."
        repository.finish_command(command_id, response, result_type)
        return response
    except Exception as exc:
        repository.fail_command(command_id, str(exc))
        raise


def _prepare_plans(source_plans):
    """Validate untrusted SQL against a throwaway snapshot, without real writes."""
    if not source_plans:
        raise ValueError("No SQL commands were prepared.")
    prepared = []
    with tempfile.TemporaryDirectory(prefix="data-genie-plan-") as directory:
        shadow = Path(directory) / "plan.sqlite3"
        with db(readonly=True) as source, sqlite3.connect(shadow, factory=Conn) as destination:
            source.backup(destination)
        with _shadow_scope(shadow):
            for plan in source_plans:
                sql, operation = validate_sql(plan["sql"])
                with db() as connection:
                    details = statement_details(connection, sql)
                    if operation == "read" and not details["targets"]:
                        message = (
                            "This database has no tables yet. Create a table or connect a database before asking about its data."
                            if not visible_tables() else
                            "Name a table and what you want to see. The generated query did not read your database."
                        )
                        raise RequestClarification(message)
                    # This checks SQLite CHECK/UNIQUE/NOT NULL/FK constraints before confirmation.
                    if operation == "write":
                        plan = {**plan, "preview": _preview_write(connection, sql, details)}
                prepared.append({**plan, **details, "sql": sql, "access": operation})
    return prepared


def _prepare(text, raw_sql):
    """Prepare keyword or SQL-workspace requests through the common safe path."""
    fragments = [text] if raw_sql else keywords.split_requests(text)
    prepared = []
    with tempfile.TemporaryDirectory(prefix="data-genie-plan-") as directory:
        shadow = Path(directory) / "plan.sqlite3"
        with db(readonly=True) as source, sqlite3.connect(shadow, factory=Conn) as destination:
            source.backup(destination)
        with _shadow_scope(shadow):
            for fragment in fragments:
                plan = {"sql": fragment, "summary": "Prepared from your request.", "visualization": "table"} if raw_sql else keyword_plan(fragment)
                sql, operation = validate_sql(plan["sql"])
                with db() as connection:
                    details = statement_details(connection, sql)
                    if operation == "write":
                        plan = {**plan, "preview": _preview_write(connection, sql, details)}
                prepared.append({**plan, **details, "sql": sql, "access": operation})
    return prepared


def _preview_write(connection, sql, details):
    targets = details.get("targets", [])
    target = next((item["table_name"] for item in targets if item["access_type"] in {"write", "define"}), None)
    count = None
    if details["operation"] == "DROP" and target:
        count = connection.execute("SELECT COUNT(*) FROM " + quote_identifier(target)).fetchone()[0]
    result = execute(connection, sql, "write")
    return {"table": target, "affected_rows": count if count is not None else result["changes"]}


def submit_request(session_id, text, raw_sql=False, interpreter="keywords", selected_table=None):
    text = str(text or "").strip()
    if not text:
        raise ValueError("A request is required.")
    interpreter = "keywords" if raw_sql else str(interpreter or "keywords").lower()
    if interpreter not in {"keywords", "gemini"}:
        raise ValueError("Choose Keywords or Gemini AI.")
    with session_scope(session_id) as session, _lock(_path()):
        # Structural inspection is function 2; it does not create history records.
        if not raw_sql and keywords.wants_database_structure(text):
            rows = database_structure()
            return {"matched": True, "metadata": True, "session_id": session_id, "rows": rows,
                    "answer": "Database structure.", "visualization": "table", "operation": "read",
                    "requires_confirmation": False, "message": f"{len(rows)} column(s) across {len(visible_tables())} table(s)."}
        if not raw_sql:
            metadata = keywords.metadata_plan(text, visible_tables())
            if metadata:
                sql, operation = validate_sql(metadata["sql"])
                result = execute_sql(sql, operation)
                return {**result, "matched": True, "metadata": True, "session_id": session_id,
                        "answer": metadata["summary"], "visualization": "table", "operation": "read", "requires_confirmation": False}
        repository = get_repository()
        conversation = repository.conversation(session_id) if not raw_sql else []
        request_id = repository.create_request(session_id, text)
        try:
            context_plan = None
            if not raw_sql:
                validate_request(text, has_context=bool(conversation))
                tables = visible_tables()
                selected_table = keywords.resolve_table(str(selected_table), tables) if selected_table else None
                context_plan = contextual_read(text, tables, table_schema, selected_table)
                if not context_plan and interpreter == "keywords":
                    context_plan = followup_plan(text, conversation, selected_table, _query_columns)
            if context_plan:
                plans = _prepare_plans([context_plan])
            elif interpreter == "gemini":
                config = settings.gemini_settings()
                plans = _prepare_plans(gemini_provider.generate_plans(
                    text, [table_schema(name) for name in tables], config["api_key"], config["model"],
                    selected_table=selected_table, conversation=conversation
                ))
            else:
                plans = _prepare(text, raw_sql)
        except (ValueError, sqlite3.Error, gemini_provider.GeminiError) as exc:
            repository.reject_request(request_id, str(exc))
            return {"matched": False, "session_id": session_id, "request_id": request_id, "interpreter": interpreter,
                    "needs_clarification": isinstance(exc, RequestClarification), "suggestions": getattr(exc, "suggestions", []), "message": str(exc)}
        commands = []
        deferred = False
        for plan in plans:
            deferred = deferred or plan["access"] == "write"
            command = repository.add_command(request_id, plan["sql"], plan["kind"], deferred,
                                             targets=plan["targets"], operation=plan["operation"], has_aggregation=plan["has_aggregation"])
            commands.append(command)
        responses = []
        for command, plan in zip(commands, plans):
            if command["requires_confirmation"]:
                response = _display(command, plan["visualization"])
                response["answer"] = plan["summary"]
                response["preview"] = plan.get("preview")
            else:
                try:
                    response = _run_command(session_id, command["command_id"], summary=plan["summary"], visualization=plan["visualization"])
                except (ValueError, sqlite3.Error) as exc:
                    response = {**_display(repository.get_command(command["command_id"])), "error": str(exc), "matched": False}
            responses.append(response)
        return {**responses[0], "commands": responses, "interpreter": interpreter}


def _query_columns(sql):
    sql, access = validate_sql(sql)
    if access != "read":
        raise ValueError("A conversation follow-up must refer to a read query.")
    with db(readonly=True) as connection:
        statement_details(connection, sql)
        return [column[0] for column in connection.execute(f"SELECT * FROM ({sql}) LIMIT 0").description]


def reset_conversation(session_id):
    with session_scope(session_id), _lock(_path()):
        boundary = get_repository().reset_conversation(session_id)
        return {"session_id": session_id, "conversation_after": boundary}


def confirm_command(session_id, command_id, confirmation_token):
    with session_scope(session_id), _lock(_path()):
        # Recheck after the lock, so an ended session cannot execute a pending write.
        get_repository().get_session(session_id, active_only=True)
        return _run_command(session_id, int(command_id), confirmation_token)


def decline_command(session_id, command_id, confirmation_token):
    with session_scope(session_id), _lock(_path()):
        repository = get_repository()
        command = repository.decline_command(session_id, int(command_id), confirmation_token)
        declined = [command["command_id"]]
        for following in repository.get_request(command["request_id"])["commands"]:
            if following["command_id"] > command["command_id"] and following["status"] == "pending":
                repository.decline_command(session_id, following["command_id"], following["confirmation_token"])
                declined.append(following["command_id"])
        return {**_display(command), "declined_command_ids": declined}


def start_uploaded_session(first_name, last_name, email, name, contents, account_id=None):
    if not contents or len(contents) > MAX_DATABASE_BYTES:
        raise ValueError("Choose a SQLite file between 1 byte and 25 MB.")
    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    path = UPLOAD_DIRECTORY / (uuid.uuid4().hex + ".sqlite3")
    try:
        path.write_bytes(contents)
        result = start_session(first_name, last_name, email, path=path, name=Path(name or "connected.sqlite3").name, account_id=account_id)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return result


def connect_upload(session_id, name, contents):
    current = get_repository().get_session(session_id, active_only=True)
    result = start_uploaded_session(current["first_name"], current["last_name"], current["email"], name, contents, account_id=current.get("account_id"))
    end_session(session_id)
    return result


def reset_session(session_id, sample=False):
    current = get_repository().get_session(session_id, active_only=True)
    if current.get("account_id") is not None:
        result = start_sample_session(current["first_name"], current["last_name"], current["email"], current["account_id"])
    else:
        result = start_session(current["first_name"], current["last_name"], current["email"], path=ensure_shop_database(), name="shop.sqlite") if sample else start_session(current["first_name"], current["last_name"], current["email"], use_demo=True)
    end_session(session_id)
    return result


def start_sample_session(first_name, last_name, email, account_id):
    """Each authenticated user gets a fresh sample, never a shared writable file."""
    path = DATABASE_DIRECTORY / ("sample-" + uuid.uuid4().hex + ".sqlite3")
    try:
        ensure_shop_database(path)
        return start_session(first_name, last_name, email, path=path, name="shop.sqlite", account_id=account_id)
    except Exception:
        path.unlink(missing_ok=True)
        raise


def export_database(session_id, destination):
    destination = Path(destination).expanduser().resolve()
    with session_scope(session_id), _lock(_path()):
        if destination.exists():
            raise ValueError("Choose a new destination; exporting will not overwrite an existing file.")
        try:
            with db(readonly=True) as source, sqlite3.connect(destination, factory=Conn) as output:
                source.backup(output)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    return destination
