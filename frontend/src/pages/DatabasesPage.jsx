import { useState } from 'react';
import { DatabaseForm } from '../components/DatabaseForm';
import { SavedDatabases } from '../components/SavedDatabases';
import { Link } from '../lib/router';
import { databaseAccess } from '../lib/access';
export default function DatabasesPage({ workbench, onOpened }) {
  const [formVersion, setFormVersion] = useState(0);
  const access = databaseAccess(workbench.session);
  const destination = access.role === 'owner' ? access.workspaceName : 'Personal workspace';
  return (
    <section className="database-page">
      <header className="database-page-heading">
        <h1>Your databases</h1>
        <p className="small muted">
          Looking for a shared database? <Link href="/workspaces">Open team workspaces</Link>.
        </p>
        <div role="note" aria-label="Current database">
          <p className="lead">
            You’re using <strong>{workbench.session.database}</strong>.
          </p>
          <p className="small muted">
            New databases are added to <strong>{destination}</strong>. Your saved conversations stay
            private.
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
