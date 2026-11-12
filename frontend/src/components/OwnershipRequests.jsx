import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';
import { Icon } from './Icon';
import '../styles/ownership.css';

function ReviewOwnership({ request, onClose, onComplete }) {
  const { user } = useAuth();
  const [review, setReview] = useState(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const base = '/api/ownership-transfers/' + encodeURIComponent(request.transfer_id);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null);
    setError('');
    api(base, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setReview(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [base, revision]);
  async function decide(action, body = {}) {
    if (busy || !review || review.status !== 'pending') return;
    setBusy(true);
    setError('');
    try {
      const result = await api(base + '/' + action, {
        method: 'POST',
        body: { ...body, review_version: review.review_version },
      });
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      onComplete(result);
      onClose();
    } catch (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Review ownership request"
      description={request.workspace_name}
      onClose={onClose}
      busy={busy}
    >
      <div className="ownership-form">
        {!review && !error && (
          <p className="workspace-loading" role="status">
            Loading the latest workspace details…
          </p>
        )}
        {review && (
          <>
            <p>
              <strong>
                {review.sender.first_name} {review.sender.last_name}
              </strong>{' '}
              ({review.sender.email}) wants to make you the owner of{' '}
              <strong>{review.workspace_name}</strong>.
            </p>
            {review.status === 'pending' ? (
              <form
                className="ownership-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  decide('accept', Object.fromEntries(new FormData(event.currentTarget)));
                }}
              >
                <div className="ownership-impact">
                  <Icon name="layers" />
                  <div>
                    <strong>
                      {review.databases} databases · {review.members} members
                    </strong>
                    <p>
                      {review.postgres_connections} live PostgreSQL connections. You will control
                      databases, saved connections, reports, people and access. The current owner
                      becomes a member.
                    </p>
                  </div>
                </div>
                {user.password_enabled !== false ? (
                  <label>
                    Confirm your password
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                      disabled={busy}
                    />
                  </label>
                ) : (
                  <p className="small muted">
                    Sign in with Microsoft again within five minutes before accepting.
                  </p>
                )}
                <p className="small muted">
                  Accepting transfers this workspace, not your account. You can decline and keep
                  your current access.
                </p>
                <div className="ownership-actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => decide('decline')}
                  >
                    Decline request
                  </button>
                  <button className="btn pri" disabled={busy}>
                    {busy ? 'Confirming…' : 'Accept ownership'}
                  </button>
                </div>
              </form>
            ) : (
              <p role="status">This ownership request is {review.status}.</p>
            )}
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {error && (
          <button className="btn" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            Refresh review
          </button>
        )}
      </div>
    </WorkspaceDialog>
  );
}

export function OwnershipRequests({ requests = [], disabled, onComplete }) {
  const [selected, setSelected] = useState(null);
  if (!requests.length && !selected) return null;
  return (
    <section className="ownership-inbox" aria-label="Ownership requests">
      <div className="ownership-inbox-heading">
        <Icon name="layers" />
        <strong>Ownership requests</strong>
        <span className="small muted">Review before taking control of a workspace.</span>
      </div>
      <div className="ownership-request-list">
        {requests.map((request) => (
          <article key={request.transfer_id}>
            <div>
              <strong>{request.workspace_name}</strong>
              <span className="small muted">
                From {request.sender.first_name} {request.sender.last_name} · Expires{' '}
                {new Date(request.expires_at * 1000).toLocaleDateString()}
              </span>
            </div>
            <button className="btn" disabled={disabled} onClick={() => setSelected(request)}>
              Review request
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <ReviewOwnership
          request={selected}
          onClose={() => setSelected(null)}
          onComplete={onComplete}
        />
      )}
    </section>
  );
}
