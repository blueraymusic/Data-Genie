import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';
import '../styles/ownership.css';

export function WorkspaceOwnership({ workspace, members, disabled, onChanged, onInvite }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const request = workspace.ownership_transfer;
  const pending = request?.status === 'pending';
  const recipients = members.filter((member) => member.account_id !== workspace.owner_account_id);
  if (workspace.role !== 'owner' || workspace.personal || workspace.archived_at) return null;
  async function send(event) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(
        '/api/workspaces/' + encodeURIComponent(workspace.workspace_id) + '/ownership-transfer',
        {
          method: 'POST',
          body: { ...values, recipient_account_id: Number(values.recipient_account_id) },
        },
      );
      setOpen(false);
      setNotice('Ownership request sent. The recipient can review it in Teams.');
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/ownership-transfers/' + encodeURIComponent(request.transfer_id) + '/cancel', {
        method: 'POST',
        body: {},
      });
      setNotice('Ownership request cancelled. You remain the owner.');
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-ownership">
      {pending ? (
        <>
          <span className="small muted">
            Awaiting {request.recipient.first_name} {request.recipient.last_name}’s decision
          </span>
          <button className="text-button" disabled={disabled || busy} onClick={cancel}>
            {busy ? 'Cancelling…' : 'Cancel transfer request'}
          </button>
        </>
      ) : (
        <>
          <button
            className="text-button"
            disabled={disabled || busy}
            onClick={() => {
              setOpen(true);
              setError('');
              setNotice('');
            }}
          >
            Transfer ownership
          </button>
          {request && <span className="small muted">Previous request: {request.status}</span>}
        </>
      )}
      {!open && error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!open && notice && (
        <p className="small ok" role="status">
          {notice}
        </p>
      )}
      {open && (
        <WorkspaceDialog
          title="Transfer workspace ownership"
          description="The recipient must accept. You keep control until they do; your account stays active."
          onClose={() => setOpen(false)}
          busy={busy}
        >
          {recipients.length ? (
            <form className="ownership-form" onSubmit={send}>
              <p>
                Transfer <strong>{workspace.name}</strong>, including its databases and saved
                connections, to another workspace member. After acceptance, you become a member and
                the new owner controls your access.
              </p>
              <label>
                Recipient
                <select name="recipient_account_id" required defaultValue="" disabled={busy}>
                  <option value="" disabled>
                    Choose a workspace member
                  </option>
                  {recipients.map((member) => (
                    <option key={member.account_id} value={member.account_id}>
                      {member.first_name} {member.last_name} ({member.email})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type the workspace name
                <input name="name" required autoComplete="off" maxLength={100} disabled={busy} />
              </label>
              {user.password_enabled !== false ? (
                <label>
                  Current password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </label>
              ) : (
                <p className="small muted">
                  Sign in with Microsoft again within five minutes before confirming.
                </p>
              )}
              <p className="small muted">
                The request appears in the recipient’s Teams page and expires in seven days. You can
                cancel before acceptance.
              </p>
              {error && (
                <p className="err" role="alert">
                  {error}
                </p>
              )}
              <div className="ownership-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Keep ownership
                </button>
                <button className="btn pri" disabled={busy}>
                  {busy ? 'Sending…' : 'Send ownership request'}
                </button>
              </div>
            </form>
          ) : (
            <div className="ownership-form">
              <p>
                Invite the recipient to this workspace first. They need an existing Data Genie
                account and must join before you can request a transfer.
              </p>
              <button
                className="btn pri"
                onClick={() => {
                  setOpen(false);
                  onInvite();
                }}
              >
                People &amp; access
              </button>
            </div>
          )}
        </WorkspaceDialog>
      )}
    </div>
  );
}
