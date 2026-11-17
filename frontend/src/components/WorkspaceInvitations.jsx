import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/api';
import {
  invitationToken,
  readWorkspaceInvitation,
  forgetWorkspaceInvitation,
} from '../lib/workspaceInvites';
import { WorkspaceDialog } from './WorkspaceDialog';
import { Icon } from './Icon';

const invitationExpiry = (value) => formatTime(typeof value === 'number' ? value * 1000 : value);

function Invitation({ invitation, disabled, onAccept }) {
  const saved = readWorkspaceInvitation();
  const [code, setCode] = useState(
    saved?.invitation_id === invitation.invitation_id ? saved.token : '',
  );
  useEffect(() => {
    if (saved?.invitation_id === invitation.invitation_id) setCode(saved.token);
  }, [saved?.invitation_id, saved?.token, invitation.invitation_id]);
  return (
    <form
      className="workspace-invitation"
      onSubmit={(event) => {
        event.preventDefault();
        onAccept(invitation, invitationToken(code, invitation.invitation_id));
      }}
    >
      <div>
        <h3>{invitation.workspace_name}</h3>
        <p className="small muted">
          Invited as {invitation.role} · Expires {invitationExpiry(invitation.expires_at)}
        </p>
      </div>
      <label>
        Invitation link or code
        <input
          type="text"
          autoComplete="off"
          spellCheck="false"
          placeholder="Paste the code from the workspace owner"
          value={code}
          maxLength={2048}
          required
          disabled={disabled}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <button className="btn pri" disabled={disabled || !code.trim()}>
        Join workspace
      </button>
    </form>
  );
}

