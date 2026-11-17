import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, formatTime } from '../lib/api';
import { DatabaseActions } from './DatabaseActions';
import { useDatabaseCollection } from '../hooks/useDatabaseCollection';
import { DatabaseListControls, DatabasePagination } from './DatabaseListControls';

export function SavedDatabases({ workbench, onOpened, onReconnect }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [issue, setIssue] = useState(null),
    [opening, setOpening] = useState(null),
    [revision, setRevision] = useState(0);
  const disabled = workbench.busy || workbench.pending || workbench.workingCommands?.size > 0;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    let inFlight = false;
    const load = () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      api('/api/sessions', { signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setLoadError('');
          const seen = new Set();
          setSaved(
            data.sessions.filter(
              (item) => !seen.has(item.database_id) && seen.add(item.database_id),
            ),
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted && error.name !== 'AbortError')
            setLoadError(error.message);
        })
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    window.addEventListener('focus', load);
    window.addEventListener('dg-databases-changed', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('dg-databases-changed', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [user.account_id, workbench.session?.database_id, revision]);

  const collection = useDatabaseCollection(saved, user.account_id);
  async function open(item) {
    setIssue(null);
    setOpening(item.session_id);
    try {
      const data = await workbench.open({}, item.session_id);
      onOpened(data);
    } catch (error) {
      setIssue({ sessionId: item.session_id, message: error.message, recovery: error.recovery });
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="saved-databases" aria-label="Saved databases">
      <h2>Recent databases</h2>
      {loading && (
        <p className="small muted" role="status">
          Loading saved databases…
        </p>
      )}
      {loadError && (
        <div className="saved-database-error" role="alert">
          <p>Could not load saved databases. {loadError}</p>
          <button
            className="btn"
            disabled={disabled}
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !loadError && !saved.length && (
        <p className="small muted">
          No databases yet. Create one or add a connection to get started.
        </p>
      )}
      <DatabaseListControls collection={collection} />
      {saved.length > 0 && !collection.items.length && (
        <p className="muted">No databases match your search.</p>
      )}
      <div className="saved-database-list">
        {collection.items.map((item) => {
          const current =
            item.session_id === workbench.session?.session_id ||
            (workbench.session?.database_id != null &&
              item.database_id === workbench.session.database_id);
          const failed = issue?.sessionId === item.session_id;
          return (
            <div key={item.database_id} className="saved-database-entry">
              <button
                className="saved-database"
                disabled={disabled || current || opening !== null}
                aria-current={current ? 'true' : undefined}
                onClick={() => open(item)}
              >
                <span>
                  {item.database}
                  <small>
                    {item.provider === 'postgresql' ? 'PostgreSQL' : 'SQLite'} · Last opened{' '}
                    {formatTime(item.started_at)}
                    {item.access?.workspace_name && ' · ' + item.access.workspace_name}
                  </small>
                </span>
                <b>{current ? 'Current' : opening === item.session_id ? 'Opening…' : 'Open →'}</b>
              </button>
              <DatabaseActions
                database={item}
                workspaceId={item.access?.workspace_id}
                owner={item.access?.role === 'owner'}
                canExport={item.access?.permissions?.export === true}
                disabled={disabled || opening !== null}
                workbench={workbench}
              />
              {failed && (
                <div className="saved-database-error" role="alert">
                  <p>{issue.message}</p>
                  {workbench.session && (
                    <p className="small muted">You’re still using {workbench.session.database}.</p>
                  )}
                  <div className="saved-database-actions">
                    <button className="btn" disabled={disabled} onClick={() => open(item)}>
                      Try again
                    </button>
                    {item.provider === 'postgresql' && issue.recovery === 'reconnect' && (
                      <button className="btn" disabled={disabled} onClick={onReconnect}>
                        Enter connection details
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <DatabasePagination collection={collection} />
      {workbench.pending && (
        <p className="small muted">
          Confirm or decline the pending change before switching databases.
        </p>
      )}
    </section>
  );
}
