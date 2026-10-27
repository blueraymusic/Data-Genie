import { useState } from 'react';
import { SqlBlock } from './SqlBlock';
import { Icon } from './Icon';
export function HomeSafety() {
  const [decision, setDecision] = useState(null);
  const sql = "DELETE FROM sales\nWHERE sale_date < '2024-01-01';";
  return (
    <section className="band" id="safety" aria-labelledby="safe-h">
      <div className="wrap">
        <h2 id="safe-h">Safe by default</h2>
        <div className="safe-copy">
          <p>
            Reads run straight away. Anything that deletes rows or drops a table stops first, shows
            the SQL, says exactly how many rows it will touch, and waits for you.
          </p>
          <p>
            Dropping a table also asks you to type its name. If you say no, the request stays in
            your history and never runs.
          </p>
        </div>
        <div className="safe-grid">
          <div className="ex">
            <p className="state">
              <span className="chip st-pending">
                <Icon name="clock" />
                pending
              </span>{' '}
              Waiting for your answer
            </p>
            <div className="mini">
              <p className="req">delete sales from before 2024</p>
              <SqlBlock home sql={sql} operation="DELETE" />
            </div>
            <div className="confirm" id="safety-demo">
              {decision ? (
                <>
                  <p className="t">
                    {decision === 'declined'
                      ? 'Not run. You declined this.'
                      : 'Sample result: 3 rows deleted from sales.'}
                  </p>
                  <p className="s">
                    This is an interactive example. Your data has not been changed.
                  </p>
                  <button className="btn btn-secondary" onClick={() => setDecision(null)}>
                    Try the confirmation again
                  </button>
                </>
              ) : (
                <>
                  <p className="s">Sample confirmation. No database is changed here.</p>
                  <p className="t">This will delete 3 rows from sales.</p>
                  <p className="s">
                    Deletes every sale dated before January 1, 2024. Deleted rows can’t be restored.
                  </p>
                  <div className="row">
                    <button className="btn btn-danger" onClick={() => setDecision('executed')}>
                      Delete 3 rows
                    </button>
                    <button className="btn btn-secondary" onClick={() => setDecision('declined')}>
                      Don’t run
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="ex declined">
            <p className="state">
              <span className="chip st-declined">
                <Icon name="x" />
                declined
              </span>{' '}
              Same request, after you say no
            </p>
            <div className="mini">
              <p className="req">delete sales from before 2024</p>
              <SqlBlock home sql={sql} operation="DELETE" declined />
            </div>
            <p className="notrun">Not run. You declined this.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
