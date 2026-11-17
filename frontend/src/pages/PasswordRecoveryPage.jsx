import { useEffect, useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { Link, useRouter } from '../lib/router';
import { api } from '../lib/api';

export default function PasswordRecoveryPage() {
  const { pathname, route, navigate } = useRouter();
  const reset = pathname === '/reset-password';
  const [token] = useState(() => new URLSearchParams(route.split('#')[1] || '').get('token') || '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    document.title = (reset ? 'Choose a new password' : 'Reset password') + ' | Data Genie';
    // Capture the token in memory, then remove it from the address bar.
    if (reset && route.includes('#')) navigate('/reset-password', true);
  }, [reset, route, navigate]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    if (reset && values.new_password !== values.confirm_password) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const result = await api('/api/auth/' + (reset ? 'reset-password' : 'forgot-password'), {
        method: 'POST',
        body: reset ? { token, new_password: values.new_password } : { email: values.email },
      });
      setMessage(result.message);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const invalid = reset && !token;
  return (
    <AuthShell
      title={reset ? 'Choose a new password.' : 'Forgot your password?'}
      lead={
        reset
          ? 'Use a long, unique passphrase for your account.'
          : 'Enter your email and we’ll send instructions if an account with a password exists.'
      }
    >
      {message ? (
        <p role="status" className="ok">
          {message}
        </p>
      ) : invalid ? (
        <p role="alert" className="err">
          Open the reset link from your email, or request a new one.
        </p>
      ) : (
        <form onSubmit={submit}>
          <div className="fields">
            {reset ? (
              <>
                <label className="wide">
                  New password
                  <input
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </label>
                <label className="wide">
                  Confirm new password
                  <input
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={15}
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </label>
              </>
            ) : (
              <label className="wide">
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={254}
                  required
                  disabled={busy}
                />
              </label>
            )}
          </div>
          {reset && (
            <p className="identity-note">
              Use 15 to 128 characters. This signs out other logins and agent connections.
            </p>
          )}
          <button className="btn pri start-button" disabled={busy}>
            {busy ? 'Please wait…' : reset ? 'Save new password' : 'Send reset instructions'}
          </button>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <p className="identity-note">
        <Link href="/signin">Back to log in</Link>
      </p>
      {reset && (invalid || error) && (
        <p>
          <Link href="/forgot-password">Request a new reset link</Link>
        </p>
      )}
    </AuthShell>
  );
}
