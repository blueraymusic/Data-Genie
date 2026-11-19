import { GoogleMark, googleError } from './GoogleSignIn';
import { AccountPasswordForm } from './AccountPasswordForm';
import { Icon } from './Icon';
import { DeleteAccount } from './DeleteAccount';
import { Link } from '../lib/router';

export function AccountSecurity({
  user,
  passwordEnabled,
  busy,
  error,
  message,
  submit,
  linkedReturn,
  route,
}) {
  return (
    <>
      <header className="account-panel-heading">
        <h2>Sign-in &amp; security</h2>
        <p>Keep your account access in your hands.</p>
      </header>
      {passwordEnabled && (
        <AccountPasswordForm
          onSubmit={submit}
          busy={busy}
          error={error}
          message={message}
        />
      )}
      {(user.google_linked || !passwordEnabled) && (
        <section className="account-provider" aria-label="Google sign-in">
          <div className="account-provider-heading">
            <GoogleMark />
            <h3>Google account</h3>
            <span className="account-connected">
              <Icon name="check" />
              Connected
            </span>
          </div>
          <p className="google-account-note">Google account connected</p>
          <p className="account-setting-help">
            {passwordEnabled
              ? 'You can log in with Google or your Data Genie password.'
              : 'Your sign-in is managed by Google. Change your password in your Google account.'}
          </p>
          {linkedReturn && user.google_linked && (
            <p className="ok" role="status">
              Google sign-in is connected to your account.
            </p>
          )}
        </section>
      )}
      {googleError(route) && (
        <p className="err" role="alert">
          {googleError(route)}
        </p>
      )}
      <p className="account-session-note">
        <Icon name="clock" />
        Browser logins expire after 30 minutes of inactivity or 12 hours in total.
      </p>
      <section className="account-danger-row" aria-label="Transfer ownership">
        <div>
          <h3>Transfer ownership</h3>
          <p>Choose a workspace and send a request to another account.</p>
        </div>
        <Link className="btn quiet" href="/workspaces">
          Transfer ownership
        </Link>
      </section>
      <DeleteAccount user={user} />
    </>
  );
}