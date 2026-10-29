import { useState } from 'react';
import { SqlBlock } from './SqlBlock';
import { ResultTable, Cell } from './ResultTable';
import { formatTime } from '../lib/api';
import { api } from '../lib/api';
import { resultHeadline, chartNumber, isNumeric } from '../lib/resultData';
export const operationOf = (command) =>
  command.sql_operation ||
  (!['read', 'write'].includes(command.operation) && command.operation) ||
  (command.kind === 'SELECT' ? 'SELECT' : command.sql?.trim().split(/\s/)[0]) ||
  'SQL';

function Chart({ rows, type }) {
  if (type === 'bar') {
    const values = rows.map((row) => chartNumber(row.value)),
      min = Math.min(...values, 0),
      max = Math.max(...values, 0),
      range = max - min || 1,
      zero = (-min / range) * 100;
    return (
      <div className="bars" role="img" aria-label="Values by category">
        {rows.map((row, index) => (
          <div className="bar" key={index}>
            <span title={String(row.label)}>{String(row.label ?? 'NULL')}</span>
            <div className="bar-track">
              <span className="bar-zero" style={{ left: zero + '%' }} />
              <i
                className={values[index] < 0 ? 'negative' : undefined}
                style={{
                  left: (values[index] < 0 ? ((values[index] - min) / range) * 100 : zero) + '%',
                  width: (Math.abs(values[index]) / range) * 100 + '%',
                }}
              />
            </div>
            <span>
              <Cell value={row.value} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  const values = rows.map((row) => chartNumber(row.total)),
    max = Math.max(...values, 0),
    min = Math.min(...values, 0),
    x = (index) => 32 + (index * 576) / Math.max(values.length - 1, 1),
    y = (value) => 188 - ((value - min) / (max - min || 1)) * 156;
  return (
    <svg viewBox="0 0 640 220" className="line-chart" role="img" aria-label="Trend over time">
      <line x1="32" x2="608" y1={y(0)} y2={y(0)} stroke="var(--rule)" />
      <polyline
        fill="none"
        stroke="var(--lapis)"
        strokeWidth="2.5"
        points={values.map((value, index) => x(index) + ',' + y(value)).join(' ')}
      />
      {values.map((value, index) => (
        <g key={index}>
          <circle cx={x(index)} cy={y(value)} r="4" fill="var(--lapis)">
            <title>
              {rows[index].period}: {rows[index].total}
            </title>
          </circle>
          {(index % Math.max(1, Math.ceil(rows.length / 8)) === 0 || index === rows.length - 1) && (
            <text x={x(index)} y="212" fontSize="10" textAnchor="middle" fill="var(--ink-soft)">
              {rows[index].period}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function ResultOutput({ command, sessionId, onUseSuggestion }) {
  const data = command.result?.payload || command,
    initialRows = data.rows || [],
    type =
      data.visualization ||
      (command.sql?.includes(' AS period')
        ? 'line'
        : command.sql?.includes(' AS label')
          ? 'bar'
          : 'table');
  const [extra, setExtra] = useState([]),
    [hasMore, setHasMore] = useState(Boolean(data.has_more ?? data.truncated)),
    [loadingMore, setLoadingMore] = useState(false),
    [pageMessage, setPageMessage] = useState(''),
    [view, setView] = useState('chart');
  const rows = [...initialRows, ...extra];
  async function loadMore() {
    if (loadingMore || !sessionId || !command.command_id) return;
    setLoadingMore(true);
    setPageMessage('');
    try {
      const query = new URLSearchParams({ command_id: command.command_id, offset: rows.length });
      const next = await api('/api/results/page?' + query, { sessionId });
      setExtra((previous) => [...previous, ...next.rows]);
      setHasMore(next.has_more);
      setPageMessage(next.message);
    } catch (error) {
      setPageMessage(error.message);
    } finally {
      setLoadingMore(false);
    }
  }
  const tableProps = {
    rows,
    truncated: hasMore,
    loadingMore,
    onLoadMore: sessionId && command.command_id ? loadMore : undefined,
    onUseSuggestion,
    recovery: data.recovery || [],
    filename: (data.query_context?.tables || []).join('-') || 'data-genie-results',
  };
  const summary =
    type === 'table' &&
    (data.result_type === 'summary' || command.has_aggregation) &&
    rows.length === 1 &&
    Object.values(rows[0]).some(isNumeric);
  const chartKeys = type === 'bar' ? ['label', 'value'] : ['period', 'total'];
  const canChart =
    ['bar', 'line'].includes(type) &&
    rows.length > 0 &&
    rows.every(
      (row) => chartKeys.every((key) => key in row) && chartNumber(row[chartKeys[1]]) !== null,
    );
  return (
    <>
      {!summary && (rows.length > 0 || operationOf(command) === 'SELECT' || data.inventory) && (
        <div className="result-heading">
          <h3>{resultHeadline(command, rows, hasMore)}</h3>
          {data.query_context?.filters?.length > 0 && (
            <p className="result-scope">{data.query_context.filters.join(' · ')}</p>
          )}
        </div>
      )}
      {command.metadata && !rows.length ? (
        <p className="muted">
          This database has no tables yet. Create a table to start adding data.
        </p>
      ) : summary ? (
        <>
          <div className="summary-values">
            {Object.entries(rows[0]).map(([key, value]) => (
              <div className="summary-value" key={key}>
                <Cell value={typeof value === 'number' ? value.toLocaleString() : value} />
                <small>{key.replaceAll('_', ' ')}</small>
              </div>
            ))}
          </div>
          <details className="chart-data">
            <summary>View result data</summary>
            <ResultTable {...tableProps} />
          </details>
        </>
      ) : canChart ? (
        <>
          <div className="result-view" role="group" aria-label="Result display">
            {['chart', 'table'].map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {value === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
          {view === 'chart' ? (
            <>
              <Chart rows={rows} type={type} />
              <details className="chart-data">
                <summary>View chart data</summary>
                <ResultTable {...tableProps} />
              </details>
            </>
          ) : (
            <ResultTable {...tableProps} />
          )}
        </>
      ) : rows.length || operationOf(command) === 'SELECT' || data.changes === undefined ? (
        <ResultTable {...tableProps} compactTools />
      ) : (
        <p className="result-message">{data.message || `${data.changes} row(s) affected.`}</p>
      )}
      {command.result?.created_at && (
        <p
          className="result-meta saved-result"
          title={
            'Saved ' + formatTime(command.result.created_at) + '. The data may have changed since.'
          }
        >
          <span aria-hidden="true">Saved result</span>
          <span className="sr-only">
            Saved {formatTime(command.result.created_at)}. The data may have changed since.
          </span>
        </p>
      )}
      {pageMessage && (
        <p className="result-meta" role="status">
          {pageMessage}
        </p>
      )}
      {data.schema_warning && (
        <p className="result-meta" role="status">
          {data.schema_warning}
        </p>
      )}
    </>
  );
}

export function Confirmation({ command, predecessors = [], onDecide, busy = false }) {
  const [typed, setTyped] = useState('');
  const operation = operationOf(command),
    target =
      command.preview?.table ||
      command.targets?.find((target) => target.access_type !== 'read')?.table_name ||
      command.targets?.[0]?.table_name ||
      'this table',
    count = command.preview?.affected_rows;
  const blocked = predecessors.some((previous) => previous.status !== 'executed');
  const drop = operation === 'DROP';
  const action =
    {
      DELETE: 'Delete',
      DROP: 'Drop',
      INSERT: 'Add',
      REPLACE: 'Replace',
      UPDATE: 'Update',
      CREATE: 'Create',
      ALTER: 'Change',
      SELECT: 'Run',
    }[operation] || 'Run';
  const label =
    drop || ['CREATE', 'ALTER'].includes(operation)
      ? `${action} table ${target}`
      : ['DELETE', 'UPDATE', 'INSERT', 'REPLACE'].includes(operation) && Number.isInteger(count)
        ? `${action} ${count} ${count === 1 ? 'row' : 'rows'}`
        : `${action} ${operation === 'SELECT' ? 'step' : 'records'}`;
  return (
    <div
      className={
        'confirm' + (['DELETE', 'DROP'].includes(operation) ? ' destructive' : ' constructive')
      }
      role="alert"
      tabIndex="-1"
    >
      <b>
        {drop
          ? `This will drop table ${target}.`
          : ['DELETE', 'UPDATE', 'INSERT', 'REPLACE'].includes(operation) && Number.isInteger(count)
            ? `This will ${action.toLowerCase()} ${count} ${count === 1 ? 'row' : 'rows'} ${operation === 'DELETE' ? 'from' : operation === 'INSERT' ? 'to' : 'in'} ${target}.`
            : `This will ${operation === 'SELECT' ? 'read' : 'change'} ${target}.`}
      </b>
      <p>
        Review this change before you continue.
        {['DELETE', 'DROP'].includes(operation) ? ' Deleted data cannot be restored here.' : ''}
      </p>
      {command.preview_error && <p className="err">{command.preview_error}</p>}
      {drop && (
        <label className="drop-label">
          Type {target} to confirm
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      {blocked && (
        <p className="dependency-note muted">
          Run the earlier steps in this request first. A declined or failed step blocks later
          changes.
        </p>
      )}
      <div className="row">
        <button
          className={'btn ' + (['DELETE', 'DROP'].includes(operation) ? 'warn' : 'pri')}
          disabled={busy || blocked || Boolean(command.preview_error) || (drop && typed !== target)}
          onClick={() => onDecide(command, false)}
        >
          {busy ? 'Working…' : label}
        </button>
        <button className="btn" disabled={busy} onClick={() => onDecide(command, true)}>
          Don’t run
        </button>
      </div>
    </div>
  );
}

export function CommandOutput({
  command,
  predecessors,
  onDecide,
  busy = false,
  actionable = true,
  sessionId,
  onUseSuggestion,
}) {
  if (command.error || command.status === 'failed')
    return <p className="err">{command.error || 'This command failed.'}</p>;
  if (command.status === 'declined') return <p className="notrun">Not run. You declined this.</p>;
  if (command.requires_confirmation && command.status === 'pending')
    return actionable ? (
      <Confirmation {...{ command, predecessors, onDecide, busy }} />
    ) : (
      <p className="muted">
        This command was not executed. Prepare the request in your current session to review it.
      </p>
    );
  if (['pending', 'running'].includes(command.status))
    return (
      <p className="muted">Waiting for the command to finish. Check History before retrying.</p>
    );
  return <ResultOutput command={command} sessionId={sessionId} onUseSuggestion={onUseSuggestion} />;
}

export function Translation({ request, workbench, onUseSuggestion }) {
  const hasSql = request.commands.some((command) => command.sql);
  const hasOutput = !request.sending && (request.commands.length > 0 || request.error);
  const waiting = request.commands.some(
    (command) => command.requires_confirmation && command.status === 'pending',
  );
  const errorWithoutSql = request.error && !hasSql;
  return (
    <article
      className={'exchange' + (request.sending ? '' : ' ready')}
      data-status={request.needs_clarification ? 'clarification' : request.status}
    >
      <div className="exchange-margin">
        <time>
          {new Date(request.submitted_at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </time>
        <span className="exchange-status">
          {request.needs_clarification
            ? 'needs details'
            : request.status === 'rejected'
              ? hasSql
                ? 'failed'
                : 'not run'
              : request.status}
        </span>
      </div>
      <div className="exchange-content">
        <div className={'translation' + (errorWithoutSql ? ' without-sql' : '')}>
          <section className="request-panel" aria-label="Your request">
            <h2 className="exchange-label">Your request</h2>
            <p className="request-text">{request.text}</p>
          </section>
          {(hasSql || request.sending) && (
            <svg
              className="translation-thread"
              viewBox="0 0 100 64"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 16C55 16 45 47 100 47" />
            </svg>
          )}
          <section
            className="translation-commands"
            aria-label={
              errorWithoutSql
                ? 'Data Genie response'
                : hasSql || request.sending
                  ? 'Generated SQL'
                  : 'Database inspection'
            }
          >
            <h2 className="exchange-label">
              {errorWithoutSql
                ? 'Data Genie response'
                : hasSql || request.sending
                  ? 'Generated SQL'
                  : 'Database inspection'}
            </h2>
            {request.sending ? (
              <div className="skeleton" aria-label="Writing the SQL">
                <i />
                <i />
                <i />
              </div>
            ) : errorWithoutSql ? (
              <div className="clarification">
                <p className="clarification-title">
                  {request.needs_clarification
                    ? 'A little more detail, please.'
                    : 'This request wasn’t run.'}
                </p>
                <p>{request.error}</p>
                {(request.choices?.length > 0 || request.suggestions?.length > 0) &&
                  onUseSuggestion && (
                    <div className="clarification-suggestions">
                      {(request.choices?.length
                        ? request.choices
                        : request.suggestions.map((suggestion) => ({
                            label: suggestion,
                            request: suggestion,
                          }))
                      ).map((choice) => (
                        <button
                          key={choice.request}
                          type="button"
                          disabled={workbench.busy || workbench.pending}
                          onClick={() => onUseSuggestion(choice.request)}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  )}
                <small>No SQL run. No changes made.</small>
              </div>
            ) : (
              request.commands.map((command, index) => (
                <div className="command" key={command.command_id || index}>
                  {command.sql && (
                    <SqlBlock
                      sql={command.sql}
                      operation={operationOf(command)}
                      declined={command.status === 'declined'}
                    />
                  )}
                  {(command.metadata || command.status === 'executed') &&
                    (command.answer || command.summary) && (
                      <p className="command-explanation">{command.answer || command.summary}</p>
                    )}
                </div>
              ))
            )}
          </section>
        </div>
        {hasOutput && !errorWithoutSql && (
          <section className="exchange-results" aria-label={waiting ? 'Review change' : 'Result'}>
            <h2 className="exchange-label">
              {waiting ? 'Review change' : 'Result'} {waiting && <span>Confirmation required</span>}
            </h2>
            {request.error && !request.commands.some((command) => command.error) ? (
              <p className="err">{request.error}</p>
            ) : (
              request.commands.map((command, index) => (
                <div className="command-result" key={command.command_id || index}>
                  <CommandOutput
                    command={command}
                    predecessors={request.commands.slice(0, index)}
                    onDecide={workbench.decide}
                    busy={workbench.workingCommands.has(command.command_id)}
                    sessionId={workbench.session?.session_id}
                    onUseSuggestion={onUseSuggestion}
                  />
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </article>
  );
}
