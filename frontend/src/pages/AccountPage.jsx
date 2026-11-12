import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Link, useRouter } from '../lib/router';
import { api } from '../lib/api';
import { microsoftError, useMicrosoftSignIn } from '../components/MicrosoftSignIn';
import { AccountGeneral } from '../components/AccountGeneral';
import { AccountSecurity } from '../components/AccountSecurity';
import { Icon } from '../components/Icon';
import { useEnterMotion } from '../hooks/useMotion';
const AgentAccess = lazy(() =>
  import('../components/AgentAccess').then((module) => ({ default: module.AgentAccess })),
);
export default function AccountPage({ workbench, mode, setMode }) {
  const { user, changePassword, refresh } = useAuth(),
    { theme, toggle } = useTheme();
  const { route } = useRouter();
  const microsoftEnabled = useMicrosoftSignIn();
  const [linkBusy, setLinkBusy] = useState(false),
    [linkError, setLinkError] = useState('');
  const passwordEnabled = user.password_enabled !== false;
  const linkedReturn =
    new URLSearchParams(route.split('?')[1]?.split('#')[0] || '').get('microsoft') === 'linked';
  useEffect(() => {
    if (linkedReturn) refresh().catch(() => {});
  }, [linkedReturn, refresh]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentsVisited, setAgentsVisited] = useState(false);
  const panel = useRef(null),
    security = useRef(null);
  useEnterMotion(panel, 'account');
  useEffect(() => {
    if (linkedReturn || microsoftError(route)) {
      security.current?.focus({ preventScroll: true });
      security.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [linkedReturn, route]);
  async function submit(event) {
    event.preventDefault();
    if (busy || linkBusy) return;
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
  async function connectMicrosoft(event) {
    event.preventDefault();
    if (linkBusy || busy) return;
    const form = event.currentTarget;
    setLinkBusy(true);
    setLinkError('');
    try {
      const result = await api('/api/auth/microsoft/link', {
        method: 'POST',
        body: { password: new FormData(form).get('password') },
      });
      if (result.url !== '/api/auth/microsoft/start?intent=link')
        throw new Error('Microsoft sign-in could not be started. Please try again.');
      form.reset();
      window.location.assign(result.url);
    } catch (error) {
      setLinkError(error.message);
      setLinkBusy(false);
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
          ref={security}
          tabIndex={-1}
        >
          <AccountSecurity
            {...{
              user,
              passwordEnabled,
              busy,
              linkBusy,
              error,
              message,
              submit,
              microsoftEnabled,
              linkedReturn,
              connectMicrosoft,
              linkError,
              route,
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
