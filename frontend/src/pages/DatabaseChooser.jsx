import { useEffect, useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { DatabaseForm } from '../components/DatabaseForm';
import { useAuth } from '../context/AuthContext';
import { api, formatTime } from '../lib/api';
import { useRouter } from '../lib/router';
export default function DatabaseChooser({ workbench }) {
  const { user, logout } = useAuth(),
    { navigate } = useRouter();
  const [saved, setSaved] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    document.title = 'Databases | Data Genie';
    const controller = new AbortController();
    api('/api/sessions', { signal: controller.signal })
      .then((data) => {
        const seen = new Set();
        setSaved(
          data.sessions.filter((item) => !seen.has(item.database_id) && seen.add(item.database_id)),
        );
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    return () => controller.abort();
  }, [user.account_id]);
  async function open(payload, id) {
    await workbench.open(payload, id);
    navigate('/app', true);
  }
  return (
    <AuthShell
      title="Choose your database."
      lead="Reopen your work, start fresh, or explore a sample."
    >
      <p className="identity-note account-gate">
        <span>
          {user.first_name} {user.last_name} · {user.email}
        </span>
        <button
          className="text-button"
          type="button"
          onClick={() => logout().catch((error) => setError(error.message))}
        >
          Log out
        </button>
      </p>
      {saved.length > 0 && (
        <section className="saved-databases">
          <h2>Your saved databases</h2>
          {saved.map((item) => (
            <button
              className="saved-database"
              key={item.database_id}
              disabled={workbench.busy}
              onClick={() => open({}, item.session_id).catch((error) => setError(error.message))}
            >
              <span>
                {item.database}
                <small>Last opened {formatTime(item.started_at)}</small>
              </span>
              <b>Open →</b>
            </button>
          ))}
        </section>
      )}
      <DatabaseForm onOpen={open} busy={workbench.busy} />
      <p className="err" role="status">
        {error || workbench.message}
      </p>
    </AuthShell>
  );
}
