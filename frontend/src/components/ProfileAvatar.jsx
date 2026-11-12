import { useState } from 'react';

export function ProfileAvatar({ user, className = '' }) {
  const [failed, setFailed] = useState(null);
  const initials = [user.first_name, user.last_name]
    .filter(Boolean)
    .map((name) => name[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={'profile-avatar ' + className} aria-hidden="true">
      {user.profile_photo && failed !== user.profile_photo ? (
        <img src={user.profile_photo} alt="" onError={() => setFailed(user.profile_photo)} />
      ) : (
        initials
      )}
    </span>
  );
}
