"""Explicit database removal and consistent, database-scoped downloads."""

import csv
from collections.abc import Mapping
from contextlib import closing
import io
import json
from pathlib import Path
import secrets
import sqlite3
import zipfile

from . import workbench
from .account_deletion import AccountDeletion
from .connections.postgres import PostgresConnector
from .connections.vault import CredentialVault
from .workspaces import AUTHORIZATION_LOCK, WorkspaceStore, _integer

MAX_EXPORT_BYTES = 100 * 1024 * 1024


class _ExportBudget:
    def __init__(self):
        self.used = 0

    def add(self, size):
        self.used += size
        if self.used > MAX_EXPORT_BYTES:
            raise ValueError('This export exceeds the 100 MB download limit. Export a smaller result or use native database backup tools.')


class _BudgetText:
    def __init__(self, output, budget):
        self.output, self.budget = output, budget

    def write(self, value):
        self.budget.add(len(value.encode('utf-8')))
        return self.output.write(value)


def _record(connection, database_id):
    row = connection.execute('SELECT * FROM databases WHERE database_id=?', (database_id,)).fetchone()
    if row is None:
        raise PermissionError('This workspace or database is not available for your account.')
    return dict(row)


def _same_database(before, current):
    if (before['path'], before['connection_id']) != (current['path'], current['connection_id']):
        raise ValueError('The database changed while preparing this action. Choose the database again.')


def export_database(repository, account_id, database_id, destination, format='sqlite'):
    """Export the selected database without changing the browser's active session."""
    _integer(database_id)
    if format not in {'sqlite', 'csv', 'sql'}:
        raise ValueError('Choose SQLite, CSV folder, or SQL export.')
    store = WorkspaceStore(repository)
    store.access(account_id, database_id)
    with repository._connection() as metadata:
        record = _record(metadata, database_id)
    path = Path(record['path'])
    destination = Path(destination)
    with workbench._lock(path), AUTHORIZATION_LOCK:
        access = store.access(account_id, database_id)
        with repository._connection() as metadata:
            current = _record(metadata, database_id)
        _same_database(record, current)
        record = current
        if not access['permissions']['export']:
            raise PermissionError('You do not have permission to download this database.')
        if destination.exists():
            raise ValueError('Choose a new export destination.')
        budget = _ExportBudget()
        if record['connection_id']:
            if format != 'csv':
                raise ValueError('For PostgreSQL, choose CSV folder. Use PostgreSQL backup tools for a native backup.')
            with repository._connection() as metadata:
                row = metadata.execute('SELECT encrypted_config FROM external_connections WHERE connection_id=?', (record['connection_id'],)).fetchone()
                if row is None:
                    raise ValueError('Saved PostgreSQL connection details are no longer available. Reconnect before exporting.')
                config = CredentialVault(repository.path).decrypt(row[0])
            connector = PostgresConnector(config)
            schema = connector.schema()
            with connector.connection(read_only=True) as connection, zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED) as archive:
                # The connector initializes search_path with a SELECT. Start a
                # fresh transaction so all exported tables share one snapshot.
                connection.commit()
                connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                archive.writestr('README.txt', 'CSV tables from ' + record['database_name'] + '\nSchema metadata is in schema.json. Empty fields represent SQL NULL or an empty string. Formula-like text is prefixed with an apostrophe for spreadsheet safety. Binary values are hexadecimal. This is a data export; use PostgreSQL backup tools for a native backup.\n')
                archive.writestr('schema.json', json.dumps(schema, ensure_ascii=False, default=str, indent=2))
                for index, table in enumerate(schema, 1):
                    sql = 'SELECT * FROM ' + workbench.quote_identifier(config['schema_name']) + '.' + workbench.quote_identifier(table['name'])
                    # A named cursor keeps PostgreSQL from buffering the whole
                    # table in the application before fetchmany is called.
                    with connection.cursor(name='genie_export_' + secrets.token_hex(8)) as cursor:
                        cursor.execute(sql)
                        columns = [item.name for item in cursor.description]
                        _write_csv(archive, index, table['name'], columns, iter(lambda: cursor.fetchmany(100), []), budget)
            _ExportBudget().add(destination.stat().st_size)
            return record['database_name']
        if not path.is_file():
            raise ValueError('This database file is no longer available.')
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as source:
            workbench._protect_readonly(source)
            # Native snapshots and dumps must also fit in send_body's bounded
            # in-memory response. Check before building a potentially huge file.
            size = source.execute('PRAGMA page_count').fetchone()[0] * source.execute('PRAGMA page_size').fetchone()[0]
            if size > MAX_EXPORT_BYTES:
                _ExportBudget().add(size)
            if format == 'sqlite':
                with closing(sqlite3.connect(destination)) as output:
                    source.backup(output)
            else:
                # A read transaction gives every table in the export one snapshot.
                source.execute('BEGIN')
                if format == 'sql':
                    with destination.open('x', encoding='utf-8') as output:
                        for statement in source.iterdump():
                            budget.add(len(statement.encode('utf-8')) + 1)
                            output.write(statement + '\n')
                else:
                    with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED) as archive:
                        archive.writestr('README.txt', 'CSV tables from ' + record['database_name'] + '\nSchema is SQLite SQL in schema.sql. Empty CSV fields represent SQL NULL or an empty string. Formula-like text is prefixed with an apostrophe for spreadsheet safety. Binary values are hexadecimal. Use the SQLite file or SQL dump for an exact backup.\n')
                        definitions = source.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
                        archive.writestr('schema.sql', '\n'.join(row[0] + ';' for row in definitions))
                        tables = source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
                        for index, (name,) in enumerate(tables, 1):
                            cursor = source.execute('SELECT * FROM ' + workbench.quote_identifier(name))
                            _write_csv(archive, index, name, [item[0] for item in cursor.description], iter(lambda: cursor.fetchmany(100), []), budget)
    _ExportBudget().add(destination.stat().st_size)
    return record['database_name']


