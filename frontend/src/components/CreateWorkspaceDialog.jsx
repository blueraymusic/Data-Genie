import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';

export function CreateWorkspaceDialog({ disabled = false, onClose, onCreated }) {
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false);
  async function create(event) {
    event.preventDefault();
    if (disabled || submitting.current || !name.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    let workspace;
    try {
      workspace = await api('/api/workspaces', { method: 'POST', body: { name: name.trim() } });
    } catch (failure) {
      setError(failure.message);
      return;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    window.dispatchEvent(new Event('dg-workspaces-changed'));
    onCreated(workspace);
  }
  return (
    <WorkspaceDialog
      title="Create a workspace"
      description="Bring your team and its databases together."
      busy={busy || disabled}
      onClose={onClose}
    >
      <form className="workspace-create" onSubmit={create}>
        <label>
          New workspace name
          <input
            value={name}
            maxLength={100}
            required
            disabled={busy || disabled}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Customer operations"
          />
        </label>
        <p className="small muted">
          You’ll be the owner. Add a database, then invite your teammates.
        </p>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="workspace-dialog-actions">
          <button type="button" className="btn" disabled={busy || disabled} onClick={onClose}>
            Cancel
          </button>
          <button className="btn pri" disabled={busy || disabled || !name.trim()}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
