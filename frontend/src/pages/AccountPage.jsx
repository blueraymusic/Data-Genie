import { lazy, Suspense, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Link } from '../lib/router';
import { AccountGeneral } from '../components/AccountGeneral';
import { AccountSecurity } from '../components/AccountSecurity';
import { Icon } from '../components/Icon';
import { useEnterMotion } from '../hooks/useMotion';
const AgentAccess = lazy(() =>
  import('../components/AgentAccess').then((module) => ({ default: module.AgentAccess })),
);
export default function AccountPage({ workbench, mode, setMode }) {
  const { user, changePassword } = useAuth(),
    { theme, toggle } = useTheme();
  const passwordEnabled = user.password_enabled !== false;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentsVisited, setAgentsVisited] = useState(false);
  const panel = useRef(null);
  useEnterMotion(panel, 'account');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setMessage('');
    setError('');
    if (values.new_password !== values.confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      setMessage(await changePassword(values));
      form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-page" ref={panel}>
      <header className="page-heading account-page-heading">
        <div>
          <h1>Account &amp; preferences</h1>
          <p className="lead">Your profile, preferences and connections. All in one place.</p>
        </div>
        <Link className="account-help-link" href="/faq">
          Help &amp; FAQ <Icon name="arrow" />
        </Link>
      </header>
      <div className="account-settings-layout">
        <section className="account-panel-surface" aria-label="General">
          <AccountGeneral
            user={user}
            theme={theme}
            toggle={toggle}
            session={workbench.session}
            mode={mode}
            setMode={setMode}
          />
        </section>
        <section
          className="account-panel-surface account-security-panel"
          aria-label="Sign-in & security"
        >
          <AccountSecurity
            {...{
              user,
              passwordEnabled,
              busy,
              error,
              message,
              submit,
            }}
          />
        </section>
      </div>
      <details
        className="account-agent-section"
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setAgentsOpen(open);
          if (open) setAgentsVisited(true);
        }}
      >
        <summary>
          <span className="account-agent-label">
            <Icon name="layers" />
            <strong>Agents &amp; API</strong>
            <span>Connect an agent or manage access keys.</span>
          </span>
          <span className="account-agent-action">
            Manage connections <Icon name="arrow" />
          </span>
        </summary>
        {agentsVisited && (
          <div className="account-agent-body">
            <Suspense
              fallback={
                <p className="workspace-loading" role="status">
                  Loading connections…
                </p>
              }
            >
              <AgentAccess passwordEnabled={passwordEnabled} active={agentsOpen} />
            </Suspense>
          </div>
        )}
      </details>
      <p className="account-storage-note">
        <Icon name="database" />
        Accounts and history are saved with this Data Genie installation.
      </p>
    </section>
  );
}