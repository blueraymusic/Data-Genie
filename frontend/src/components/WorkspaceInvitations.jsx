import { useEffect, useState } from 'react';
import { formatTime } from '../lib/api';
import { invitationToken, readWorkspaceInvitation } from '../lib/workspaceInvites';
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
          type="password"
          autoComplete="off"
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

export function WorkspaceInvitations({ invitations, loading, disabled, onAccept }) {
  const saved = readWorkspaceInvitation();
  const unavailable =
    !loading && saved && !invitations.some((item) => item.invitation_id === saved.invitation_id);
  if (!invitations.length && !unavailable) return null;
  return (
    <section
      className="workspace-section workspace-received-invitations"
      aria-labelledby="workspaceInvitationsTitle"
    >
      <header>
        <h2 id="workspaceInvitationsTitle">Your invitations</h2>
        <p className="small muted">
          Use your invitation link or the private code from the owner. Sign in with the email
          address they invited.
        </p>
      </header>
      {unavailable && (
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

export function WorkspaceInviteManager({
  invitations,
  disabled,
  onAction,
  onError,
  onMessage,
  draft,
  setDraft,
  email: emailConfiguration,
}) {
  const { email, role, link } = draft;
  const [composing, setComposing] = useState(false);
  const [retryUntil, setRetryUntil] = useState({});
  const [now, setNow] = useState(Date.now);
  const emailEnabled = emailConfiguration?.enabled === true;
  const cooldown = (invitation) =>
    Math.max(
      0,
      Math.ceil(
        (Math.max(
          retryUntil[invitation.email] || 0,
          Number(invitation.email_attempted_at || 0) * 1000 +
            (invitation.email_attempted_at ? 60000 : 0),
        ) -
          now) /
          1000,
      ),
    );
  useEffect(() => {
    if (!invitations.some((invitation) => cooldown(invitation) > 0)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitations, retryUntil, now]);
  async function invite(event) {
    event.preventDefault();
    await createInvitation(email.trim(), role);
  }
  async function createInvitation(recipient, invitedRole) {
    const result = await onAction(
      'invite',
      { email: recipient, role: invitedRole },
      'Invitation created.',
    );
    if (result?.token) {
      setComposing(false);
      setNow(Date.now());
      setRetryUntil((current) => ({
        ...current,
        [recipient]: Date.now() + Number(result.retry_after || 60) * 1000,
      }));
      const query = new URLSearchParams({ invite: result.invitation_id, token: result.token });
      setDraft((current) => ({
        ...current,
        email: '',
        link: {
          invitationId: result.invitation_id,
          email: recipient,
          url: result.invitation_url || location.origin + '/workspaces?' + query,
          emailStatus: result.email_status || 'not_configured',
          emailMessage: result.email_message || '',
        },
      }));
      if (result.email_status === 'sent')
        onMessage('Invitation email sent. You can also share its private link.');
      else if (result.email_status === 'failed') {
        onMessage('');
        onError('Email could not be sent. Copy the private invitation link to share it.');
      } else onMessage('Email is not configured. Copy the private invitation link to share it.');
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
          <h2 id="workspaceInviteTitle">Invitations</h2>
          <p className="small muted">
            {emailEnabled
              ? 'Send an invitation email or share a private link.'
              : 'Create a private invitation link to share with your teammate.'}{' '}
            They’ll need to sign in with the matching email.
          </p>
        </div>
        {!composing && (
          <button className="btn" disabled={disabled} onClick={() => setComposing(true)}>
            <Icon name="plus" />
            Invite a teammate
          </button>
        )}
      </header>
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
              <option value="viewer">Viewer · Future shared reports</option>
            </select>
          </label>
          <button className="btn pri" disabled={disabled || !email.trim()}>
            {emailEnabled ? 'Send invitation' : 'Create invitation link'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => setComposing(false)}
          >
            Cancel
          </button>
        </form>
      )}
      {link && (
        <div className="workspace-private-invite" role="status">
          <p className="workspace-invite-delivery">
            <strong>
              {link.emailStatus === 'sent'
                ? 'Invitation email sent'
                : link.emailStatus === 'failed'
                  ? 'Email could not be sent — share this link instead'
                  : 'Your private invitation link is ready'}
            </strong>
            {link.emailStatus === 'failed' && link.emailMessage && <span>{link.emailMessage}</span>}
          </p>
          <label>
            Private invitation link for {link.email}
            <input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link.url);
                onMessage('Invitation link copied. Send it privately to your teammate.');
              } catch {
                onError('Copy is unavailable. Select the invitation link and copy it manually.');
              }
            }}
          >
            Copy invitation link
          </button>
          <p className="small muted">
            {link.emailStatus === 'sent' &&
              'The email provider accepted the message; delivery is not yet confirmed. '}
            This link is shown once. Keep it private; revoking or resending the invitation
            invalidates it.
          </p>
        </div>
      )}
      {invitations.length > 0 && (
        <ul className="workspace-pending-invitations">
          {invitations.map((invitation) => (
            <li key={invitation.invitation_id}>
              <span>
                {invitation.email}{' '}
                <small>
                  {invitation.role} · Expires {invitationExpiry(invitation.expires_at)}
                </small>
                {invitation.email_status === 'failed' && invitation.email_message && (
                  <small>{invitation.email_message}</small>
                )}
                <small>
                  {invitation.email_status === 'sent'
                    ? 'Email sent · Provider accepted'
                    : invitation.email_status === 'failed'
                      ? 'Email could not be sent'
                      : 'Private link invitation'}
                </small>
              </span>
              <div className="workspace-invitation-actions">
                {emailEnabled && (
                  <button
                    className="text-button"
                    disabled={disabled || cooldown(invitation) > 0}
                    onClick={() => createInvitation(invitation.email, invitation.role)}
                  >
                    {cooldown(invitation) > 0
                      ? `Resend in ${cooldown(invitation)}s`
                      : 'Resend email'}
                  </button>
                )}
                <button
                  className="text-button workspace-remove"
                  disabled={disabled}
                  onClick={() => revoke(invitation)}
                >
                  Revoke invitation
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {emailEnabled && invitations.length > 0 && (
        <p className="small muted workspace-resend-note">
          Resending creates a new private link and invalidates the previous one.
        </p>
      )}
      {!invitations.length && !composing && !link && (
        <p className="small muted workspace-no-invitations">No pending invitations.</p>
      )}
    </section>
  );
}
