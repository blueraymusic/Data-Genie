import { useEffect, useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { DatabaseForm } from '../components/DatabaseForm';
import { SavedDatabases } from '../components/SavedDatabases';
import { useAuth } from '../context/AuthContext';
import { useRouter, Link } from '../lib/router';
export default function DatabaseChooser({ workbench }) {
  const { user, logout } = useAuth(),
    { navigate } = useRouter();
  const [formVersion, setFormVersion] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    document.title = 'Databases | Data Genie';
  }, []);
  async function open(payload, id) {
    await workbench.open(payload, id);
    navigate('/app', true);
  }
  return (
    <AuthShell
      variant="databases"
      title="Choose your database."
      lead="Reopen your work, start fresh, or explore a sample."
    >
      <p className="identity-note account-gate">
        <span>
          {user.first_name} {user.last_name} · {user.email}
        </span>
        <span className="gate-account-actions">
          <Link href="/history">History</Link>
          <Link href="/account">Account</Link>
          <button
            className="text-button"
            type="button"
            onClick={() => logout().catch((error) => setError(error.message))}
          >
            Log out
          </button>
        </span>
      </p>
      <SavedDatabases
        workbench={workbench}
        onOpened={() => navigate('/app', true)}
        onReconnect={() => setFormVersion((value) => value + 1)}
      />
      <DatabaseForm
        key={formVersion}
        initialMode={formVersion ? 'postgresql' : 'create'}
        onOpen={open}
        busy={workbench.busy}
      />
      <p className="err" role="status">
        {error || workbench.message}
      </p>
    </AuthShell>
  );
}
