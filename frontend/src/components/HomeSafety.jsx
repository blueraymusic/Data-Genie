import { HomeApproval } from './HomeApproval';
import { Icon } from './Icon';

const change = {
  request: 'delete sales from before 2024',
  sql: "DELETE FROM sales\nWHERE sale_date < '2024-01-01';",
  operation: 'DELETE',
  description: 'This will delete 3 rows from sales. Deleted rows can’t be restored.',
};
export function HomeSafety() {
  return (
    <section className="home-section home-safety" id="safety" aria-labelledby="safe-h">
      <div className="wrap safety-layout">
        <div className="section-heading">
          <p className="eyebrow">Safe by default</p>
          <h2 id="safe-h">
            Nothing changes
            <br />
            until you <em>say so.</em>
          </h2>
          <p>Reads run straight away. Changes show the SQL for review and wait for your OK.</p>
          <ul className="safety-points">
            <li>
              <Icon name="check" />
              <span>PostgreSQL connections start read-only.</span>
            </li>
            <li>
              <Icon name="check" />
              <span>Confirmed edits apply directly to your database.</span>
            </li>
            <li>
              <Icon name="check" />
              <span>Dropping a table also asks you to type its name.</span>
            </li>
            <li>
              <Icon name="check" />
              <span>Approved and declined requests stay in History.</span>
            </li>
          </ul>
        </div>
        <div className="safety-card">
          <HomeApproval
            change={change}
            approveLabel="Delete 3 rows"
            approvedText="Sample result: 3 rows deleted from sales."
          />
        </div>
      </div>
    </section>
  );
}
