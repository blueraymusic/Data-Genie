import { Icon } from './Icon';
export function WorkspaceTabs({ view, onNavigate }) {
  return (
    <nav className="tabs" aria-label="Mobile navigation">
      {[
        ['connect', 'Databases', 'database'],
        ['ask', 'Workspace', 'workspace'],
        ['history', 'History', 'clock'],
        ['account', 'Account', 'account'],
      ].map(([id, label, icon]) => {
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