def _write_csv(archive, index, name, columns, batches, budget):
    # Numbered filenames cannot escape the archive or collide after sanitizing.
    safe_name = ''.join(char if char.isalnum() or char in '-_' else '_' for char in name)[:80] or 'table'
    with archive.open(f'{index:03d}-{safe_name}.csv', 'w') as raw:
        with io.TextIOWrapper(raw, encoding='utf-8-sig', newline='') as text:
            writer = csv.writer(_BudgetText(text, budget))
            writer.writerow([_csv_value(column) for column in columns])
            for rows in batches:
                for row in rows:
                    values = [row[column] for column in columns] if isinstance(row, Mapping) else row
                    writer.writerow([_csv_value(value) for value in values])


def _csv_value(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')):
        return "'" + value
    return value


def remove_database(repository, account_id, database_id, confirmation):
    """Delete app metadata and managed copies; never delete a remote database."""
    _integer(database_id)
    store = WorkspaceStore(repository)
    access = store.access(account_id, database_id)
    if access['role'] != 'owner':
        raise PermissionError('Only the workspace owner can remove a database.')
    with repository._connection() as connection:
        record = _record(connection, database_id)
    cleanup = AccountDeletion(repository, [workbench.DATABASE_DIRECTORY, workbench.UPLOAD_DIRECTORY])
    staged = []
    try:
        with workbench._lock(record['path']), AUTHORIZATION_LOCK, repository._connection(write=True) as connection:
            current = store._access(connection, account_id, database_id)
            if current['role'] != 'owner':
                raise PermissionError('Only the workspace owner can remove a database.')
            fresh = _record(connection, database_id)
            _same_database(record, fresh)
            record = fresh
            if confirmation != record['database_name']:
                raise ValueError('Type the database name exactly to remove it.')
            if not record['connection_id']:
                original = Path(record['path'])
                for path in [original, *[Path(str(original) + suffix) for suffix in ('-wal', '-shm', '-journal')]]:
                    if path.is_file() and cleanup._managed(path):
                        target = path.with_name(path.name + '.account-delete-' + secrets.token_hex(16))
                        path.rename(target)
                        staged.append((path, target))
                        connection.execute('INSERT INTO account_file_deletions VALUES(?)', (str(target),))
            connection.execute('CREATE TEMP TABLE removed_sessions AS SELECT session_id FROM sessions WHERE database_id=?', (database_id,))
            connection.execute('CREATE TEMP TABLE removed_requests AS SELECT request_id FROM requests WHERE session_id IN (SELECT session_id FROM removed_sessions)')
            connection.execute('CREATE TEMP TABLE removed_commands AS SELECT command_id FROM sql_commands WHERE request_id IN (SELECT request_id FROM removed_requests)')
            connection.execute('CREATE TEMP TABLE removed_tables AS SELECT table_id FROM schema_tables WHERE database_id=?', (database_id,))
            for table in ('results', 'ddl_commands', 'dml_commands', 'select_commands'):
                connection.execute(f'DELETE FROM {table} WHERE command_id IN (SELECT command_id FROM removed_commands)')
            connection.execute('DELETE FROM command_targets WHERE command_id IN (SELECT command_id FROM removed_commands) OR table_id IN (SELECT table_id FROM removed_tables)')
            connection.execute('DELETE FROM sql_commands WHERE command_id IN (SELECT command_id FROM removed_commands)')
            connection.execute('DELETE FROM requests WHERE request_id IN (SELECT request_id FROM removed_requests)')
            connection.execute('DELETE FROM agent_sessions WHERE database_id=?', (database_id,))
            connection.execute('DELETE FROM sessions WHERE database_id=?', (database_id,))
            connection.execute('DELETE FROM column_references WHERE table_id IN (SELECT table_id FROM removed_tables) OR referenced_table_id IN (SELECT table_id FROM removed_tables)')
            for table in ('column_constraints', 'schema_columns', 'schema_tables'):
                connection.execute(f'DELETE FROM {table} WHERE table_id IN (SELECT table_id FROM removed_tables)')
            connection.execute('DELETE FROM workspace_databases WHERE database_id=?', (database_id,))
            connection.execute('DELETE FROM databases WHERE database_id=?', (database_id,))
            if record['connection_id']:
                connection.execute('DELETE FROM external_connections WHERE connection_id=?', (record['connection_id'],))
    except Exception:
        for original, target in reversed(staged):
            target.rename(original)
        raise
    cleanup.cleanup()
    return {'removed': True, 'database_id': database_id}
