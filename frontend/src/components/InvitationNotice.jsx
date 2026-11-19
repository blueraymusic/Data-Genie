import { Link } from '../lib/router';
import { useInvitationCount } from '../hooks/useInvitationCount';

export function InvitationNotice() {
  const count = useInvitationCount();
  if (!count) return null;
  return (
    <aside className="invitation-notice" aria-label="Workspace invitations">
      <span>
        You have {count === 1 ? 'a workspace invitation' : `${count} workspace invitations`}.
      </span>
      <Link href="/workspaces">Review {count === 1 ? 'invitation' : 'invitations'} →</Link>
    </aside>
  );
}
