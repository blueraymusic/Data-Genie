import { DatabaseForm } from '../components/DatabaseForm';
export default function DatabasesPage({ workbench, onOpened }) {
  return (
    <section>
      <h1>Your databases</h1>
      <p className="lead">
        Currently connected to <strong>{workbench.session.database}</strong>. Opening another
        database starts a new session. Your earlier history stays saved.
      </p>
      <div className="connection-options">
        <div>
          <DatabaseForm
            busy={workbench.busy || workbench.pending}
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
