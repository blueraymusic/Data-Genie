import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';

export function DatabaseActions({
  database,
  workspaceId,
  owner,
  canExport,
  disabled,
  workbench,
  onChanged,
}) {
  const id = useId();
  const removeInput = useRef(null),
    removeTrigger = useRef(null),
    openVersion = useRef(0);
  const [expanded, setExpanded] = useState(false),
    [targets, setTargets] = useState([]),
    [destination, setDestination] = useState(''),
    [removing, setRemoving] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (removing) removeInput.current?.focus();
  }, [removing]);
  useEffect(
    () => () => {
      openVersion.current++;
    },
    [],
  );
  const base = '/api/databases/' + encodeURIComponent(database.database_id);
  async function changed(success) {
    window.dispatchEvent(new Event('dg-databases-changed'));
    workbench.setMessage?.(success);
    onChanged?.(success);
    if (workbench.session?.database_id === database.database_id) await workbench.refresh?.();
  }
  async function expand() {
    const revision = ++openVersion.current;
    setExpanded(true);
    setRemoving(false);
    setName('');
    setMessage('');
    setTargets([]);
    setDestination('');
    if (!owner) return;
    try {
      const data = await api('/api/workspaces');
      if (revision !== openVersion.current) return;
      setTargets(
        (data.workspaces || []).filter(
          (item) => item.role === 'owner' && !item.archived_at && item.workspace_id !== workspaceId,
        ),
      );
    } catch (error) {
      if (revision === openVersion.current) setMessage(error.message);
    }
  }
  async function move(event) {
    event.preventDefault();
    if (!destination) return;
    setBusy(true);
    setMessage('');
    try {
      await api('/api/workspaces/' + encodeURIComponent(destination) + '/attach', {
        method: 'POST',
        body: { database_id: database.database_id },
      });
      setMessage('Database moved. Previous sharing permissions were removed.');
      await changed('Database moved. Previous sharing permissions were removed.');
      setExpanded(false);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api(base + '/delete', { method: 'POST', body: { name } });
      setRemoving(false);
      setExpanded(false);
      await changed('Database removed.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (!owner && !canExport) return null;
  return (
    <div className="database-actions">
      <button
        type="button"
        className="btn quiet database-manage-trigger"
        aria-label={'Manage ' + database.database}
        aria-haspopup="dialog"
        disabled={disabled || busy}
        onClick={expand}
      >
        Manage
      </button>
      {expanded && (
        <WorkspaceDialog
          title={removing ? 'Remove ' + database.database + '?' : database.database}
          busy={busy}
          onClose={() => {
            openVersion.current++;
            setExpanded(false);
            setRemoving(false);
          }}
          description={
            removing
              ? database.provider === 'postgresql'
                ? 'This removes the saved connection, access grants, and its query history from Data Genie. Your PostgreSQL server and its data remain available.'
                : 'This deletes the saved database copy, access grants, and its query history for everyone. Download a copy first if you need it. Saved reports remain available.'
              : 'Download the current database, move it to a workspace you own, or remove it.'
          }
        >
          {!removing ? (
            <div className="database-action-options">
              {canExport && (
                <div
                  className="database-download-options"
                  aria-label={'Download ' + database.database}
                >
                  <p className="small muted">
                    Confirmed changes are saved automatically. Download the current state of this
                    database.
                  </p>
                  {database.provider !== 'postgresql' && (
                    <a className="btn" href={base + '/download?format=sqlite'} download>
                      SQLite file
                    </a>
                  )}
                  <a className="btn" href={base + '/download?format=csv'} download>
                    CSV folder (.zip)
                  </a>
                  {database.provider !== 'postgresql' && (
                    <a className="btn" href={base + '/download?format=sql'} download>
                      SQL dump
                    </a>
                  )}
                </div>
              )}
              {owner && targets.length > 0 && (
                <form onSubmit={move} className="database-move-form">
                  <label htmlFor={id + '-destination'}>Move to workspace</label>
                  <select
                    id={id + '-destination'}
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    disabled={disabled || busy}
                  >
                    <option value="">Choose a workspace you own</option>
                    {targets.map((item) => (
                      <option key={item.workspace_id} value={item.workspace_id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn" disabled={disabled || busy || !destination}>
                    Move database
                  </button>
                </form>
              )}
              {owner && (
                <button
                  className="text-button danger"
                  ref={removeTrigger}
                  disabled={disabled || busy}
                  onClick={() => {
                    setName('');
                    setMessage('');
                    setRemoving(true);
                  }}
                >
                  Remove database
                </button>
              )}
              {message && !removing && (
                <p role="status" className="small">
                  {message}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={remove}>
              <label htmlFor={id + '-remove'}>Type {database.database} to confirm removal</label>
              <input
                id={id + '-remove'}
                ref={removeInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                autoComplete="off"
              />
              {message && (
                <p role="alert" className="err">
                  {message}
                </p>
              )}
              <div className="database-download-options">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setRemoving(false);
                    requestAnimationFrame(() => removeTrigger.current?.focus());
                  }}
                >
                  Cancel
                </button>
                <button className="btn danger" disabled={busy || name !== database.database}>
                  {busy ? 'Removing…' : 'Remove database'}
                </button>
              </div>
            </form>
          )}
        </WorkspaceDialog>
      )}
    </div>
  );
}
