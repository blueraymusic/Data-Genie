"""Live workspace authorization shared by chat, SQL, and manual database tools."""

from contextlib import contextmanager
import sqlite3

from .sql_tools import main_verb, tokens
from .workspaces import WorkspaceStore


CAPABILITIES = ("read", "write", "delete", "structure", "export")
LABELS = {"read": "view this database", "write": "add or edit records", "delete": "delete records",
          "structure": "change tables or columns", "export": "download database data"}


def session_access(repository, session, capability="read"):
    # Local CLI sessions without an authenticated account retain their local-file access.
    if session is None or session.get("account_id") is None:
        return None
    access = WorkspaceStore(repository).access(session["account_id"], session["database_id"])
    if not access["permissions"].get(capability, False):
        raise PermissionError("You do not have permission to " + LABELS[capability] + ". Ask the workspace owner for access.")
    return access


def required_capabilities(sql):
    operation = main_verb(sql).upper()
    required = {"read"}
    if operation in {"CREATE", "ALTER", "DROP"}:
        required.add("structure")
    elif operation == "DELETE":
        required.add("delete")
    elif operation in {"INSERT", "UPDATE", "REPLACE"}:
        required.add("write")
        # SQLite REPLACE and OR REPLACE can remove a conflicting row implicitly.
        if any(kind == "word" and value.upper() == "REPLACE" for kind, value, *_ in tokens(sql)):
            required.add("delete")
    return required


def authorize_sql(repository, session, sql, read_only=False):
    access = session_access(repository, session)
    if access is not None:
        if access["role"] != "owner" and read_only and required_capabilities(sql) != {"read"}:
            raise PermissionError("This database connection is read-only. The workspace owner must enable changes before granting edit access.")
        for capability in required_capabilities(sql):
            if not access["permissions"].get(capability, False):
                raise PermissionError("You do not have permission to " + LABELS[capability] + ". Ask the workspace owner for access.")
    return access


@contextmanager
def sqlite_permissions(connection, access, sql):
    """Enforce effects SQLite discovers, including triggers and foreign-key cascades.

    This authorizer remains installed while the statement executes, not just while
    it is explained. REPLACE's implicit deletes also have a separate SQL-level gate.
    """
    if access is None or access["role"] == "owner":
        yield
        return
    permissions = access["permissions"]
    defining = main_verb(sql).upper() in {"CREATE", "ALTER", "DROP"}
    denied = []
    unsupported = {sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
                   sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_CREATE_TEMP_VIEW,
                   sqlite3.SQLITE_CREATE_VTABLE}

    def authorize(action, first, second, database, source):
        capability = None
        if action in unsupported:
            denied.append("Only table and column structure changes are available to workspace members.")
            return sqlite3.SQLITE_DENY
        if not defining and first and not first.startswith("sqlite_"):
            if action == sqlite3.SQLITE_DELETE:
                capability = "delete"
            elif action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE}:
                capability = "write"
        if capability and not permissions.get(capability, False):
            denied.append("This change also needs permission to " + LABELS[capability] + ".")
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    connection.set_authorizer(authorize)
    try:
        yield
    except sqlite3.DatabaseError:
        if denied:
            raise PermissionError(denied[0]) from None
        raise
    finally:
        connection.set_authorizer(None)
