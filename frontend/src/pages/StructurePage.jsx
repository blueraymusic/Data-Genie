import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ResultTable } from '../components/ResultTable';
import { Translation } from '../components/CommandResult';
import { SchemaChangeDialog } from '../components/SchemaChangeDialog';
import { schemaDialect } from '../lib/schemaSql';
import { Link } from '../lib/router';
import '../styles/structure.css';
const identifierList = (value) => (Array.isArray(value) ? value.join(', ') : value);
const isSchemaRequest = (request) =>
  /^(CREATE|ALTER|DROP)\s+TABLE\b/i.test(request.text?.trim() || '') ||
  request.commands.some((command) =>
    ['CREATE', 'ALTER', 'DROP'].includes(
      command.sql_operation ||
        command.operation ||
        command.sql?.trim().split(/\s/)[0]?.toUpperCase(),
    ),
  );
const isPendingRequest = (request) =>
  request.commands.some((command) => command.requires_confirmation && command.status === 'pending');

function SchemaTable({ table, sessionId, index, disabled, dialect, onChange }) {
  const request = useRef(null);
  const [rows, setRows] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => () => request.current?.abort(), [sessionId, table.name]);
  async function sample() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError('');
    setRows(null);
    try {
      setRows(
        (
          await api('/api/sample?table=' + encodeURIComponent(table.name), {
            sessionId,
            signal: controller.signal,
          })
        ).rows,
      );
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="tbl" id={'schema-table-' + index}>
      <div className="schema-table-heading">
        <h3 tabIndex="-1">
          {table.name}
          <span className="schema-count">
            ·{' '}
            {table.row_count == null
              ? 'Row count unavailable'
              : (table.row_count_estimated ? '~ ' : '') +
                table.row_count.toLocaleString() +
                (table.row_count === 1 ? ' row' : ' rows')}
          </span>
        </h3>
        <div className="schema-actions" role="group" aria-label={'Manage table ' + table.name}>
          {[
            ['add-column', 'Add column'],
            ['rename-table', 'Rename table'],
            ['delete-table', 'Delete table'],
          ].map(([action, label]) => (
            <button
              key={action}
              type="button"
              className={'btn' + (action === 'delete-table' ? ' warn' : '')}
              aria-label={label + (action === 'add-column' ? ' to ' : ' ') + table.name}
              disabled={disabled}
              onClick={() => onChange({ action, table })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="tw schema-columns">
        <table>
          <thead>
            <tr>
              {['Column', 'Type', 'Constraints', 'Default', 'Actions'].map((name) => (
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
                <td>
                  <div className="schema-column-actions">
                    <button
                      className="text-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`Rename column ${column.name} in ${table.name}`}
                      onClick={() => onChange({ action: 'rename-column', table, column })}
                    >
                      Rename
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={
                        disabled ||
                        table.columns.length <= 1 ||
                        (dialect === 'sqlite' && column.primary_key)
                      }
                      title={
                        table.columns.length <= 1
                          ? 'A table needs at least one column.'
                          : dialect === 'sqlite' && column.primary_key
                            ? 'SQLite cannot delete a primary key column.'
                            : undefined
                      }
                      aria-label={`Delete column ${column.name} from ${table.name}`}
                      onClick={() => onChange({ action: 'delete-column', table, column })}
                    >
                      Delete
                    </button>
                  </div>
                </td>
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
    [revision, setRevision] = useState(0),
    [change, setChange] = useState(null),
    [jumpTable, setJumpTable] = useState(''),
    [openedReview, setOpenedReview] = useState(null);
  const session = workbench.session;
  const disabled = Boolean(
    workbench.busy || workbench.pending || workbench.workingCommands?.size || session.read_only,
  );
  const schemaRequests = (workbench.feed || []).filter(isSchemaRequest);
  const schemaOutcomes = schemaRequests
    .flatMap((request) => request.commands)
    .filter((command) => ['executed', 'declined', 'failed'].includes(command.status))
    .map((command) => `${command.command_id}:${command.status}`)
    .join('|');
  const latestSchema = schemaRequests.at(-1);
  const reviewRequests = (workbench.feed || []).filter(
    (request) =>
      isPendingRequest(request) ||
      (isSchemaRequest(request) && request.sending) ||
      (request === latestSchema && ['rejected', 'failed'].includes(request.status)),
  );
  const lastCompleted =
    !reviewRequests.length && latestSchema && ['executed', 'declined'].includes(latestSchema.status)
      ? latestSchema
      : null;
  const review = useRef(null);
  useEffect(() => {
    setChange(null);
    setJumpTable('');
    setOpenedReview(null);
  }, [session.session_id]);
  useEffect(() => {
    const controller = new AbortController();
    setTables(null);
    setError('');
    api('/api/schema', { sessionId: workbench.session.session_id, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setTables(data.tables);
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          setError(error.message);
          setTables([]);
        }
      });
    return () => controller.abort();
  }, [session.session_id, revision, schemaOutcomes]);
  function prepare(sql) {
    if (disabled) return;
    setChange(null);
    workbench.submit(sql, true);
    review.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  return (
    <section>
      <header className="page-heading">
        <div>
          <h1>Structure</h1>
          <p className="lead">The tables, columns, and links behind your data.</p>
        </div>
      </header>
      <div className="schema-toolbar" role="group" aria-label="Structure tools">
        <label>
          Jump to table
          <select
            value={tables?.some((table) => table.name === jumpTable) ? jumpTable : ''}
            disabled={!tables?.length}
            onChange={(event) => {
              const name = event.target.value;
              setJumpTable(name);
              const index = tables.findIndex((table) => table.name === name);
              const target = document.getElementById('schema-table-' + index);
              target?.scrollIntoView({ behavior: 'auto', block: 'start' });
              target?.querySelector('h3')?.focus({ preventScroll: true });
            }}
          >
            <option value="">Choose a table</option>
            {(tables || []).map((table) => (
              <option key={table.name}>{table.name}</option>
            ))}
          </select>
        </label>
        <div className="schema-actions">
          <button
            className="btn pri"
            type="button"
            disabled={disabled || tables === null || Boolean(error)}
            onClick={() => setChange({ action: 'create-table' })}
          >
            Create table
          </button>
          <button
            className="btn"
            onClick={() => {
              setRevision((value) => value + 1);
              setError('');
            }}
          >
            Refresh structure
          </button>
        </div>
      </div>
      {session.read_only ? (
        <p className="schema-edit-note muted">
          This connection is read-only. Add a connection with changes enabled to edit its structure.
        </p>
      ) : (
        <p className="schema-edit-note muted">
          Create tables or edit columns here. Every change is reviewed and confirmed before it runs.
        </p>
      )}
      {workbench.pending && (
        <p className="schema-edit-note muted" role="status">
          Confirm or decline the pending change below before preparing another.
        </p>
      )}
      <div className="schema-review" ref={review}>
        {reviewRequests.length > 0 && (
          <section aria-label="Structure change review" aria-live="polite">
            <h2>Review changes</h2>
            {reviewRequests.map((request) => (
              <Translation key={request.request_id} request={request} workbench={workbench} />
            ))}
          </section>
        )}
        {lastCompleted && (
          <details
            className="schema-last-change"
            key={lastCompleted.request_id}
            open={openedReview === lastCompleted.request_id}
            onToggle={(event) =>
              setOpenedReview(event.currentTarget.open ? lastCompleted.request_id : null)
            }
          >
            <summary>Last structure change · {lastCompleted.status} · View details</summary>
            {openedReview === lastCompleted.request_id && (
              <Translation request={lastCompleted} workbench={workbench} />
            )}
          </details>
        )}
        {schemaRequests.length > 0 && (
          <p className="schema-history-link">
            <Link href="/history">All saved changes in History</Link>
          </p>
        )}
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div id="schema">
        {error ? null : tables === null ? (
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
              disabled={disabled}
              dialect={schemaDialect(session)}
              onChange={setChange}
            />
          ))
        )}
      </div>
      {change && (
        <SchemaChangeDialog
          change={change}
          tables={tables || []}
          session={session}
          disabled={disabled}
          onReview={prepare}
          onClose={() => setChange(null)}
        />
      )}
    </section>
  );
}
