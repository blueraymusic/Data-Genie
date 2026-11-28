"""Bounded, hash-only preconditions for confirmed database changes.

No transaction stays open while a person reviews a preview. The executor checks
these preconditions while holding its database write locks, before making a change.
"""

import hashlib
import json
import sqlite3
import time

from .sql_tools import quote_identifier


MAX_ROWS = 20000
MAX_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 2
MAX_TABLES = 64
STALE_MESSAGE = "The database changed since this preview. Prepare the request again before confirming."


class StalePreview(ValueError):
    pass


class PreviewLimit(ValueError):
    pass


class Budget:
    def __init__(self):
        self.rows = 0
        self.bytes = 0
        self.started = time.monotonic()

    def encode(self, value):
        encoded = repr(value).encode("utf-8")
        self.rows += 1
        self.bytes += len(encoded)
        self.check()
        return encoded

    def check(self):
        if self.rows > MAX_ROWS or self.bytes > MAX_BYTES or time.monotonic() - self.started > MAX_SECONDS:
            raise PreviewLimit("This change exceeds the safe confirmation preview limit. Use your database's transaction tools for this operation.")


def names(targets):
    result = sorted({target["table_name"] for target in targets})
    if len(result) > MAX_TABLES:
        raise PreviewLimit("This change touches too many tables to preview safely. Use fewer tables per request.")
    return result


def _digest(schema, rows, budget):
    # Order-independent row digests retain duplicate counts without storing rows.
    row_hashes = [hashlib.sha256(budget.encode(row)).digest() for row in rows]
    digest = hashlib.sha256(budget.encode(schema))
    for row_hash in sorted(row_hashes):
        digest.update(row_hash)
    return digest.hexdigest()


def sqlite_snapshot(connection, targets):
    budget, tables = Budget(), {}
    for name in names(targets):
        budget.check()
        definition = [tuple(row) for row in connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name=? OR name=? ORDER BY type,name", (name, name))]
        if not any(row[0] in {"table", "view"} and row[1] == name for row in definition):
            budget.check()
            tables[name] = None
            continue
        declared = {row[1].lower() for row in connection.execute("PRAGMA table_xinfo(" + quote_identifier(name) + ")")}
        rowid = next((alias for alias in ("rowid", "_rowid_", "oid") if alias not in declared), None)
        projection = rowid + ",*" if rowid else "*"
        try:
            cursor = connection.execute("SELECT " + projection + " FROM " + quote_identifier(name))
        except sqlite3.OperationalError as error:
            if rowid is None or str(error) != "no such column: " + rowid:
                raise
            # WITHOUT ROWID tables use their declared primary key instead.
            cursor = connection.execute("SELECT * FROM " + quote_identifier(name))
        try:
            tables[name] = _digest(definition, (tuple(row) for row in cursor), budget)
        finally:
            cursor.close()
    return {"dialect": "sqlite", "tables": tables}


def postgres_snapshot(connection, namespace, targets):
    budget, tables = Budget(), {}
    for name in names(targets):
        budget.check()
        row = connection.execute("""SELECT c.oid,c.relfilenode,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
            ARRAY(SELECT ROW(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attnotnull,a.attidentity,a.attgenerated,
                a.attisdropped,pg_catalog.pg_get_expr(d.adbin,d.adrelid))::text
                FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
                  ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                WHERE a.attrelid=c.oid AND a.attnum>0 ORDER BY a.attnum) AS columns,
            ARRAY(SELECT ROW(k.conrelid,k.confrelid,k.convalidated,pg_catalog.pg_get_constraintdef(k.oid))::text
                FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid OR k.confrelid=c.oid ORDER BY k.oid) AS constraints,
            ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i
                WHERE i.indrelid=c.oid ORDER BY i.indexrelid) AS indexes,
            ARRAY(SELECT ROW(pg_catalog.pg_get_triggerdef(t.oid),t.tgenabled,pg_catalog.pg_get_functiondef(t.tgfoid))::text FROM pg_catalog.pg_trigger t
                WHERE t.tgrelid=c.oid ORDER BY t.oid) AS triggers,
            ARRAY(SELECT ROW(pg_catalog.pg_get_ruledef(r.oid),r.ev_enabled)::text FROM pg_catalog.pg_rewrite r
                WHERE r.ev_class=c.oid ORDER BY r.oid) AS rules
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=%s AND c.relname=%s""", (namespace, name)).fetchone()
        if row is None:
            budget.check()
            tables[name] = None
            continue
        if row["relkind"] not in {"r", "p"}:
            raise PreviewLimit("Changes involving views or non-table relations cannot be safely previewed. Use your database's transaction tools.")
        # MVCC tuple identity/version detects row changes without reading user values.
        statement = "SELECT tableoid::text,ctid::text,xmin::text FROM {}.{}".format(
            quote_identifier(namespace), quote_identifier(name))
        with connection.cursor(name="genie_preview_" + hashlib.sha256(name.encode()).hexdigest()[:16]) as cursor:
            cursor.execute(statement)
            tables[name] = _digest(tuple((key, row[key]) for key in sorted(row)),
                                   (tuple(record.values()) for record in cursor), budget)
    return {"dialect": "postgresql", "tables": tables}


def verify(expected, actual, targets):
    if not expected:
        raise StalePreview("This change has no saved confirmation preview. Prepare the request again before confirming.")
    if (expected.get("dialect") != actual.get("dialect") or expected.get("tables") != actual.get("tables")
            or not set(names(targets)).issubset(expected.get("tables", {}))):
        raise StalePreview(STALE_MESSAGE)


def _ensure(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS command_preview_guards (
        command_id INTEGER PRIMARY KEY REFERENCES sql_commands(command_id) ON DELETE CASCADE,
        guard_json TEXT NOT NULL)""")


def save(repository, command_id, guard):
    with repository._connection(write=True) as connection:
        _ensure(connection)
        connection.execute("INSERT OR REPLACE INTO command_preview_guards VALUES(?,?)",
                           (command_id, json.dumps(guard, sort_keys=True)))


def load(repository, command_id):
    with repository._connection(write=True) as connection:
        _ensure(connection)
        row = connection.execute("SELECT guard_json FROM command_preview_guards WHERE command_id=?", (command_id,)).fetchone()
        return json.loads(row[0]) if row else None


def advance(repository, request_id, command_id, after):
    """Advance only this request's later steps for changes made by its own step.

    ``after`` is captured under the executor's locks before commit. A later
    external edit therefore still differs from this saved post-step state.
    """
    if not after:
        return
    with repository._connection(write=True) as connection:
        _ensure(connection)
        rows = connection.execute("""SELECT g.command_id,g.guard_json FROM command_preview_guards g
            JOIN sql_commands c USING(command_id) WHERE c.request_id=? AND c.command_id>?
            AND c.status='pending'""", (request_id, command_id)).fetchall()
        for row in rows:
            guard = json.loads(row["guard_json"])
            for name in guard["tables"].keys() & after["tables"].keys():
                guard["tables"][name] = after["tables"][name]
            connection.execute("UPDATE command_preview_guards SET guard_json=? WHERE command_id=?",
                               (json.dumps(guard, sort_keys=True), row["command_id"]))
