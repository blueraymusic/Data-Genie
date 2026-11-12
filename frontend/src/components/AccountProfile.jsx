import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { prepareProfilePhoto } from '../lib/profilePhoto';
import { ProfileAvatar } from './ProfileAvatar';
import { Icon } from './Icon';

export function AccountProfile({ user }) {
  const { updateProfile } = useAuth();
  const created = Number.isFinite(user.created_at)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
        new Date(user.created_at * 1000),
      )
    : 'Not available';
  const signIn =
    [user.password_enabled !== false && 'Password', user.microsoft_linked && 'Microsoft']
      .filter(Boolean)
      .join(' · ') || 'Not available';
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const picker = useRef(null),
    editButton = useRef(null),
    wasEditing = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!editing && wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function edit() {
    setDraft({
      first_name: user.first_name,
      last_name: user.last_name,
      profile_photo: user.profile_photo || null,
    });
    setError('');
    setMessage('');
    setEditing(true);
  }
  function cancel() {
    generation.current++;
    setEditing(false);
    setDraft(null);
    setProcessing(false);
    setError('');
  }
  async function photo(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++generation.current;
    setProcessing(true);
    setError('');
    try {
      const prepared = await prepareProfilePhoto(file);
      if (generation.current === revision)
        setDraft((current) => ({ ...current, profile_photo: prepared }));
    } catch (error) {
      if (generation.current === revision) setError(error.message);
    } finally {
      if (generation.current === revision) setProcessing(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (busy || processing) return;
    setBusy(true);
    setError('');
    try {
      await updateProfile(draft);
      setEditing(false);
      setDraft(null);
      setMessage('Profile updated.');
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={'account-profile' + (editing ? ' is-editing' : '')}
      aria-label="Account details"
    >
      {editing ? (
        <form onSubmit={save} className="account-profile-form" aria-label="Edit profile">
          <div className="account-photo-editor">
            <ProfileAvatar user={draft} className="account-avatar" />
            <div>
              <div className="account-photo-actions">
                <input
                  ref={picker}
                  className="account-photo-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Profile photo"
                  onChange={photo}
                  disabled={busy || processing}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() => picker.current.click()}
                  disabled={busy || processing}
                >
                  <Icon name="upload" />
                  {processing ? 'Preparing photo…' : 'Choose photo'}
                </button>
                {draft.profile_photo && (
                  <button
                    className="account-text-button"
                    type="button"
                    disabled={busy || processing}
                    onClick={() => setDraft((current) => ({ ...current, profile_photo: null }))}
                  >
                    Remove photo
                  </button>
                )}
              </div>
              <p className="account-setting-help">
                PNG, JPEG or WebP · Up to 5 MB. No photo? We’ll use your initials.
              </p>
            </div>
          </div>
          <div className="account-profile-fields">
            {[
              ['first_name', 'First name'],
              ['last_name', 'Last name'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  name={key}
                  autoComplete={key === 'first_name' ? 'given-name' : 'family-name'}
                  required={key === 'first_name'}
                  maxLength={100}
                  value={draft[key]}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="account-setting-help">{user.email} · Used for sign-in and invitations.</p>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <div className="account-profile-actions">
            <button className="btn" type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="btn pri" disabled={busy || processing}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <ProfileAvatar user={user} className="account-avatar" />
          <dl>
            <div>
              <dt>Name</dt>
              <dd>
                {user.first_name} {user.last_name}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Account created</dt>
              <dd>{created}</dd>
            </div>
            <div>
              <dt>Sign-in methods</dt>
              <dd>{signIn}</dd>
            </div>
          </dl>
          <button
            ref={editButton}
            className="account-text-button account-profile-edit"
            onClick={edit}
          >
            Edit profile
          </button>
        </>
      )}
      {!editing && message && (
        <p className="account-profile-notice ok" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
