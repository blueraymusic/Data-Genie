import { useState } from 'react';
import { DatabaseForm } from '../components/DatabaseForm';
import { SavedDatabases } from '../components/SavedDatabases';
export default function DatabasesPage({ workbench, onOpened }) {
  const [formVersion, setFormVersion] = useState(0);
  return (
    <section className="database-page">
      <header className="database-page-heading">
        <h1>Your databases</h1>
        <div role="note" aria-label="Current database">
          <p className="lead">
            You’re using <strong>{workbench.session.database}</strong>.
          </p>
          <p className="small muted">
            Open another database to start a new session. Your history stays saved.
          </p>
        </div>
      </header>
      <div className="database-entry-layout">
        <SavedDatabases
          workbench={workbench}
          onOpened={onOpened}
          onReconnect={() => setFormVersion((value) => value + 1)}
        />
        <DatabaseForm
          key={formVersion}
          initialMode={formVersion ? 'postgresql' : 'create'}
          busy={workbench.busy || workbench.pending || workbench.workingCommands.size > 0}
          onOpen={async (payload) => {
            const data = await workbench.open(payload);
            onOpened(data);
          }}
        />
      </div>
    </section>
  );
}
