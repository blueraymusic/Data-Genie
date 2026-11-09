import { useEffect, useRef, useState } from 'react';
import { api, formatTime } from '../lib/api';
import { normalizeRequest } from '../hooks/useWorkbench';
import { SqlBlock } from '../components/SqlBlock';
import { CommandOutput, operationOf } from '../components/CommandResult';
import '../styles/history.css';
import { canConfirmCommand, databaseAccess } from '../lib/access';

const PAGE_SIZE = 20;

function HistoryCommand({
  command,
  request,
  index,
  active,
  sessionId,
  workbench,
  accessSession,
  onDecide,
}) {
  const pending = command.requires_confirmation && command.status === 'pending';
  const [expanded, setExpanded] = useState(Boolean(pending && active));
  return (
    <details
      className="history-command"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {operationOf(command)} · {command.status} ·{' '}
        {pending && active ? 'Review change' : 'View SQL and result'}
      </summary>
      {expanded && (
        <div className="command">
          <SqlBlock sql={command.sql} operation={operationOf(command)} />
          <CommandOutput
            command={command}
            sessionId={active ? sessionId : undefined}
            predecessors={request.commands.slice(0, index)}
            onDecide={onDecide}
            busy={workbench.workingCommands.has(command.command_id)}
            actionable={Boolean(sessionId && active)}
            canExport={databaseAccess(accessSession).permissions.export}
            permitted={canConfirmCommand(workbench.session, command)}
          />
        </div>
      )}
    </details>
  );
}

function HistoryEntry({ request, active, id, workbench, accessSession, onDecide, onReuse }) {
  const text = request.text.replace(/\s+/g, ' ').trim();
  const shortened = text.length > 220 || request.text.includes('\n');
  const [fullRequest, setFullRequest] = useState(false);
  return (
    <article className="history-entry">
      <div className="history-entry-heading">
        <h3>{text.length > 220 ? text.slice(0, 220) + '…' : text}</h3>
        <button
          className="btn quiet history-reuse"
          disabled={
            !id || workbench.pending || workbench.busy || workbench.workingCommands.size > 0
          }
          onClick={() => onReuse(request)}
        >
          {active ? 'Use request' : 'Use in current database'}
        </button>
      </div>
      <p className="small muted history-entry-meta">
        <time dateTime={request.submitted_at}>{formatTime(request.submitted_at)}</time> ·{' '}
        <span>{request.status}</span>
      </p>
      {shortened && (
        <details
          className="history-full-request"
          onToggle={(event) => setFullRequest(event.currentTarget.open)}
        >
          <summary>View full request</summary>
          {fullRequest && <pre>{request.text}</pre>}
        </details>
      )}
      {request.error && <p className="err">{request.error}</p>}
      {request.commands.map((command, index) => (
        <HistoryCommand
          key={command.command_id}
          {...{ command, request, index, active, workbench, accessSession, onDecide }}
          sessionId={id}
        />
      ))}
    </article>
  );
}

