import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRouter, Link } from '../lib/router';
import { AuthShell } from '../components/AuthShell';
import { Icon } from '../components/Icon';
import { GoogleSignIn, googleError, useGoogleSignIn } from '../components/GoogleSignIn';
import { readWorkspaceInvitation } from '../lib/workspaceInvites';
import { VerifySignup } from '../components/VerifySignup';

const emptyDetails = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  confirmPassword: '',
};
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export default function AuthPage() {
  const { pathname, route, navigate } = useRouter(),
    { authenticate, refresh, error: authError, connectionError } = useAuth();
  const googleEnabled = useGoogleSignIn();
  const signup = pathname === '/signup';
  const googlePreviewUnavailable =
    signup && googleEnabled === false && loopbackHosts.has(window.location.hostname);
  const [verification, setVerification] = useState(null),
    [step, setStep] = useState(0),
    [details, setDetails] = useState(emptyDetails),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [retrying, setRetrying] = useState(false),
    [error, setError] = useState('');
  const firstField = useRef(null),
    passwordField = useRef(null),
    previousStep = useRef(0);
  useEffect(() => {
    document.title = (signup ? 'Sign up' : 'Log in') + ' | Data Genie';
    setError('');
    setShow(false);
    setVerification(null);
    setStep(0);
    setDetails(emptyDetails);
  }, [signup]);
  useEffect(() => {
    if (previousStep.current !== step) {
      (step ? passwordField : firstField).current?.focus({ preventScroll: true });
      previousStep.current = step;
    }
  }, [step]);
  function change(event) {
    const { name, value } = event.target;
    setDetails((current) => ({ ...current, [name]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || retrying) return;
    setError('');
    if (signup && !step) {
      setStep(1);
      return;
    }
    if (
      signup &&
      (!details.first_name.trim() || !details.last_name.trim() || !details.email.trim())
    ) {
      setStep(0);
      setError('Enter your name and email before continuing.');
      return;
    }
    if (signup && details.password !== details.confirmPassword) {
      setError('The passwords do not match.');
      event.currentTarget.elements.confirmPassword.focus({ preventScroll: true });
      return;
    }
    const values = signup ? details : { email: details.email, password: details.password };
    setBusy(true);
    try {
      const result = await authenticate(signup ? 'register' : 'login', values);
      if (result?.verification_required) {
        setVerification(result);
        setDetails(emptyDetails);
        return;
      }
      setDetails(emptyDetails);
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
      /* AuthProvider retains the latest read failure. */
    } finally {
      setRetrying(false);
    }
  }
  const checking = !!verification && signup;
  const feedback = error || authError || googleError(route);
  return (
    <AuthShell
      variant={signup ? 'signup' : 'signin'}
      title={checking ? 'Check your email.' : signup ? 'Create your account.' : 'Welcome back.'}
      lead={signup ? null : 'Log in to access your databases, reports, and query history.'}
      eyebrow={
        signup && !checking
          ? `Step ${step + 1} of 2 · ${step ? 'Secure your account' : 'Your details'}`
          : checking
            ? 'Verify your email'
            : undefined
      }
      headerAction={
        <Link href={signup ? '/signin' : '/signup'}>{signup ? 'Log in' : 'Sign up'}</Link>
      }
    >
      {new URLSearchParams(route.split('?')[1] || '').get('account') === 'deleted' && (
        <p className="ok" role="status">
          Your Data Genie account has been deleted.
        </p>
      )}
      {checking ? (
        <VerifySignup
          initial={verification}
          showHeading={false}
          onRestart={() => {
            setVerification(null);
            setStep(0);
          }}
          onVerified={() =>
            navigate(readWorkspaceInvitation() ? '/workspaces' : '/databases', true)
          }
        />
      ) : (
        <>
          {(googleEnabled || googlePreviewUnavailable) && (!signup || !step) && (
            <GoogleSignIn
              signup={signup}
              disabled={busy || retrying}
              previewUnavailable={googlePreviewUnavailable}
            />
          )}
          <form className="auth-form" key={signup ? 'signup' : 'login'} onSubmit={submit}>
            <fieldset
              className="fields auth-details"
              hidden={signup && step !== 0}
              disabled={busy || retrying || (signup && step !== 0)}
            >
              <legend className="sr-only">{signup ? 'Your details' : 'Log in with email'}</legend>
              {signup && (
                <>
                  <label>
                    First name
                    <input
                      ref={firstField}
                      name="first_name"
                      autoComplete="given-name"
                      maxLength={100}
                      value={details.first_name}
                      onChange={change}
                      required
                    />
                  </label>
                  <label>
                    Last name
                    <input
                      name="last_name"
                      autoComplete="family-name"
                      maxLength={100}
                      value={details.last_name}
                      onChange={change}
                      required
                    />
                  </label>
                </>
              )}
              <label className="wide">
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={254}
                  value={details.email}
                  onChange={change}
                  required
                />
              </label>
            </fieldset>
            <fieldset
              className="fields auth-passwords"
              hidden={signup && step !== 1}
              disabled={busy || retrying || (signup && step !== 1)}
            >
              <legend className="sr-only">
                {signup ? 'Secure your account' : 'Your password'}
              </legend>
              <div className="wide">
                <div className="auth-label-row">
                  <label htmlFor="authPassword">Password</label>
                  {!signup && <Link href="/forgot-password">Forgot password?</Link>}
                </div>
                <div className="password-input">
                  <input
                    ref={passwordField}
                    id="authPassword"
                    name="password"
                    type={show ? 'text' : 'password'}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    minLength={signup ? 15 : 1}
                    maxLength={128}
                    aria-describedby={signup ? 'passwordHelp' : undefined}
                    value={details.password}
                    onChange={change}
                    required
                  />
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
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
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={128}
                    value={details.confirmPassword}
                    onChange={change}
                    required
                  />
                </label>
              )}
            </fieldset>
            {signup && step === 1 && (
              <p className="identity-note" id="passwordHelp">
                15–128 characters. A unique passphrase works well.
              </p>
            )}
            <div className="auth-form-actions">
              {signup && step === 1 && (
                <button
                  className="btn sec auth-back"
                  type="button"
                  disabled={busy || retrying}
                  onClick={() => {
                    setError('');
                    setStep(0);
                  }}
                >
                  Back
                </button>
              )}
              <button className="btn pri start-button" disabled={busy || retrying}>
                {busy
                  ? signup
                    ? 'Creating your account…'
                    : 'Logging in…'
                  : signup
                    ? step
                      ? 'Create account'
                      : 'Continue'
                    : 'Log in'}
                <Icon name="arrow" />
              </button>
            </div>
          </form>
        </>
      )}
      {feedback && (
        <div className="auth-feedback">
          <p className="err" role="alert">
            {feedback}
          </p>
          {connectionError && (
            <button
              className="text-button"
              type="button"
              onClick={retryConnection}
              disabled={busy || retrying}
            >
              {retrying ? 'Checking connection…' : 'Retry connection'}
            </button>
          )}
        </div>
      )}
    </AuthShell>
  );
}
