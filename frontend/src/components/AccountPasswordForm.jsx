import { useState } from 'react';
import { Icon } from './Icon';

export function AccountPasswordForm({ onSubmit, busy, error, message }) {
  const [show, setShow] = useState(false);
  return (
    <form className="account-password-form" aria-label="Change password" onSubmit={onSubmit}>
      <div className="account-form-title">
        <h3>Change password</h3>
        <button
          className="account-text-button"
          type="button"
          aria-pressed={show}
          onClick={() => setShow((value) => !value)}
        >
          {show ? 'Hide passwords' : 'Show passwords'}
        </button>
      </div>
      <div className="account-password-fields">
        {[
          { name: 'current_password', label: 'Current password', autocomplete: 'current-password' },
          { name: 'new_password', label: 'New password', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Confirm new password', autocomplete: 'new-password' },
        ].map((field) => (
          <label key={field.name}>
            {field.label}
            <input
              name={field.name}
              type={show ? 'text' : 'password'}
              autoComplete={field.autocomplete}
              minLength={field.name === 'current_password' ? undefined : 15}
              maxLength={128}
              required
              aria-describedby={field.name === 'current_password' ? undefined : 'newPasswordHelp'}
            />
          </label>
        ))}
      </div>
      <p className="account-setting-help" id="newPasswordHelp">
        Use 15–128 characters. A long, unique passphrase works well.
      </p>
      <div className="account-password-footer">
        <p>
          <Icon name="lock" />
          Updating your password signs out other browser sessions and revokes agent access.
        </p>
        <button className="btn pri" disabled={busy}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
      </div>
      {(error || message) && (
        <p className={error ? 'err' : 'ok'} role={error ? 'alert' : 'status'}>
          {error || message}
        </p>
      )}
    </form>
  );
}
