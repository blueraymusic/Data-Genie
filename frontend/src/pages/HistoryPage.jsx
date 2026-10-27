import { useEffect, useState } from 'react';
import { api, formatTime } from '../lib/api';
import { normalizeRequest } from '../hooks/useWorkbench';
import { SqlBlock } from '../components/SqlBlock';
import { CommandOutput, operationOf } from '../components/CommandResult';
export default function HistoryPage({ workbench, onReuse }) {
  const id = workbench.session.session_id;
  const [sessions, setSessions] = useState([]),
    [target, setTarget] = useState(id),
    [search, setSearch] = useState(''),
    [operation, setOperation] = useState(''),
    [filters, setFilters] = useState({ search: '', operation: '' }),
    [requests, setRequests] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/api/sessions', { signal: controller.signal })
      .then((data) => setSessions(data.sessions))
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    const controller = new AbortController();
    setRequests(null);
    const query = new URLSearchParams({ history_session_id: target, ...filters });
    api('/api/history?' + query, { sessionId: id, signal: controller.signal })
      .then((data) => setRequests(data.requests.map(normalizeRequest)))
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => controller.abort();
  }, [id, target, filters, revision]);
  async function decide(command, decline) {
    await workbench.decide(command, decline);
    setRevision((value) => value + 1);
  }
  return (
    <section>
      <h1>On the record.</h1>
      <p className="lead">Your requests, their SQL, and the results you saw.</p>
      <form
        className="history-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          setFilters({ search, operation });
        }}
      >
        <label>
          Session
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            {(sessions.length ? sessions : [workbench.session]).map((item) => (
              <option key={item.session_id} value={item.session_id}>
                {item.database} · {formatTime(item.started_at)}
                {item.session_id === id ? ' · Current' : item.ended_at ? ' · Ended' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Find a request
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your words or SQL"
          />
        </label>
        <label>
          Operation
          <select value={operation} onChange={(event) => setOperation(event.target.value)}>
            <option value="">All operations</option>
            {['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button className="btn">Search</button>
      </form>
      <p className="history-meta">
        {target === id
          ? 'Current session · History is saved on this computer.'
          : 'Earlier session · Review saved results or prepare a request in your current session.'}
      </p>
      <div aria-live="polite">
        {error && <p className="err">{error}</p>}
        {requests === null ? (
          <p className="muted">Loading history…</p>
        ) : !requests.length ? (
          <p className="muted">No saved requests match these filters.</p>
        ) : (
          requests.map((request) => (
            <article className="history-entry" key={request.request_id}>
              <h3>{request.text}</h3>
              <p className="small muted">
                {formatTime(request.submitted_at)} · {request.status}
              </p>
              {request.error && <p className="err">{request.error}</p>}
              {request.commands.map((command, index) => (
                <details className="history-command" key={command.command_id}>
                  <summary>
                    {operationOf(command)} · {command.status} · View SQL and result
                  </summary>
                  <div className="command">
                    <SqlBlock sql={command.sql} operation={operationOf(command)} />
                    <CommandOutput
                      command={command}
                      sessionId={target === id ? id : undefined}
                      predecessors={request.commands.slice(0, index)}
                      onDecide={decide}
                      busy={workbench.workingCommands.has(command.command_id)}
                      actionable={target === id}
                    />
                  </div>
                </details>
              ))}
              <button
                className="btn"
                disabled={workbench.pending || workbench.busy}
                onClick={() => onReuse(request)}
              >
                Use request
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
