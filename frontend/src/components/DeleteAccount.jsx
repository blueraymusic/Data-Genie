import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../lib/router';
import { api } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';
import { Icon } from './Icon';

function DeleteAccountDialog({ user, onClose }) {
  const { deleteAccount } = useAuth(),
    { navigate } = useRouter();
  const [summary, setSummary] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [email, setEmail] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [transfers, setTransfers] = useState({});
  const passwordEnabled = user.password_enabled !== false;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api('/api/auth/deletion', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSummary(data);
          setTransfers({});
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [revision]);
  async function submit(event) {
    event.preventDefault();
    if (busy || !summary || confirmation !== 'DELETE' || email.trim().toLowerCase() !== user.email)
      return;
    setBusy(true);
    setError('');
    try {
      await deleteAccount({
        email: email.trim().toLowerCase(),
        confirmation,
        password: new FormData(event.currentTarget).get('password'),
        transfers,
      });
      navigate('/signin?account=deleted', true);
    } catch (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Delete your account?"
      description="This is permanent. Decide what happens to your workspaces before continuing."
      onClose={onClose}
      busy={busy}
      wide
    >
      <form className="account-delete-form" onSubmit={submit}>
        {!summary && !error && (
          <p className="workspace-loading" role="status">
            Checking your workspaces and databases…
          </p>
        )}
        {summary && (
          <>
            <div className="account-delete-impact">
              <Icon name="database" />
              <div>
                <strong>
                  {summary.databases} owned {summary.databases === 1 ? 'database' : 'databases'}
                </strong>
                <p>
                  Deleted unless you transfer the team workspace below. Personal databases are
                  deleted; move them into a team first to transfer them.
                </p>
              </div>
            </div>
            {summary.workspaces.length > 0 && (
              <fieldset className="account-transfer-choices">
                <legend>Your team workspaces</legend>
                {summary.workspaces.map((space) => (
                  <label key={space.workspace_id}>
                    <span>{space.name}</span>
                    <select
                      aria-label={'Ownership of ' + space.name}
                      value={transfers[space.workspace_id] || ''}
                      disabled={busy}
                      onChange={(event) => {
                        const next = { ...transfers };
                        if (event.target.value)
                          next[space.workspace_id] = Number(event.target.value);
                        else delete next[space.workspace_id];
                        setTransfers(next);
                      }}
                    >
                      <option value="">
                        {space.members.length
                          ? 'Delete databases; archive reports'
                          : 'Delete workspace and its contents'}
                      </option>
                      {space.members.map((member) => (
                        <option key={member.account_id} value={member.account_id}>
                          Transfer to {member.first_name} {member.last_name} ({member.email})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="account-delete-explanation">
              Transfers include full control of database connections. Otherwise, remaining members
              retain reports in a read-only archive and can delete them. Empty workspaces, your
              private history, logins, invitations and agent access are removed. Private drafts are
              not shared. External PostgreSQL data stays on its server.
            </p>
            <div className="account-delete-fields">
              <label>
                Your account email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              {passwordEnabled ? (
                <label>
                  Current password
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </label>
              ) : (
                <p className="small muted">
                  Sign in with Microsoft again within the last five minutes before confirming.
                </p>
              )}
              <label>
                Type DELETE to confirm
                <input
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            </div>
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {!summary && error && (
          <button className="btn" type="button" onClick={() => setRevision((value) => value + 1)}>
            Try again
          </button>
        )}
        <div className="account-profile-actions">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            Keep account
          </button>
          <button
            className="btn warn"
            disabled={
              busy ||
              !summary ||
              confirmation !== 'DELETE' ||
              email.trim().toLowerCase() !== user.email
            }
          >
            {busy ? 'Deleting account…' : 'Delete account permanently'}
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}

export function DeleteAccount({ user }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="account-danger-row" aria-label="Delete account">
        <div>
          <h3>Delete account</h3>
          <p>Transfer your work or permanently remove your account.</p>
        </div>
        <button className="btn quiet account-delete-trigger" onClick={() => setOpen(true)}>
          Delete account
        </button>
      </section>
      {open && <DeleteAccountDialog user={user} onClose={() => setOpen(false)} />}
    </>
  );
}
