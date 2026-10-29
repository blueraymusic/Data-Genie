import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, formatTime } from '../lib/api';

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
    api('/api/sessions', { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const seen = new Set();
        setSaved(
          data.sessions.filter((item) => !seen.has(item.database_id) && seen.add(item.database_id)),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setLoadError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [user.account_id, workbench.session?.database_id, revision]);

  async function open(item) {
    setIssue(null);
    setOpening(item.session_id);
    try {
      await workbench.open({}, item.session_id);
      onOpened();
    } catch (error) {
      setIssue({ sessionId: item.session_id, message: error.message, recovery: error.recovery });
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="saved-databases" aria-label="Saved databases">
      <h2>Your saved databases</h2>
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
          No saved databases to reopen. Add a connection or create a database below.
        </p>
      )}
      {saved.map((item) => {
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
                </small>
              </span>
              <b>{current ? 'Current' : opening === item.session_id ? 'Opening…' : 'Open →'}</b>
            </button>
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
      {workbench.pending && (
        <p className="small muted">
          Confirm or decline the pending change before switching databases.
        </p>
      )}
    </section>
  );
}
