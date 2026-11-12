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
    [confirmation, setConfirmation] = useState('');
  const passwordEnabled = user.password_enabled !== false;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api('/api/auth/deletion', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSummary(data);
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
      description="This is permanent. Review what will be removed before continuing."
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
                  Permanently removed with your account. Transfer any work you want to keep from
                  Teams before continuing.
                </p>
              </div>
            </div>
            {summary.workspaces.length > 0 && (
              <div className="account-owned-workspaces">
                <strong>Owned team workspaces</strong>
                <ul>
                  {summary.workspaces.map((space) => (
                    <li key={space.workspace_id}>
                      {space.name} ·{' '}
                      {space.members.length
                        ? 'Reports archived for remaining members'
                        : 'Workspace and reports deleted'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="account-delete-explanation">
              To keep a workspace and its databases, complete an ownership transfer in Teams first.
              Deletion removes your owned Data Genie databases, private history, logins, invitations
              and agent access. Remaining members retain reports in a read-only archive and can
              delete them. Private drafts are not shared. External PostgreSQL data stays on its
              server.
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
          <p>Permanently remove your account and owned databases.</p>
        </div>
        <button className="btn quiet account-delete-trigger" onClick={() => setOpen(true)}>
          Delete account
        </button>
      </section>
      {open && <DeleteAccountDialog user={user} onClose={() => setOpen(false)} />}
    </>
  );
}
