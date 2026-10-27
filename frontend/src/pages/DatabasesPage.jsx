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
            Choose Upload SQLite to open an existing file, or start an empty database of your own.
          </p>
          <p className="small muted">
            Up to 25 MB. You work on a copy; download it to keep your changes.
          </p>
        </div>
      </div>
    </section>
  );
}
