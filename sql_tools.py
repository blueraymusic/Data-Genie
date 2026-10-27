"""SQLite statement validation, execution and safe value serialization."""

import base64
import math
import re
import sqlite3


MAX_ROWS = 500
TOKEN = re.compile(
    r"(?P<space>\s+)|(?P<comment>--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)"
    r"|(?P<string>'(?:''|[^'])*')|(?P<identifier>\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|\[[^\]]*\])"
    r"|(?P<word>[A-Za-z_][A-Za-z_0-9]*)|(?P<number>\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)"
    r"|(?P<symbol>[^\s])"
)
ALLOWED = {"select", "with", "insert", "update", "delete", "create", "alter", "drop", "replace"}
BLOCKED = {"attach", "detach", "pragma", "vacuum", "reindex", "load_extension", "transaction", "begin", "commit", "rollback"}


def quote_identifier(name):
    return '"' + str(name).replace('"', '""') + '"'


def tokens(sql):
    """Keep strings/identifiers distinct from executable words and punctuation."""
    result = []
    for match in TOKEN.finditer(sql):
        kind = match.lastgroup
        if kind not in {"space", "comment"}:
            result.append((kind, match.group(), match.start(), match.end()))
    return result


def main_verb(sql):
    parts = tokens(sql)
    if not parts or parts[0][0] != "word":
        raise ValueError("A SQL statement must start with a supported command.")
    first = parts[0][1].lower()
    if first != "with":
        return first
    depth = 0
    for kind, value, _, _ in parts[1:]:
        if kind == "symbol":
            depth += (value == "(") - (value == ")")
        elif kind == "word" and depth == 0 and value.lower() in {"select", "insert", "update", "delete", "replace"}:
            return value.lower()
    raise ValueError("The WITH clause needs a SELECT, INSERT, UPDATE or DELETE statement.")


def validate_sql(sql):
    cleaned = str(sql).strip()
    parts = tokens(cleaned)
    if not parts:
        raise ValueError("Provide a SQL statement.")
    semicolons = [part for part in parts if part[0] == "symbol" and part[1] == ";"]
    if semicolons:
        if len(semicolons) != 1 or semicolons[0] != parts[-1]:
            raise ValueError("Use exactly one SQL statement.")
        cleaned = cleaned[:semicolons[0][2]].strip()
        parts = tokens(cleaned)
    if not parts or parts[0][0] != "word" or parts[0][1].lower() not in ALLOWED:
        raise ValueError("Only SELECT, INSERT, UPDATE, DELETE, REPLACE, CREATE, ALTER and DROP statements are allowed.")
    if any(kind == "word" and value.lower() in BLOCKED for kind, value, _, _ in parts):
        raise ValueError("That SQLite command is not available in Data Genie.")
    verb = main_verb(cleaned)
    return cleaned, "read" if verb == "select" else "write"


def json_value(value):
    if isinstance(value, bytes):
        return {"type": "blob", "encoding": "base64", "data": base64.b64encode(value).decode("ascii"), "size": len(value)}
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def row_dict(row):
    return {key: json_value(row[key]) for key in row.keys()}


def statement_details(connection, sql):
    """Prepare with SQLite's own authorizer to discover actual table accesses."""
    verb = main_verb(sql).upper()
    kind = "SELECT" if verb == "SELECT" else "DDL" if verb in {"CREATE", "ALTER", "DROP"} else "DML"
    found = {}
    define_actions = {
        sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX,
    }
    write_actions = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}
    rank = {"read": 0, "write": 1, "define": 2}

    def authorize(action, first, second, database, source):
        if action in {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() in {"load_extension", "readfile", "writefile"}:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_PRAGMA and (first or "").lower() not in {"table_info", "table_xinfo"}:
            return sqlite3.SQLITE_DENY
        name = first
        if action == sqlite3.SQLITE_ALTER_TABLE:
            name = second
        elif action in {sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_DROP_INDEX}:
            name = second
        access = "define" if action in define_actions else "write" if action in write_actions else "read" if action == sqlite3.SQLITE_READ else None
        if access and name and not name.startswith("sqlite_") and not name.startswith("pragma_"):
            if name not in found or rank[access] > rank[found[name]]:
                found[name] = access
        return sqlite3.SQLITE_OK

    connection.set_authorizer(authorize)
    try:
        connection.execute("EXPLAIN " + sql).fetchall()
    finally:
        connection.set_authorizer(None)
    words = [value.lower() for token_kind, value, _, _ in tokens(sql) if token_kind == "word"]
    return {
        "kind": kind,
        "operation": verb,
        "has_aggregation": any(word in {"sum", "avg", "count", "min", "max", "total", "group"} for word in words),
        "targets": [{"table_name": name, "access_type": access} for name, access in found.items()],
    }


def execute(connection, sql, operation):
    """Bound display results, but finish RETURNING cursors before committing."""
    cursor = connection.execute(sql)
    rows = []
    truncated = False
    if cursor.description:
        fetched = cursor.fetchmany(MAX_ROWS + 1)
        truncated = len(fetched) > MAX_ROWS
        rows = [row_dict(row) for row in fetched[:MAX_ROWS]]
        if operation == "write":
            while cursor.fetchmany(1000):
                pass
    changes = (cursor.rowcount if cursor.rowcount >= 0 else connection.total_changes) if operation == "write" else 0
    cursor.close()
    if operation == "write":
        connection.commit()
    return {"rows": rows, "changes": changes, "executed_sql": sql, "sql": sql, "truncated": truncated}
