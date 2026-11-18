import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Link } from '../lib/router';

export function VerifySignup({ initial, onVerified, onRestart, showHeading = true }) {
  const { authenticate } = useAuth();
  const [challenge, setChallenge] = useState(initial),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [signInMessage, setSignInMessage] = useState(''),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil(challenge.expires_at - now / 1000));
  const resendWait = Math.max(0, remaining - 240);
  async function verify(event) {
    event.preventDefault();
    if (busy || !remaining) return;
    setBusy(true);
    setError('');
    try {
      const result = await authenticate('verify-email', { challenge: challenge.challenge, code });
      if (result?.sign_in_required) {
        setSignInMessage(result.message);
        setBusy(false);
        return;
      }
      onVerified();
    } catch (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  async function resend() {
    if (busy || resendWait) return;
    setBusy(true);
    setError('');
    try {
      setChallenge(
        await api('/api/auth/verification/resend', {
          method: 'POST',
          body: { challenge: challenge.challenge },
        }),
      );
      setCode('');
      setNow(Date.now());
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (signInMessage)
    return (
      <section aria-label="Email verified">
        <h2>Your email is verified.</h2>
        <p role="status">{signInMessage}</p>
        <div className="account-profile-actions">
          <Link className="btn pri" href="/signin">
            Log in
          </Link>
          <Link className="btn sec" href="/forgot-password">
            Reset password
          </Link>
        </div>
      </section>
    );
  return (
    <form className="auth-verification" onSubmit={verify}>
      {showHeading && <h2>Check your email.</h2>}
      <p>
        Enter the code sent to <strong>{challenge.email}</strong>.
      </p>
      <p className="small muted">
        Already have an account? This check will guide you to login or password reset.
      </p>
      <label>
        Verification code
        <input
          autoFocus
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          required
          disabled={busy || !remaining}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <p className="identity-note">
        {remaining
          ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · 3 attempts maximum.`
          : 'This code expired. Start again to request a new one.'}
      </p>
      <button className="btn pri start-button" disabled={busy || !remaining || code.length !== 6}>
        {busy ? 'Checking…' : 'Verify and create account'}
      </button>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="account-profile-actions">
        <button
          className="text-button"
          type="button"
          disabled={busy || !!resendWait || !remaining}
          onClick={resend}
        >
          {resendWait ? `Resend in ${resendWait}s` : 'Send a new code'}
        </button>
        <button className="text-button" type="button" disabled={busy} onClick={onRestart}>
          Use different details
        </button>
      </div>
    </form>
  );
}
