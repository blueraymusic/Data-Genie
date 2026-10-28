import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ResultTable } from '../components/ResultTable';
const identifierList = (value) => (Array.isArray(value) ? value.join(', ') : value);
function SchemaTable({ table, sessionId, index }) {
  const [rows, setRows] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function sample() {
    setBusy(true);
    setError('');
    try {
      setRows(
        (await api('/api/sample?table=' + encodeURIComponent(table.name), { sessionId })).rows,
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tbl" id={'schema-table-' + index}>
      <h3>
        {table.name}
        <span className="schema-count">
          ·{' '}
          {table.row_count == null
            ? 'Row count unavailable'
            : (table.row_count_estimated ? '~ ' : '') + table.row_count.toLocaleString() + ' rows'}
        </span>
      </h3>
      <div className="tw schema-columns">
        <table>
          <thead>
            <tr>
              {['Column', 'Type', 'Constraints', 'Default'].map((name) => (
                <th scope="col" key={name}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <tr key={column.name}>
                <td>{column.name}</td>
                <td>{column.type || '—'}</td>
                <td>
                  {(column.primary_key ? ['PRIMARY KEY'] : [])
                    .concat(
                      column.not_null ? ['NOT NULL'] : [],
                      (column.constraints || []).filter(
                        (value) => !['PRIMARY KEY', 'NOT NULL'].includes(value),
                      ),
                    )
                    .map((value, index) => (
                      <span key={index} className="constraint-chip">
                        {typeof value === 'string'
                          ? value
                          : value.definition || value.type || JSON.stringify(value)}
                      </span>
                    ))}
                </td>
                <td>{column.default ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.constraints?.length > 0 && (
        <div className="schema-links">
          <p>
            <b>Table constraints</b>
          </p>
          {table.constraints.map((constraint, index) => (
            <p key={index}>
              {typeof constraint === 'string'
                ? constraint
                : constraint.definition || JSON.stringify(constraint)}
            </p>
          ))}
        </div>
      )}
      {table.foreign_keys?.length > 0 && (
        <div className="schema-links">
          <p>
            <b>Relationships</b>
          </p>
          {table.foreign_keys.map((key, index) => (
            <p key={index}>
              {identifierList(key.from || key.column_name)} →{' '}
              {key.table || key.referenced_table_name} (
              {identifierList(key.to || key.referenced_column_name || 'primary key')}) · ON DELETE{' '}
              {key.on_delete} · ON UPDATE {key.on_update}
            </p>
          ))}
        </div>
      )}
      <p>
        <button className="btn" disabled={busy} onClick={sample}>
          {busy ? 'Loading…' : 'Sample rows'}
        </button>
      </p>
      {error && <p className="err">{error}</p>}
      {rows && <ResultTable rows={rows} />}
    </div>
  );
}
export default function StructurePage({ workbench }) {
  const [tables, setTables] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTables(null);
    api('/api/schema', { sessionId: workbench.session.session_id, signal: controller.signal })
      .then((data) => setTables(data.tables))
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => controller.abort();
  }, [workbench.session.session_id, revision]);
  return (
    <section>
      <h1>Structure</h1>
      <p className="lead">The tables, columns, and links behind your data.</p>
      <button
        className="btn"
        onClick={() => {
          setRevision((value) => value + 1);
          setError('');
        }}
      >
        Refresh structure
      </button>
      {error && <p className="err">{error}</p>}
      <div id="schema">
        {tables === null ? (
          <p className="muted">Loading structure…</p>
        ) : !tables.length ? (
          <p className="muted">This database has no tables yet.</p>
        ) : (
          tables.map((table, index) => (
            <SchemaTable
              table={table}
              index={index}
              key={table.name}
              sessionId={workbench.session.session_id}
            />
          ))
        )}
      </div>
    </section>
  );
}
