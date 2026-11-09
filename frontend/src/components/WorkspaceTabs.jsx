import { Icon } from './Icon';
import { databaseAccess } from '../lib/access';
export function WorkspaceTabs({ view, onNavigate, session }) {
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
            </button>
          );
        })}
    </nav>
  );
}
