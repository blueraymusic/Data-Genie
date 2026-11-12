import { MicrosoftMark, microsoftError } from './MicrosoftSignIn';
import { AccountPasswordForm } from './AccountPasswordForm';
import { Icon } from './Icon';
import { DeleteAccount } from './DeleteAccount';
import { Link } from '../lib/router';

export function AccountSecurity({
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
          busy={busy || linkBusy}
          error={error}
          message={message}
        />
      )}
      {(user.microsoft_linked || !passwordEnabled) && (
        <section className="account-provider" aria-label="Microsoft sign-in">
          <div className="account-provider-heading">
            <MicrosoftMark />
            <h3>Microsoft account</h3>
            <span className="account-connected">
              <Icon name="check" />
              Connected
            </span>
          </div>
          <p className="microsoft-account-note">Microsoft account connected</p>
          <p className="account-setting-help">
            {passwordEnabled
              ? 'You can log in with Microsoft or your Data Genie password.'
              : 'Your sign-in is managed by Microsoft. Change your password in your Microsoft account.'}
          </p>
          {linkedReturn && user.microsoft_linked && (
            <p className="ok" role="status">
              Microsoft sign-in is connected to your account.
            </p>
          )}
        </section>
      )}
      {microsoftEnabled && passwordEnabled && !user.microsoft_linked && (
        <form
          className="account-provider account-provider-form"
          aria-label="Connect Microsoft account"
          onSubmit={connectMicrosoft}
        >
          <div className="account-provider-heading">
            <MicrosoftMark />
            <h3>Connect Microsoft</h3>
          </div>
          <p className="account-setting-help">
            Add another way to log in. Confirm your current password to connect your Microsoft
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
          {linkError && (
            <p className="err" role="alert">
              {linkError}
            </p>
          )}
        </form>
      )}
      {microsoftError(route) && (
        <p className="err" role="alert">
          {microsoftError(route)}
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
