import { Translation } from '../components/CommandResult';
import { quoteIdentifier } from '../lib/api';
export default function SqlPage({ workbench, selected, draft, setDraft, onNewTable }) {
  return (
    <section>
      <h1>Review SQL</h1>
      <p className="lead">Every statement and result is saved. Changes need your OK.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) workbench.submit(draft, true);
        }}
      >
        <textarea
          className="sqlbox"
          rows="6"
          aria-label="SQL statement"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={workbench.busy || workbench.pending}
        />
        <div className="sql-actions">
          <button
            className="btn pri"
            disabled={workbench.busy || workbench.pending || !draft.trim()}
          >
            Review statement
          </button>
          {selected && (
            <>
              <button
                className="btn"
                type="button"
                onClick={() => setDraft(`SELECT * FROM ${quoteIdentifier(selected)} LIMIT 50`)}
              >
                Preview rows
              </button>
              <button
                className="btn"
                type="button"
                onClick={() =>
                  setDraft(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(selected)}`)
                }
              >
                Count rows
              </button>
            </>
          )}
          <button
            className="btn"
            type="button"
            disabled={workbench.busy || workbench.pending || workbench.session.read_only}
            onClick={onNewTable}
          >
            Create a table
          </button>
        </div>
      </form>
      <p className="small muted">
        {selected
          ? 'Selected table: ' + selected
          : 'This database is empty. Create your first table to begin.'}
      </p>
      <div aria-live="polite">
        {workbench.feed.slice(-10).map((request) => (
          <Translation key={request.request_id} request={request} workbench={workbench} />
        ))}
      </div>
    </section>
  );
}
