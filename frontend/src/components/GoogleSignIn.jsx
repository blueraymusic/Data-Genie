import { useEffect, useId, useState } from 'react';
import { api, rememberSession } from '../lib/api';
import '../styles/google-signin.css';

export function useGoogleSignIn() {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/providers', { signal: controller.signal })
      .then((data) => {
        const available = data.google?.enabled;
        if (!controller.signal.aborted && typeof available === 'boolean') setEnabled(available);
      })
      .catch(() => {
        // Provider discovery never prevents signing in with a Data Genie password.
      });
    return () => controller.abort();
  }, []);
  return enabled;
}

const errors = {
  unavailable:
    'Google sign-in is unavailable right now. Try again or use your Data Genie password.',
  cancelled: 'Google sign-in was cancelled. You can try again or use your Data Genie password.',
  invalid: 'Google sign-in could not be verified. Please start again.',
  profile_required:
    'Google did not provide the profile details needed to create your account. Use email sign-up instead.',
  account_exists:
    'Log in with your existing Data Genie password, then connect Google from Account & preferences.',
  already_linked: 'That Google account is already connected to another Data Genie account.',
  link_expired: 'The connection request expired. Confirm your Data Genie password and start again.',
  rate_limited: 'Too many sign-in attempts. Wait a few minutes before trying again.',
  email_not_allowed: 'Use a personal, work, or school email approved for this installation.',
};

export function googleError(route) {
  const code = new URLSearchParams(route.split('?')[1]?.split('#')[0] || '').get('google_error');
  return code
    ? Object.hasOwn(errors, code)
      ? errors[code]
      : 'Google sign-in could not be completed. Please try again.'
    : '';
}

export function GoogleMark() {
  return (
    <svg className="google-mark" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24.8v7.42h10.55a9.02 9.02 0 0 1-3.91 5.92v4.92h6.34c3.71-3.42 5.83-8.45 5.83-14.34Z"
      />
      <path
        fill="#34A853"
        d="M24.8 43.6c5.3 0 9.75-1.76 13-4.8l-6.34-4.92c-1.76 1.18-4 1.9-6.66 1.9-5.1 0-9.43-3.44-10.98-8.07H7.28v5.07A19.64 19.64 0 0 0 24.8 43.6Z"
      />
      <path
        fill="#FBBC05"
        d="M13.82 27.71A11.84 11.84 0 0 1 13.2 24c0-1.29.22-2.54.62-3.71v-5.07H7.28A19.64 19.64 0 0 0 5.2 24c0 3.16.76 6.14 2.08 8.78l6.54-5.07Z"
      />
      <path
        fill="#EA4335"
        d="M24.8 12.22c2.9 0 5.5 1 7.55 2.95l5.66-5.66C34.59 6.35 30.14 4.4 24.8 4.4a19.64 19.64 0 0 0-17.52 10.82l6.54 5.07c1.55-4.63 5.88-8.07 10.98-8.07Z"
      />
    </svg>
  );
}

export function GoogleSignIn({ disabled = false, signup = false, previewUnavailable = false }) {
  const noteId = useId();
  const content = (
    <>
      <GoogleMark />
      {signup ? 'Sign up with Google' : 'Continue with Google'}
    </>
  );
  return (
    <div className="google-entry">
      {previewUnavailable ? (
        <>
          <button className="btn google-button" type="button" disabled aria-describedby={noteId}>
            {content}
          </button>
          <p className="google-preview-note" id={noteId}>
            Google sign-up isn’t configured in this preview.{' '}
            <a href="https://data-genie.space/signup">Open live sign-up</a>
          </p>
        </>
      ) : (
        <a
          className="btn google-button"
          href="/api/auth/google/start"
          aria-disabled={disabled || undefined}
          onClick={(event) => {
            if (disabled) event.preventDefault();
            else rememberSession(null);
          }}
        >
          {content}
        </a>
      )}
      <p className="auth-divider">
        <span>or use your email</span>
      </p>
    </div>
  );
}
