import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
export default function AccountPage({ workbench, mode, setMode }) {
  const { user, changePassword } = useAuth(),
    { theme, toggle } = useTheme();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setMessage('');
    setError('');
    if (values.new_password !== values.confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      setMessage(await changePassword(values));
      form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>Account &amp; preferences</h1>
      <p className="lead">Your account, your appearance, your copy of the data.</p>
      <div className="account-ledger">
        <p>
          <span>Name</span>
          <strong>
            {user.first_name} {user.last_name}
          </strong>
        </p>
        <p>
          <span>Email</span>
          <strong>{user.email}</strong>
        </p>
        <p>
          <span>Appearance</span>
          <button className="btn" onClick={toggle}>
            Change theme · {theme}
          </button>
        </p>
        <p>
          <span>Request interpretation</span>
          <label className="sr-only" htmlFor="requestMode">
            Request interpretation
          </label>
          <select id="requestMode" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="gemini" disabled={!workbench.session.ai?.enabled}>
              Gemini AI
            </option>
            <option value="keywords">Keywords</option>
          </select>
        </p>
        <p>
          <span>Database copy</span>
          <a
            className="btn"
            href={'/api/download?session_id=' + encodeURIComponent(workbench.session.session_id)}
            download
          >
            Download SQLite file
          </a>
        </p>
      </div>
      <form className="password-form" onSubmit={submit}>
        <h2>Change password</h2>
        <label>
          Current password
          <input
            name="current_password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </label>
        <label>
          New password
          <input
            name="new_password"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            aria-describedby="newPasswordHelp"
          />
        </label>
        <p className="small muted" id="newPasswordHelp">
          Use 15 to 128 characters. A long, unique passphrase works well.
        </p>
        <label>
          Confirm new password
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
        <p className={error ? 'err' : 'ok'} role="status">
          {error || message}
        </p>
      </form>
      <p className="small muted">
        Accounts and history are stored locally. Changing your password signs out other browser
        logins.
      </p>
    </section>
  );
}
