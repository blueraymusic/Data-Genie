import { useState } from 'react';
import { DatabaseForm } from '../components/DatabaseForm';
import { SavedDatabases } from '../components/SavedDatabases';
export default function DatabasesPage({ workbench, onOpened }) {
  const [formVersion, setFormVersion] = useState(0);
  return (
    <section>
      <h1>Your databases</h1>
      <div role="note" aria-label="Current database">
        <p className="lead">
          Currently connected to <strong>{workbench.session.database}</strong>. Opening another
          database starts a new session. Your earlier history stays saved.
        </p>
      </div>
      <SavedDatabases
        workbench={workbench}
        onOpened={onOpened}
        onReconnect={() => setFormVersion((value) => value + 1)}
      />
      <div className="connection-options">
        <div>
          <DatabaseForm
            key={formVersion}
            initialMode={formVersion ? 'postgresql' : 'create'}
            busy={workbench.busy || workbench.pending || workbench.workingCommands.size > 0}
            onOpen={async (payload) => {
              await workbench.open(payload);
              onOpened();
            }}
          />
        </div>
        <div className="drop">
          <h2>Bring your data</h2>
          <p>
            Upload a SQLite file, start a local database, or connect a live PostgreSQL database.
          </p>
          <p className="small muted">
            SQLite uploads use a copy you can download. PostgreSQL works on your connected database;
            enable changes only when you want to confirm edits there.
          </p>
        </div>
      </div>
    </section>
  );
}
