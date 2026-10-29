import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from './PublicHeader';
import { Link } from '../lib/router';
function SessionTimer({ started }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(started).getTime()) / 1000));
  return (
    <span className="session-timer">
      {[Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((value) => String(value).padStart(2, '0'))
        .join(':')}
    </span>
  );
}
export function WorkspaceHeader({
  session,
  identity = session,
  view,
  onNavigate,
  onEnd,
  onLogout,
  disabled,
}) {
  const dropdown = useRef(null),
    trigger = useRef(null);
  const [menu, setMenu] = useState(false),
    name = identity.first_name + ' ' + identity.last_name;
  useEffect(() => {
    setMenu(false);
  }, [view]);
  useEffect(() => {
    const close = (event) => {
      if (!dropdown.current?.contains(event.target)) setMenu(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape' && menu) {
        setMenu(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  return (
    <header className="top">
      <Brand />
      <nav className="nav" aria-label="Main navigation">
        {[
          ['connect', 'Databases'],
          ['ask', 'Workspace'],
          ['history', 'History'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={
              view === id || (id === 'ask' && ['schema', 'sql'].includes(view)) ? 'on' : undefined
            }
            aria-current={
              view === id || (id === 'ask' && ['schema', 'sql'].includes(view)) ? 'page' : undefined
            }
            onClick={() => onNavigate(id)}
          >
            {label}
            {id === 'ask' && session && (
              <span className="live-indicator" aria-label="Open session" />
            )}
          </button>
        ))}
      </nav>
      <div className="top-actions">
        {session && <SessionTimer started={session.started_at} />}
        <ThemeToggle className="icon-button" />
        <div className="user-dropdown" ref={dropdown}>
          <button
            className="user-menu"
            ref={trigger}
            aria-label="Open user menu"
            aria-expanded={menu}
            aria-controls="userMenuPanel"
            title={name}
            onClick={() => setMenu(!menu)}
          >
            {[identity.first_name[0], identity.last_name[0]].join('').toUpperCase()}
          </button>
          {menu && (
            <div className="user-menu-panel" id="userMenuPanel">
              <button onClick={() => onNavigate('account')}>Account &amp; preferences</button>
              <Link href="/faq">FAQ &amp; help</Link>
              <Link href="/">Homepage</Link>
              {session ? (
                <>
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setMenu(false);
                      onEnd(false);
                    }}
                  >
                    End session
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setMenu(false);
                      onEnd(true);
                    }}
                  >
                    End session &amp; sign out
                  </button>
                </>
              ) : (
                <button disabled={disabled} onClick={onLogout}>
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
