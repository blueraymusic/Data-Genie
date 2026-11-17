"""Durable, operation-transformed working copies for report coauthors.

The live copy is separate from the saved report, so typing never changes a
published finding until an owner explicitly saves it. Text positions count
Unicode code points in both the browser and server.
"""
import json
import time

from .reports import ReportStore
from .workspaces import _serialized


def lengths(operation):
    before = after = 0
    for part in operation:
        if isinstance(part, str):
            after += len(part)
        elif part > 0:
            before += part
            after += part
        else:
            before -= part
    return before, after


def append(operation, part):
    if part == '' or part == 0:
        return
    if operation and type(part) is type(operation[-1]) and (
            isinstance(part, str) or (part > 0) == (operation[-1] > 0)):
        operation[-1] += part
    else:
        operation.append(part)


def transform(left, right, left_first=True):
    """Transform concurrent operations; insert ties use stable operation IDs."""
    left, right = list(left), list(right)
    output_left, output_right = [], []
    i = j = 0
    while i < len(left) or j < len(right):
        a = left[i] if i < len(left) else None
        b = right[j] if j < len(right) else None
        if isinstance(a, str) and (not isinstance(b, str) or left_first):
            append(output_left, a)
            append(output_right, len(a))
            i += 1
            continue
        if isinstance(b, str):
            append(output_left, len(b))
            append(output_right, b)
            j += 1
            continue
        if a is None or b is None:
            raise ValueError('The live edit does not match this report. Reopen the editor.')
        count = min(abs(a), abs(b))
        if a > 0 and b > 0:
            append(output_left, count)
            append(output_right, count)
        elif a < 0 < b:
            append(output_left, -count)
        elif b < 0 < a:
            append(output_right, -count)
        left[i] += -count if a > 0 else count
        right[j] += -count if b > 0 else count
        if left[i] == 0:
            i += 1
        if right[j] == 0:
            j += 1
    return output_left, output_right


def apply(text, operation):
    result, cursor = [], 0
    for part in operation:
        if isinstance(part, str):
            result.append(part)
        elif part > 0:
            result.append(text[cursor:cursor + part])
            cursor += part
        else:
            cursor -= part
    if cursor != len(text):
        raise ValueError('The live edit does not match this report. Reopen the editor.')
    return ''.join(result)


def replacement(before, after):
    result = []
    if before:
        result.append(-len(before))
    if after:
        result.append(after)
    return result


def record(connection, report_id, revision, operation_id, field, operation, old_length):
    connection.execute('''INSERT INTO report_edit_operations
        (report_id,revision,operation_id,field,operation_json,old_length) VALUES(?,?,?,?,?,?)''',
        (report_id, revision, operation_id, field, json.dumps(operation, ensure_ascii=False), old_length))
    # Keep enough history for active tabs to merge, without letting a long
    # editing session inflate the cloud state snapshot indefinitely.
    connection.execute('''DELETE FROM report_edit_operations WHERE report_id=? AND revision IN (
        SELECT revision FROM (SELECT revision,ROW_NUMBER() OVER (ORDER BY revision DESC) AS position,
            SUM(length(CAST(operation_json AS BLOB))) OVER (ORDER BY revision DESC) AS bytes
            FROM report_edit_operations WHERE report_id=?) WHERE position>1000 OR bytes>1048576)''',
        (report_id, report_id))


def save_snapshot(connection, row, payload):
    """Validate a live revision before the caller updates the saved snapshot."""
    live = connection.execute('SELECT * FROM report_collaboration WHERE report_id=?', (row['report_id'],)).fetchone()
    if live is None:
        return
    requested = payload.get('collaboration_revision')
    if requested is None and payload.get('published', False) != bool(row['published']) and all(
            payload[field].strip() == row[field] for field in ('title', 'body')):
        # Sharing controls act on the reviewed snapshot. They must neither
        # publish nor overwrite a coauthor's separate working draft.
        connection.execute('UPDATE report_collaboration SET base_version=? WHERE report_id=?',
                           (row['version'] + 1, row['report_id']))
        return
    if requested is not None:
        if type(requested) is not int or requested != live['revision'] or any(
                payload[field] != live[field] for field in ('title', 'body')):
            raise ValueError('The live draft changed while saving. Your writing is kept; review the latest draft and save again.')
    elif any(live[field] != row[field] for field in ('title', 'body')):
        raise ValueError('This report has a live draft. Open the report editor to review and save it.')
    revision = live['revision']
    # Saves through older clients or agent APIs are also represented in the log.
    # Active collaborators can merge these replacements instead of losing text.
    for field in ('title', 'body'):
        value = payload[field].strip()
        if value != live[field]:
            revision += 1
            record(connection, row['report_id'], revision, f'save:{row["version"] + 1}:{field}',
                   field, replacement(live[field], value), len(live[field]))
    connection.execute('''UPDATE report_collaboration SET base_version=?,revision=?,title=?,body=? WHERE report_id=?''',
        (row['version'] + 1, revision, payload['title'].strip(), payload['body'].strip(), row['report_id']))


