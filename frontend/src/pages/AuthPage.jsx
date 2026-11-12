import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter, Link } from '../lib/router';
import { AuthShell } from '../components/AuthShell';
import { MicrosoftSignIn, microsoftError, useMicrosoftSignIn } from '../components/MicrosoftSignIn';
import { readWorkspaceInvitation } from '../lib/workspaceInvites';
export default function AuthPage() {
  const { pathname, route, navigate } = useRouter(),
    { authenticate, refresh, error: authError, connectionError } = useAuth();
  const microsoftEnabled = useMicrosoftSignIn();
  const signup = pathname === '/signup';
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [retrying, setRetrying] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    document.title = (signup ? 'Sign up' : 'Log in') + ' | Data Genie';
    setError('');
    setShow(false);
  }, [signup]);
  async function submit(event) {
    event.preventDefault();
    if (busy || retrying) return;
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setError('');
    if (signup && values.password !== values.confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await authenticate(signup ? 'register' : 'login', values);
      form.reset();
      navigate(readWorkspaceInvitation() ? '/workspaces' : '/databases', true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function retryConnection() {
    if (busy || retrying) return;
    setError('');
    setRetrying(true);
    try {
      await refresh();
    } catch {
      // AuthProvider retains the latest read failure. Never replay a form submission.
    } finally {
      setRetrying(false);
    }
  }
  return (
    <AuthShell
      title={signup ? 'Create your account.' : 'Welcome back.'}
      lead={
        signup
          ? 'Create an account for your databases and history.'
          : 'Log in to your databases and saved history.'
      }
    >
      <nav className="auth-switch" aria-label="Account access">
        <Link href="/signin" aria-current={!signup ? 'page' : undefined}>
          Log in
        </Link>
        <Link href="/signup" aria-current={signup ? 'page' : undefined}>
          Sign up
        </Link>
      </nav>
      {new URLSearchParams(route.split('?')[1] || '').get('account') === 'deleted' && (
        <p className="ok" role="status">
          Your Data Genie account has been deleted.
        </p>
      )}
      {microsoftError(route) && (
        <p className="err" role="alert">
          {microsoftError(route)}
        </p>
      )}
      {microsoftEnabled && <MicrosoftSignIn disabled={busy || retrying} />}
      <form key={signup ? 'signup' : 'login'} onSubmit={submit}>
        <div className="fields">
          {signup && (
            <>
              <label>
                First name
                <input name="first_name" autoComplete="given-name" maxLength={100} required />
              </label>
              <label>
                Last name
                <input name="last_name" autoComplete="family-name" maxLength={100} required />
              </label>
            </>
          )}
          <label className="wide">
            Email
            <input name="email" type="email" autoComplete="username" maxLength={254} required />
          </label>
          <div className="wide">
            <label htmlFor="authPassword">Password</label>
            <div className="password-input">
              <input
                id="authPassword"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 15 : 1}
                maxLength={128}
                aria-describedby="passwordHelp"
                required
              />
              <button
                className="text-button"
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {signup && (
            <label className="wide">
              Confirm password
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                required
              />
            </label>
          )}
        </div>
        <p className="identity-note" id="passwordHelp">
          {signup
            ? 'Use 15 to 128 characters. A long, unique passphrase works well.'
            : 'Use the account you created on this site.'}
        </p>
        <button className="btn pri start-button" disabled={busy || retrying}>
          {busy
            ? signup
              ? 'Creating your account…'
              : 'Logging in…'
            : signup
              ? 'Create account'
              : 'Log in'}
        </button>
        <p className="err" role="status">
          {error || authError}
        </p>
        {connectionError && (
          <button
            className="btn sec"
            type="button"
            onClick={retryConnection}
            disabled={busy || retrying}
          >
            {retrying ? 'Checking connection…' : 'Retry connection'}
          </button>
        )}
      </form>
    </AuthShell>
  );
}
