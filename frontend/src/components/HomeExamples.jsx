import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { SqlBlock } from './SqlBlock';
import { HomeApproval } from './HomeApproval';
import { useReducedMotion } from '../hooks/useMotion';
import { sampleCustomers, sampleStates, customerLookup, sampleUpdate } from '../data/homeSamples';

function LookupExample() {
  const [state, setState] = useState('Missouri');
  const query = customerLookup(state);
  return (
    <article className="compact-example" aria-labelledby="lookup-h">
      <div className="example-input">
        <div className="example-stat">
          <strong>{query.rows.length}</strong>
          <span>
            {query.rows.length === 1 ? 'matching customer' : 'matching customers'} in {state}
          </span>
        </div>
        <h3 id="lookup-h">Find your people.</h3>
        <p>Find the records you need, in your own words.</p>
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
        <p className="demo-label">Your request</p>
        <p className="example-request">{query.request}</p>
      </div>
      <div className="example-output dark-surface" aria-live="polite">
        <div className="example-output-heading">
          <p className="demo-label">SQL translation</p>
          <span className="chip st-executed">
            <Icon name="check" />
            {query.rows.length} {query.rows.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
        <SqlBlock home sql={query.sql} />
        <div className="example-people" aria-label="Matching customers">
          {query.rows.map((row) => (
            <span key={row.name}>
              <Icon name="account" />
              {row.name}
            </span>
          ))}
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
    <article className="compact-example" aria-labelledby="summary-h">
      <div className="example-input">
        <div className="example-stat">
          <strong>4</strong>
          <span>states, one clear overview</span>
        </div>
        <h3 id="summary-h">See the bigger picture.</h3>
        <p>Turn individual records into a useful overview.</p>
        <div className="summary-toggle" role="group" aria-label="Summary measure">
          {[
            ['count', 'Count'],
            ['share', 'Percentage'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="demo-label">Your request</p>
        <p className="example-request">
          {metric === 'count'
            ? 'how many customers are in each state'
            : 'what percentage of customers is in each state'}
        </p>
      </div>
      <div className="example-output dark-surface" aria-live="polite">
        <div className="example-output-heading">
          <p className="demo-label">SQL translation</p>
          <span className="chip st-executed">
            <Icon name="check" />6 customers
          </span>
        </div>
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
                <b
                  style={{
                    width: `${(row.count / (metric === 'count' ? Math.max(...counts.map((item) => item.count)) : sampleCustomers.length)) * 100}%`,
                  }}
                />
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
    </article>
  );
}
function ChangeExample() {
  return (
    <article className="compact-example" aria-labelledby="change-h">
      <div className="example-input">
        <div className="example-stat">
          <strong>1</strong>
          <span>change, always your decision</span>
        </div>
        <h3 id="change-h">Move things forward.</h3>
        <p>Preview a change, then approve or decline it.</p>
        <span className="example-change-note">
          <Icon name="check" />
          Changes wait for your OK
        </span>
        <p className="demo-label">Your request</p>
        <p className="example-request">{sampleUpdate.request}</p>
      </div>
      <div className="example-output dark-surface">
        <HomeApproval compact />
      </div>
    </article>
  );
}
const options = [
  { label: 'Look up', icon: 'search', content: LookupExample },
  { label: 'Summarize', icon: 'layers', content: SummaryExample },
  { label: 'Make changes', icon: 'check', content: ChangeExample },
];
export function HomeExamples() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const running = !paused && !hovered && !focused && !reduced;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setActive((value) => (value + 1) % options.length), 8000);
    return () => clearTimeout(timer);
  }, [active, running]);
  const refs = useRef([]);
  function onKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % options.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      setPaused(true);
      setActive(next);
      refs.current[next]?.focus();
    }
  }
  return (
    <section className="home-section home-examples" id="ask" aria-labelledby="ask-h">
      <div className="wrap">
        <div className="section-heading centered">
          <p className="eyebrow">What you can ask</p>
          <h2 id="ask-h">
            See what your data <em>can tell you.</em>
          </h2>
          <p>Try a request. Check the SQL. See what happens.</p>
        </div>
        <div
          className="example-carousel"
          onFocusCapture={(event) => setFocused(!event.target.closest('.example-playback'))}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
        >
          <div className="example-selector">
            {!reduced && (
              <button
                className="example-playback"
                type="button"
                aria-label={paused ? 'Resume example slideshow' : 'Pause example slideshow'}
                aria-pressed={paused}
                onClick={() => setPaused((value) => !value)}
              >
                <Icon name={paused ? 'play' : 'pause'} />
              </button>
            )}
            <div className="example-tabs" role="tablist" aria-label="Try a sample request">
              {options.map((option, index) => (
                <button
                  key={option.label}
                  id={'example-tab-' + index}
                  ref={(node) => {
                    refs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active === index}
                  aria-controls={'example-panel-' + index}
                  tabIndex={active === index ? 0 : -1}
                  onClick={() => {
                    setPaused(true);
                    setActive(index);
                  }}
                  onKeyDown={(event) => onKey(event, index)}
                >
                  <Icon name={option.icon} />
                  {option.label}
                  {active === index && (
                    <span
                      key={active + '-' + running}
                      className="example-progress"
                      data-running={running}
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
          <div
            className="example-stage"
            aria-live={running ? 'off' : 'polite'}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {options.map(({ content: Content }, index) => (
              <div
                key={index}
                id={'example-panel-' + index}
                role="tabpanel"
                aria-labelledby={'example-tab-' + index}
                hidden={active !== index}
                tabIndex="0"
              >
                <Content />
              </div>
            ))}
          </div>
        </div>
        <p className="examples-disclaimer">Interactive sample · No real database is changed</p>
      </div>
    </section>
  );
}
