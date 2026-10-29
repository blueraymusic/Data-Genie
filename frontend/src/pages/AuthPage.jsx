import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter, Link } from '../lib/router';
import { AuthShell } from '../components/AuthShell';
export default function AuthPage() {
  const { pathname, navigate } = useRouter(),
    { authenticate, error: authError } = useAuth();
  const signup = pathname === '/signup';
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    document.title = (signup ? 'Sign up' : 'Log in') + ' | Data Genie';
    setError('');
    setShow(false);
  }, [signup]);
  async function submit(event) {
    event.preventDefault();
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
      navigate('/databases', true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title={signup ? 'Make room for your next question.' : 'Welcome back.'}
      lead={
        signup
          ? 'Create a local account for your databases and history.'
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
            : 'Your account is stored on this computer.'}
        </p>
        <button className="btn pri start-button" disabled={busy}>
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
      </form>
    </AuthShell>
  );
}
