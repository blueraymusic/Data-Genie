import { useEffect, useState } from 'react';
import { api, rememberSession } from '../lib/api';
import '../styles/microsoft-signin.css';

export function useMicrosoftSignIn() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/providers', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setEnabled(data.microsoft?.enabled === true);
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
    'Microsoft sign-in is unavailable right now. Try again or use your Data Genie password.',
  cancelled: 'Microsoft sign-in was cancelled. You can try again or use your Data Genie password.',
  invalid: 'Microsoft sign-in could not be verified. Please start again.',
  profile_required:
    'Microsoft did not provide the profile details needed to create your account. Use email sign-up instead.',
  account_exists:
    'Log in with your existing Data Genie password, then connect Microsoft from Account & preferences.',
  already_linked: 'That Microsoft account is already connected to another Data Genie account.',
  link_expired: 'The connection request expired. Confirm your Data Genie password and start again.',
  rate_limited: 'Too many sign-in attempts. Wait a few minutes before trying again.',
};

export function microsoftError(route) {
  const code = new URLSearchParams(route.split('?')[1]?.split('#')[0] || '').get('microsoft_error');
  return code
    ? Object.hasOwn(errors, code)
      ? errors[code]
      : 'Microsoft sign-in could not be completed. Please try again.'
    : '';
}

export function MicrosoftMark() {
  return (
    <svg className="microsoft-mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="#f25022" d="M0 0h9v9H0z" />
      <path fill="#7fba00" d="M11 0h9v9h-9z" />
      <path fill="#00a4ef" d="M0 11h9v9H0z" />
      <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

export function MicrosoftSignIn({ disabled = false }) {
  return (
    <div className="microsoft-entry">
      <a
        className="btn microsoft-button"
        href="/api/auth/microsoft/start"
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          else rememberSession(null);
        }}
      >
        <MicrosoftMark />
        Continue with Microsoft
      </a>
      <p className="auth-divider">
        <span>or use your email</span>
      </p>
    </div>
  );
}