function HistoryNavigation({ page, offset, loading, disabled, onPage, placement }) {
  const count = page?.requests.length || 0;
  const total = page?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav className="history-pagination" aria-label={`History pages ${placement}`}>
      <span className="history-page-count" {...(placement === 'top' ? { role: 'status' } : {})}>
        {loading
          ? 'Loading history…'
          : total
            ? `${offset + 1}–${offset + count} of ${total.toLocaleString()} ${total === 1 ? 'request' : 'requests'} · Page ${Math.floor(offset / PAGE_SIZE) + 1} of ${pages.toLocaleString()}`
            : '0 requests'}
      </span>
      <div className="history-page-buttons">
        <button
          className="btn"
          disabled={disabled || loading || offset === 0}
          onClick={() => onPage(0)}
        >
          Newest
        </button>
        <button
          className="btn"
          disabled={disabled || loading || offset === 0}
          onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </button>
        <button
          className="btn"
          disabled={disabled || loading || !page?.has_more}
          onClick={() => onPage(offset + PAGE_SIZE)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export default function HistoryPage({ workbench, onReuse }) {
  const id = workbench.session?.session_id;
  const [sessions, setSessions] = useState([]),
    [target, setTarget] = useState(id || ''),
    [search, setSearch] = useState(''),
    [operation, setOperation] = useState(''),
    [filters, setFilters] = useState({ search: '', operation: '' }),
    [page, setPage] = useState(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [sessionsError, setSessionsError] = useState(''),
    [revision, setRevision] = useState(0);
  const results = useRef(null),
    controls = useRef(null);
  useEffect(() => {
    setTarget(id || '');
    setOffset(0);
  }, [id]);
  useEffect(() => {
    const controller = new AbortController();
    setSessionsError('');
    api('/api/sessions', { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSessions(data.sessions);
        setTarget((current) =>
          data.sessions.some((item) => item.session_id === current)
            ? current
            : id || data.sessions[0]?.session_id || '',
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError')
          setSessionsError(error.message);
      });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    if (!target) {
      setPage({ requests: [], total: 0, has_more: false });
      return;
    }
    const controller = new AbortController();
    setPage(null);
    setError('');
    const query = new URLSearchParams({
      history_session_id: target,
      ...filters,
      limit: PAGE_SIZE,
      offset,
    });
    api('/api/history?' + query, { sessionId: id, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const paginated = Number.isInteger(data.total);
        const total = paginated ? data.total : data.requests.length;
        if (total > 0 && offset >= total) {
          setOffset(Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);
          return;
        }
        const requests = paginated
          ? data.requests
          : data.requests.slice(offset, offset + PAGE_SIZE);
        setPage({
          requests: requests.map(normalizeRequest),
          total,
          has_more: paginated ? data.has_more : offset + requests.length < total,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          setError(error.message);
          setPage({ requests: [], total: 0, has_more: false });
        }
      });
    return () => controller.abort();
  }, [id, target, filters, revision, offset]);
  async function decide(command, decline) {
    await workbench.decide(command, decline);
    setRevision((value) => value + 1);
  }
  function changePage(next) {
    setOffset(next);
    if (results.current) {
      const height = controls.current?.getBoundingClientRect().height;
      if (height) results.current.style.scrollMarginTop = `${Math.ceil(height) + 16}px`;
    }
    results.current?.scrollIntoView({ block: 'start' });
  }
  const choices =
    id && !sessions.some((item) => item.session_id === id)
      ? [workbench.session, ...sessions]
      : sessions;
  const current = choices.find((item) => item.session_id === target);
  const navigation = {
    page,
    offset,
    loading: page === null,
    disabled: Boolean(error || !target),
    onPage: changePage,
  };
  return (
    <section className="history-page">
      <header className="page-heading">
        <div>
          <h1>History</h1>
          <p className="lead">Find an earlier request, check its result, or use it again.</p>
        </div>
      </header>
      <div className="history-controls" ref={controls}>
        <form
          className="history-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            setOffset(0);
            setFilters({ search, operation });
          }}
        >
          <div className="history-search-row">
            <label>
              <span className="sr-only">Find a request</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your words or SQL"
              />
            </label>
            <button className="btn pri" disabled={!target}>
              Search
            </button>
            <button
              className="btn quiet"
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Refresh
            </button>
          </div>
          <details className="history-filter-options">
            <summary>
              Session & operation · {current?.database || 'Choose a session'}
              {filters.operation ? ` · ${filters.operation}` : ''}
            </summary>
            <div className="history-filter-fields">
              <label>
                Session
                <select
                  value={target}
                  disabled={!choices.length}
                  onChange={(event) => {
                    setOffset(0);
                    setTarget(event.target.value);
                  }}
                >
                  {!choices.length && <option value="">No saved sessions</option>}
                  {choices.map((item) => (
                    <option key={item.session_id} value={item.session_id}>
                      {item.database} · {formatTime(item.started_at)}
                      {item.session_id === id ? ' · Current' : item.ended_at ? ' · Ended' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Operation
                <select value={operation} onChange={(event) => setOperation(event.target.value)}>
                  <option value="">All operations</option>
                  {[
                    'SELECT',
                    'INSERT',
                    'REPLACE',
                    'UPDATE',
                    'DELETE',
                    'CREATE',
                    'ALTER',
                    'DROP',
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setSearch('');
                  setOperation('');
                  setOffset(0);
                  setFilters({ search: '', operation: '' });
                }}
              >
                Clear filters
              </button>
            </div>
          </details>
        </form>
        <HistoryNavigation {...navigation} placement="top" />
      </div>
      <p className="history-meta">
        {target === id
          ? 'Current session · Newest first. History is saved with this Data Genie installation.'
          : id
            ? `Saved session · Newest first. Reused requests will be prepared in ${workbench.session.database}.`
            : 'Saved results stay available without opening a database. Choose a database to reuse requests.'}
      </p>
      <div className="history-results" ref={results} aria-busy={page === null}>
        {(error || sessionsError) && (
          <div className="history-error" role="alert">
            <p className="err">{error || sessionsError}</p>
            <button className="btn" onClick={() => setRevision((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}
        {page === null ? null : error || (!target && sessionsError) ? null : !page.requests
            .length ? (
          <p className="muted history-empty">No saved requests match these filters.</p>
        ) : (
          page.requests.map((request) => (
            <HistoryEntry
              key={request.request_id}
              {...{ request, id, workbench, onReuse }}
              accessSession={target === id ? workbench.session : current}
              active={target === id}
              onDecide={decide}
            />
          ))
        )}
      </div>
      <HistoryNavigation {...navigation} placement="bottom" />
    </section>
  );
}
