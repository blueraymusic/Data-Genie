import { Icon } from './Icon';
import { databaseAccess } from '../lib/access';
import { useInvitationCount } from '../hooks/useInvitationCount';
export function WorkspaceTabs({ view, onNavigate, session }) {
  const invitationCount = useInvitationCount();
  return (
    <nav className="tabs" aria-label="Mobile navigation">
      {[
        ['connect', 'Databases', 'database'],
        ['workspaces', 'Teams', 'layers'],
        ['ask', 'Workspace', 'workspace'],
        ['history', 'History', 'clock'],
        ['account', 'Account', 'account'],
      ]
        .filter(
          ([id]) => !session || databaseAccess(session).canRead || !['ask', 'history'].includes(id),
        )
        .map(([id, label, icon]) => {
          const active = view === id || (id === 'ask' && ['schema', 'sql'].includes(view));
          return (
            <button
              key={id}
              className={active ? 'on' : undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon name={icon} />
              {label}
              {id === 'workspaces' && invitationCount > 0 && (
                <span
                  className="invitation-count"
                  aria-label={`${invitationCount} pending invitations`}
                >
                  {invitationCount}
                </span>
              )}
            </button>
          );
        })}
    </nav>
  );
}
