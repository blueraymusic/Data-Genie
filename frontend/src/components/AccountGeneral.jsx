import { Link } from '../lib/router';
import { databaseAccess } from '../lib/access';
import { Icon } from './Icon';
import { AccountProfile } from './AccountProfile';

export function AccountGeneral({ user, theme, toggle, session, mode, setMode }) {
  const aiAvailable = Boolean(session?.ai?.enabled);
  return (
    <>
      <header className="account-panel-heading">
        <h2>General</h2>
        <p>Your profile and the way you like to work.</p>
      </header>
      <AccountProfile user={user} />
      {session && (
        <p className="account-current-workspace">
          <Icon name="layers" />
          <span>{databaseAccess(session).workspaceName}</span>
          <span aria-hidden="true">·</span>
          <span>{session.database}</span>
        </p>
      )}
      <section className="account-setting-row" aria-labelledby="appearanceTitle">
        <div>
          <h3 id="appearanceTitle">Appearance</h3>
          <p>Choose a comfortable view.</p>
        </div>
        <div className="account-theme-switch" role="group" aria-label="Appearance">
          {['light', 'dark'].map((value) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => {
                if (theme !== value) toggle();
              }}
            >
              <Icon name={value === 'light' ? 'sun' : 'moon'} />
              {value === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>
      <section className="account-workspace-setting" aria-labelledby="workspaceViewTitle">
        <h3 id="workspaceViewTitle">Default workspace view</h3>
        {session ? (
          <>
            <fieldset
              className="account-mode-options"
              aria-labelledby="workspaceViewTitle"
              aria-describedby="requestModeHelp"
            >
              {[
                {
                  value: 'gemini',
                  title: 'Data Genie AI',
                  description: 'Ask in plain English.',
                  icon: 'workspace',
                },
                {
                  value: 'sql',
                  title: 'SQL',
                  description: 'Write SQL directly. No AI key.',
                  icon: 'table',
                },
              ].map((choice) => {
                const checked =
                  choice.value === 'gemini'
                    ? mode === 'gemini' && aiAvailable
                    : mode === 'sql' || !aiAvailable;
                return (
                  <label key={choice.value} className={checked ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="account-workspace-view"
                      value={choice.value}
                      checked={checked}
                      disabled={choice.value === 'gemini' && !aiAvailable}
                      onChange={() => setMode(choice.value)}
                      aria-label={choice.title}
                    />
                    <Icon name={choice.icon} />
                    <span>
                      <strong>{choice.title}</strong>
                      <small>{choice.description}</small>
                    </span>
                    {checked && <Icon name="check" className="ic account-choice-check" />}
                  </label>
                );
              })}
            </fieldset>
            <p id="requestModeHelp" className="account-setting-help">
              Applies the next time you open a database. Local SQLite works offline while Data Genie
              is running; PostgreSQL needs its connection.
              {!aiAvailable &&
                ' Data Genie AI is currently unavailable, so new sessions open in SQL.'}
            </p>
          </>
        ) : (
          <p className="account-setting-help">
            <Link href="/databases">Choose a database</Link> to set your workspace view or download
            a copy.
          </p>
        )}
      </section>
      {session &&
        (session.source === 'postgresql' ? (
          <section className="account-database-row">
            <span className="account-database-icon">
              <Icon name="database" />
            </span>
            <div>
              <h3>{session.database || 'PostgreSQL'}</h3>
              <p>
                {session.read_only
                  ? 'Read-only connection'
                  : 'Live PostgreSQL · Changes require confirmation'}
                . Use Download CSV on a result to save a copy.
              </p>
            </div>
          </section>
        ) : (
          databaseAccess(session).permissions.export && (
            <section className="account-database-row">
              <span className="account-database-icon">
                <Icon name="database" />
              </span>
              <div>
                <h3>Database copy</h3>
                <p>{session.database || 'Your current SQLite database'}</p>
              </div>
              <a
                className="btn"
                href={'/api/download?session_id=' + encodeURIComponent(session.session_id)}
                download
              >
                <Icon name="download" />
                Download SQLite file
              </a>
            </section>
          )
        ))}
    </>
  );
}
