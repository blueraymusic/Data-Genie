import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Link, useRouter } from '../lib/router';
import { api } from '../lib/api';
import { MicrosoftMark, microsoftError, useMicrosoftSignIn } from '../components/MicrosoftSignIn';
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
  async function submit(event) {
    event.preventDefault();
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
    if (linkBusy) return;
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
    <section className="account-page">
      <header className="page-heading">
        <div>
          <h1>Account &amp; preferences</h1>
          <p className="lead">Manage your profile, appearance, and how you sign in.</p>
        </div>
      </header>
      <section className="account-section" aria-labelledby="accountDetailsTitle">
        <h2 id="accountDetailsTitle">Account details</h2>
        <div className="account-ledger">
          <p>
            <span>Name</span>
            <strong>
              {user.first_name} {user.last_name}
            </strong>
          </p>
          <p>
            <span>Email</span>
            <strong>{user.email}</strong>
          </p>
          <p>
            <span>Appearance</span>
            <span className="account-current-theme">{theme} theme</span>
            <button className="btn" onClick={toggle}>
              Use {theme === 'dark' ? 'light' : 'dark'} theme
            </button>
          </p>
          {workbench.session && (
            <>
              <p>
                <span>Default workspace view</span>
                <label className="sr-only" htmlFor="requestMode">
                  Default workspace view
                </label>
                <select
                  id="requestMode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                  aria-describedby="requestModeHelp"
                >
                  <option value="gemini" disabled={!workbench.session.ai?.enabled}>
                    Data Genie AI
                  </option>
                  <option value="sql">SQL</option>
                </select>
              </p>
              <p id="requestModeHelp" className="small muted">
                Data Genie AI accepts plain English. SQL runs statements directly without an AI
                service or AI key. Local SQLite works offline while Data Genie is running;
                PostgreSQL still needs its database connection. Your choice applies when you next
                open a database.
                {!workbench.session.ai?.enabled &&
                  ' Data Genie AI is unavailable, so new sessions open in SQL.'}
              </p>
              {workbench.session.source === 'postgresql' ? (
                <p>
                  <span>PostgreSQL access</span>
                  <strong>
                    {workbench.session.read_only ? 'Read-only' : 'Changes require confirmation'}
                  </strong>
                </p>
              ) : (
                <p>
                  <span>Database copy</span>
                  <a
                    className="btn"
                    href={
                      '/api/download?session_id=' + encodeURIComponent(workbench.session.session_id)
                    }
                    download
                  >
                    Download SQLite file
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </section>
      {!workbench.session && (
        <p className="small muted">
          <Link href="/databases">Choose a database</Link> to change your default workspace view or
          export a SQLite file.
        </p>
      )}
      {workbench.session?.source === 'postgresql' && (
        <p className="small muted">
          Confirmed edits are saved directly in the connected PostgreSQL database when changes are
          enabled. Use Download CSV on a result to save a copy of its shown rows.
        </p>
      )}
      {(user.microsoft_linked || !passwordEnabled) && (
        <div className="password-form account-section">
          <h2>Microsoft sign-in</h2>
          <p className="microsoft-account-note">
            <MicrosoftMark /> Microsoft account connected
          </p>
          <p className="small muted">
            {passwordEnabled
              ? 'You can log in with Microsoft or your Data Genie password.'
              : 'Your sign-in is managed by Microsoft. Change your password in your Microsoft account.'}
          </p>
          {linkedReturn && user.microsoft_linked && (
            <p className="ok" role="status">
              Microsoft sign-in is connected to your account.
            </p>
          )}
        </div>
      )}
      {microsoftEnabled && passwordEnabled && !user.microsoft_linked && (
        <form
          className="password-form account-section microsoft-link-form"
          aria-label="Connect Microsoft account"
          onSubmit={connectMicrosoft}
        >
          <h2>Connect Microsoft</h2>
          <p className="small muted">
            Add another way to log in. Confirm your Data Genie password, then choose your Microsoft
            account.
          </p>
          <label>
            Data Genie password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </label>
          <button className="btn microsoft-button" disabled={linkBusy || busy}>
            <MicrosoftMark />
            {linkBusy ? 'Connecting…' : 'Connect Microsoft'}
          </button>
          <p className="err" role="status">
            {linkError}
          </p>
        </form>
      )}
      {microsoftError(route) && (
        <p className="err" role="alert">
          {microsoftError(route)}
        </p>
      )}
      {passwordEnabled && (
        <form className="password-form account-section" onSubmit={submit}>
          <h2>Change password</h2>
          <label>
            Current password
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </label>
          <label>
            New password
            <input
              name="new_password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              aria-describedby="newPasswordHelp"
            />
          </label>
          <p className="small muted" id="newPasswordHelp">
            Use 15 to 128 characters. A long, unique passphrase works well.
          </p>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
            />
          </label>
          <button className="btn pri" disabled={busy || linkBusy}>
            {busy ? 'Updating password…' : 'Update password'}
          </button>
          <p className={error ? 'err' : 'ok'} role="status">
            {error || message}
          </p>
        </form>
      )}
      <p className="small muted account-storage-note">
        Accounts and history are saved where Data Genie runs.
        {passwordEnabled && ' Changing your password signs out other browser logins.'}
      </p>
    </section>
  );
}