class ReportCollaboration(ReportStore):
    @classmethod
    def _editable(cls, connection, account_id, workspace_id, report_id):
        workspace = cls._membership(connection, account_id, workspace_id)
        cls._editor(workspace)
        report = cls._visible_report(connection, workspace, account_id, report_id)
        if not cls._permissions(workspace, report, account_id)['can_edit']:
            raise PermissionError('This report is not available for live editing.')
        connection.execute('''INSERT INTO report_collaboration(report_id,base_version,title,body)
            VALUES(?,?,?,?) ON CONFLICT(report_id) DO NOTHING''',
            (report_id, report['version'], report['title'], report['body']))
        return report

    @staticmethod
    def _response(connection, report_id, after, client_id, account_id):
        live = connection.execute('SELECT * FROM report_collaboration WHERE report_id=?', (report_id,)).fetchone()
        first = connection.execute('SELECT MIN(revision) FROM report_edit_operations WHERE report_id=?', (report_id,)).fetchone()[0]
        reset = first is not None and after < first - 1
        rows = connection.execute('''SELECT * FROM report_edit_operations
            WHERE report_id=? AND revision>? ORDER BY revision''', (report_id, after)).fetchall()
        now = int(time.time())
        connection.execute('DELETE FROM report_live_editors WHERE report_id=? AND last_seen<?', (report_id, now - 15))
        connection.execute('''INSERT INTO report_live_editors VALUES(?,?,?,?)
            ON CONFLICT(report_id,client_id) DO UPDATE SET account_id=excluded.account_id,last_seen=excluded.last_seen''',
            (report_id, client_id, account_id, now))
        people = connection.execute('''SELECT e.client_id,a.first_name,a.last_name FROM report_live_editors e
            JOIN accounts a ON a.account_id=e.account_id WHERE e.report_id=? AND e.client_id<>?
            AND a.password_hash<>'!deleted' ORDER BY e.client_id''', (report_id, client_id)).fetchall()
        published = connection.execute('SELECT published FROM workspace_reports WHERE report_id=?', (report_id,)).fetchone()[0]
        return {'document': {**dict(live), 'published': bool(published)}, 'reset': reset, 'operations': [
            {'revision': row['revision'], 'operation_id': row['operation_id'], 'field': row['field'],
             'operation': json.loads(row['operation_json'])} for row in rows],
            'collaborators': [dict(person) for person in people]}

    @staticmethod
    def _client(client_id):
        if not isinstance(client_id, str) or not client_id or len(client_id) > 100:
            raise ValueError('Choose a valid live editing session.')

    @_serialized
    def live(self, account_id, workspace_id, report_id, after, client_id):
        self._client(client_id)
        if type(after) is not int or after < 0:
            raise ValueError('Choose a valid live report revision.')
        with self.repository._connection(write=True) as connection:
            self._editable(connection, account_id, workspace_id, report_id)
            return self._response(connection, report_id, after, client_id, account_id)

    @_serialized
    def edit(self, account_id, workspace_id, report_id, payload):
        operation, field = payload.get('operation'), payload.get('field')
        operation_id, client_id = payload.get('operation_id'), payload.get('client_id')
        base = payload.get('base_revision')
        self._client(client_id)
        if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 100:
            raise ValueError('Choose a valid live edit identifier.')
        if field not in ('title', 'body') or type(base) is not int or base < 0:
            raise ValueError('Choose a valid live edit and revision.')
        if not isinstance(operation, list) or len(operation) > 1000 or any(
                not ((type(part) is int and part != 0 and abs(part) <= 20000) or
                     (isinstance(part, str) and 0 < len(part) <= 20000)) for part in operation):
            raise ValueError('The live edit is invalid or too large.')
        with self.repository._connection(write=True) as connection:
            self._editable(connection, account_id, workspace_id, report_id)
            live = connection.execute('SELECT * FROM report_collaboration WHERE report_id=?', (report_id,)).fetchone()
            if base > live['revision']:
                raise ValueError('The live edit revision is ahead of this report. Reopen the editor.')
            first = connection.execute('SELECT MIN(revision) FROM report_edit_operations WHERE report_id=?', (report_id,)).fetchone()[0]
            if first is not None and base < first - 1:
                raise ValueError('This editing session was disconnected too long to merge safely. Your local writing is kept; copy it before reopening the live draft.')
            previous = connection.execute('SELECT * FROM report_edit_operations WHERE report_id=? AND operation_id=?',
                                          (report_id, operation_id)).fetchone()
            if previous:
                return self._response(connection, report_id, base, client_id, account_id)
            later = connection.execute('''SELECT * FROM report_edit_operations
                WHERE report_id=? AND revision>? AND field=? ORDER BY revision''', (report_id, base, field)).fetchall()
            expected = later[0]['old_length'] if later else len(live[field])
            if lengths(operation)[0] != expected:
                raise ValueError('The live edit does not match this report. Your local writing is kept; reopen the editor.')
            for remote in later:
                operation, _ = transform(operation, json.loads(remote['operation_json']), operation_id < remote['operation_id'])
            text = apply(live[field], operation)
            if len(text) > (120 if field == 'title' else 20000):
                raise ValueError('The live report is too long. Titles allow 120 characters and reports 20,000 characters.')
            revision = live['revision'] + 1
            record(connection, report_id, revision, operation_id, field, operation, len(live[field]))
            connection.execute(f'UPDATE report_collaboration SET {field}=?,revision=? WHERE report_id=?',
                               (text, revision, report_id))
            return self._response(connection, report_id, base, client_id, account_id)