export function WorkspaceInvitations({
  invitations,
  loading,
  resolved = true,
  disabled,
  onAccept,
}) {
  const saved = readWorkspaceInvitation();
  const unavailable =
    resolved &&
    !loading &&
    saved &&
    !invitations.some((item) => item.invitation_id === saved.invitation_id);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [saved?.invitation_id]);
  useEffect(() => {
    if (!unavailable) return;
    const timer = setTimeout(() => {
      forgetWorkspaceInvitation(saved.invitation_id);
      setDismissed(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [unavailable, saved?.invitation_id]);
  if (!invitations.length && (!unavailable || dismissed)) return null;
  return (
    <section
      className="workspace-section workspace-received-invitations"
      aria-labelledby="workspaceInvitationsTitle"
    >
      <header>
        <h2 id="workspaceInvitationsTitle">Your invitations</h2>
        <p className="small muted">
          Enter the code shared by the workspace owner to join. You’re seeing these invitations
          because you’re signed in with the invited email.
        </p>
      </header>
      {unavailable && !dismissed && (
        <p className="workspace-pending-note" role="status">
          This invitation is not available for your signed-in email. Check that you are using the
          invited account, or ask the owner for a new link if it has expired, been revoked, or
          already been used.
        </p>
      )}
      {invitations.map((invitation) => (
        <Invitation key={invitation.invitation_id} {...{ invitation, disabled, onAccept }} />
      ))}
    </section>
  );
}

function InlineInvitations({ children, onClose }) {
  return (
    <div className="inline-invitations" role="region" aria-label="Workspace invitations">
      <button type="button" className="text-button" onClick={onClose}>
        Back to invitations
      </button>
      {children}
    </div>
  );
}

export function WorkspaceInviteManager({
  invitations,
  disabled,
  onAction,
  onError,
  draft,
  setDraft,
  error,
  inline = false,
}) {
  const InvitationSurface = inline ? InlineInvitations : WorkspaceDialog;
  const inviteTrigger = useRef(null);
  const { email, role, link } = draft;
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(invitations.length / 3));
  const currentPage = Math.min(page, pages);
  useEffect(() => setPage((value) => Math.min(value, pages)), [pages]);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState('');
  async function invite(event) {
    event.preventDefault();
    const recipient = email.trim();
    const result = await onAction(
      'invite',
      { email: recipient, role },
      'Invitation created. Share the code with your teammate.',
    );
    if (result?.token) {
      setComposing(false);
      setReviewing(false);
      const query = new URLSearchParams({ invite: result.invitation_id, token: result.token });
      setDraft((current) => ({
        ...current,
        email: '',
        link: {
          invitationId: result.invitation_id,
          email: recipient,
          code: result.token,
          expiresAt: result.expires_at,
          url: result.invitation_url || location.origin + '/workspaces?' + query,
        },
      }));
    }
  }
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(label + ' copied. Share it privately with your teammate.');
    } catch {
      onError('Copy is unavailable. Select the invitation code or link and copy it manually.');
    }
  }
  async function revoke(invitation) {
    const result = await onAction(
      'invitations/revoke',
      { invitation_id: invitation.invitation_id },
      'Invitation revoked.',
    );
    if (result && link?.invitationId === invitation.invitation_id)
      setDraft((current) => ({ ...current, link: null }));
  }
  return (
    <section className="workspace-section" aria-labelledby="workspaceInviteTitle">
      <header className="workspace-section-heading">
        <div>
          <h2 id="workspaceInviteTitle">
            Invitations
            {invitations.length > 0 && (
              <button
                className="text-button workspace-heading-count"
                disabled={disabled}
                onClick={() => {
                  setReviewing(true);
                  setComposing(false);
                }}
              >
                {invitations.length} pending
              </button>
            )}
          </h2>
          <p className="small muted">Share invitation codes privately. No email is sent.</p>
        </div>
        {!composing && (
          <button
            ref={inviteTrigger}
            className="btn pri"
            disabled={disabled}
            onClick={() => {
              setComposing(true);
              setReviewing(false);
            }}
          >
            <Icon name="plus" />
            Invite a teammate
          </button>
        )}
      </header>
      {(composing || reviewing || link) && (
        <InvitationSurface
          title="Workspace invitations"
          busy={disabled}
          onClose={() => {
            setComposing(false);
            setReviewing(false);
            setDraft((current) => ({ ...current, link: null }));
            if (inline) requestAnimationFrame(() => inviteTrigger.current?.focus());
          }}
        >
          {notice && (
            <p role="status" className="small">
              {notice}
            </p>
          )}
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          {composing && (
            <form className="workspace-invite-form" onSubmit={invite}>
              <label>
                Email
                <input
                  type="email"
                  autoFocus
                  autoComplete="off"
                  value={email}
                  required
                  maxLength={254}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label>
                Role
                <select
                  value={role}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, role: event.target.value }))
                  }
                >
                  <option value="member">Member · Database access by grant</option>
                  <option value="viewer">Viewer · Shared reports only</option>
                </select>
              </label>
              <button className="btn pri" disabled={disabled || !email.trim()}>
                Create invitation
              </button>
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => setComposing(false)}
              >
                Cancel
              </button>
              <p className="small muted workspace-invitation-form-note">
                Invitations expire after 7 days. Members need database access after joining.
              </p>
            </form>
          )}
          {link && (!inline || (!composing && !reviewing)) && (
            <div className="workspace-private-invite">
              <p className="workspace-invite-code-heading" role="status">
                <strong>Invitation code ready for {link.email}</strong>
              </p>
              <div className="workspace-invitation-code">
                <label>
                  Invitation code for {link.email}
                  <input
                    readOnly
                    value={link.code}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <button className="btn pri" onClick={() => copy(link.code, 'Invitation code')}>
                  <Icon name="copy" />
                  Copy code
                </button>
              </div>
              <p className="small muted">
                This code is shown once. Share it privately with {link.email}. They’ll need to log
                in with that email and enter the code to join.
                {link.expiresAt
                  ? ' Expires ' + invitationExpiry(link.expiresAt) + '.'
                  : ' Expires after 7 days.'}
              </p>
              <details className="workspace-invitation-link">
                <summary>Or share a private invitation link</summary>
                <div>
                  <label>
                    Private invitation link for {link.email}
                    <input
                      readOnly
                      value={link.url}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <button className="btn" onClick={() => copy(link.url, 'Invitation link')}>
                    Copy invitation link
                  </button>
                </div>
              </details>
            </div>
          )}
          {invitations.length > 0 && (!inline || (reviewing && !composing)) && (
            <>
              <ul className="workspace-pending-invitations">
                {invitations.slice((currentPage - 1) * 3, currentPage * 3).map((invitation) => (
                  <li key={invitation.invitation_id}>
                    <span>
                      {invitation.email}
                      <small>
                        {invitation.role} · Expires {invitationExpiry(invitation.expires_at)}
                      </small>
                    </span>
                    <button
                      className="text-button workspace-remove"
                      disabled={disabled}
                      onClick={() => revoke(invitation)}
                    >
                      Revoke invitation
                    </button>
                  </li>
                ))}
              </ul>
              {pages > 1 && (
                <nav className="person-picker-pagination" aria-label="Invitation pages">
                  <span>
                    {currentPage} of {pages}
                  </span>
                  <button
                    className="btn"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous invitations
                  </button>
                  <button
                    className="btn"
                    disabled={currentPage === pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next invitations
                  </button>
                </nav>
              )}
            </>
          )}
        </InvitationSurface>
      )}
      {!invitations.length && !composing && !link && (
        <p className="small muted workspace-no-invitations">
          No pending invitations. Invite a teammate to work together.
        </p>
      )}
    </section>
  );
}
