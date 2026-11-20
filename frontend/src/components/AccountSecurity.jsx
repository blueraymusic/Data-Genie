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