import { useState } from 'react';
import { Icon } from './Icon';
import { SqlBlock } from './SqlBlock';
import { HomeApproval } from './HomeApproval';
import { sampleCustomers, sampleStates, customerLookup } from '../data/homeSamples';

function LookupExample() {
  const [state, setState] = useState('Missouri');
  const query = customerLookup(state);
  return (
    <article className="example-card lookup-card" aria-labelledby="lookup-h">
      <div className="example-card-top">
        <span className="example-icon">
          <Icon name="search" />
        </span>
        <span>Look up</span>
      </div>
      <h3 id="lookup-h">Find your people.</h3>
      <p>Turn a question into the exact rows you need. Change the state and see it happen.</p>
      <div className="example-playground">
        <label htmlFor="example-state">
          Choose a state
          <select
            id="example-state"
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            {sampleStates.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div aria-live="polite">
          <p className="example-request">{query.request}</p>
          <SqlBlock home sql={query.sql} />
          <div className="example-people">
            {query.rows.map((row) => (
              <span key={row.name}>
                <Icon name="account" />
                {row.name}
              </span>
            ))}
          </div>
          <p className="example-result">
            <span className="chip st-executed">
              <Icon name="check" />
              executed
            </span>
            {query.rows.length} {query.rows.length === 1 ? 'row' : 'rows'}
          </p>
        </div>
      </div>
    </article>
  );
}
function SummaryExample() {
  const [metric, setMetric] = useState('count');
  const counts = sampleStates.map((state) => ({
    state,
    count: sampleCustomers.filter((row) => row.state === state).length,
  }));
  const sql =
    metric === 'count'
      ? 'SELECT state, COUNT(*) AS customers\nFROM customers\nGROUP BY state;'
      : 'SELECT state,\n  ROUND(COUNT(*) * 100.0 /\n    (SELECT COUNT(*) FROM customers), 1)\n  AS percentage\nFROM customers GROUP BY state;';
  return (
    <article className="example-card summary-card" aria-labelledby="summary-h">
      <div className="example-card-top">
        <span className="example-icon">
          <Icon name="layers" />
        </span>
        <span>Summarize</span>
      </div>
      <h3 id="summary-h">See the bigger picture.</h3>
      <p>Count, group and compare. Go from individual records to an answer you can use.</p>
      <div className="example-playground">
        <div className="summary-toggle" role="group" aria-label="Summary measure">
          <button
            type="button"
            aria-pressed={metric === 'count'}
            onClick={() => setMetric('count')}
          >
            Count
          </button>
          <button
            type="button"
            aria-pressed={metric === 'share'}
            onClick={() => setMetric('share')}
          >
            Percentage
          </button>
        </div>
        <div aria-live="polite">
          <p className="example-request">
            {metric === 'count'
              ? 'how many customers are in each state'
              : 'what percentage of customers is in each state'}
          </p>
          <SqlBlock home sql={sql} />
          <div
            className="example-bars"
            role="img"
            aria-label={counts
              .map(
                (row) =>
                  `${row.state}: ${metric === 'count' ? row.count + ' customers' : ((row.count / sampleCustomers.length) * 100).toFixed(1) + '%'}`,
              )
              .join(', ')}
          >
            {counts.map((row) => (
              <div className="example-bar" key={row.state} aria-hidden="true">
                <span>{row.state}</span>
                <i>
                  <b style={{ width: `${(row.count / 3) * 100}%` }} />
                </i>
                <strong>
                  {metric === 'count'
                    ? row.count
                    : ((row.count / sampleCustomers.length) * 100).toFixed(1) + '%'}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
export function HomeExamples() {
  return (
    <section className="home-section home-examples dark-surface" id="ask" aria-labelledby="ask-h">
      <div className="wrap">
        <div className="section-heading centered">
          <p className="eyebrow">What you can ask</p>
          <h2 id="ask-h">
            Your words in.
            <br />
            <em>SQL and rows</em> out.
          </h2>
          <p>
            Look things up, summarize, or make changes.
            <br />
            Every request shows its SQL.
          </p>
        </div>
        <div className="home-example-grid">
          <LookupExample />
          <SummaryExample />
          <article className="example-card change-card" aria-labelledby="change-h">
            <div className="example-card-top">
              <span className="example-icon">
                <Icon name="check" />
              </span>
              <span>Make changes</span>
            </div>
            <h3 id="change-h">Move things forward.</h3>
            <p>
              Add a record, update a detail or shape a table. Review the SQL and give it the
              go-ahead.
            </p>
            <div className="example-playground">
              <HomeApproval />
            </div>
          </article>
        </div>
        <p className="examples-disclaimer">
          Interactive examples · 6 sample customers · No connection to your database
        </p>
      </div>
    </section>
  );
}
