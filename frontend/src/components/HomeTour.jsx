import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { Brand } from './Brand';
import { SqlBlock } from './SqlBlock';
import { ResultTable } from './ResultTable';
import { HomeApproval } from './HomeApproval';
import { Link } from '../lib/router';
import { customerLookup, sampleStates, tourHistory } from '../data/homeSamples';

const tabs = [
  {
    label: 'Ask',
    icon: 'workspace',
    title: 'Start with a question.',
    copy: 'No query language to learn. Ask in your own words, then keep going with a follow-up. Try a different state in this sample.',
    link: '/#demo',
    action: 'Try the full demo',
  },
  {
    label: 'Review the SQL',
    icon: 'layers',
    title: 'See how it gets there.',
    copy: 'Your request and the SQL stay together. Read the explanation, check the filter, or copy the query. Nothing is hidden.',
    link: '/#ask',
    action: 'Explore more requests',
  },
  {
    label: 'Approve changes',
    icon: 'check',
    title: 'You have the final say.',
    copy: 'Adding, editing or deleting data starts with a preview. Check it, then approve or decline. Try both here—this is only sample data.',
    link: '/#safety',
    action: 'See how approval works',
  },
  {
    label: 'History',
    icon: 'clock',
    title: 'Find any answer again.',
    copy: 'Your earlier requests stay with their SQL and results. Filter this sample history and open a request to see what happened.',
    link: '/history',
    action: 'Open your history',
  },
];
function AskPreview() {
  const [draft, setDraft] = useState('Missouri');
  const [state, setState] = useState('Missouri');
  const query = customerLookup(state);
  return (
    <>
      <form
        className="tour-query-form"
        onSubmit={(event) => {
          event.preventDefault();
          setState(draft);
        }}
      >
        <label htmlFor="tour-state">Show customers from</label>
        <div>
          <select id="tour-state" value={draft} onChange={(event) => setDraft(event.target.value)}>
            {sampleStates.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit">
            Ask <Icon name="arrow" />
          </button>
        </div>
      </form>
      <div className="tour-read-result" aria-live="polite">
        <p className="demo-label">SQL translation</p>
        <SqlBlock home sql={query.sql} />
        <p className="preview-answer">
          {query.rows.length} {query.rows.length === 1 ? 'customer' : 'customers'} in {state}
        </p>
        <ResultTable home rows={query.rows} />
      </div>
      <button
        className="inline-action"
        type="button"
        onClick={() => {
          const next = state === 'Iowa' ? 'Missouri' : 'Iowa';
          setDraft(next);
          setState(next);
        }}
      >
        Follow up: {state === 'Iowa' ? 'and Missouri?' : 'which ones are in Iowa?'}{' '}
        <Icon name="arrow" />
      </button>
    </>
  );
}
function ReviewPreview() {
  const [explained, setExplained] = useState(false);
  return (
    <>
      <p className="demo-label">Your request</p>
      <p className="example-request">show customers from Missouri</p>
      <div className="tour-review-sql">
        <SqlBlock home sql={customerLookup('Missouri').sql} />
      </div>
      <button
        className="inline-action"
        type="button"
        aria-expanded={explained}
        aria-controls="tour-explanation"
        onClick={() => setExplained((value) => !value)}
      >
        {explained ? 'Hide explanation' : 'Explain this query'}
        <Icon name={explained ? 'x' : 'plus'} />
      </button>
      {explained && (
        <div className="query-explanation" id="tour-explanation">
          <p>
            <code>SELECT name, state</code> picks the two columns to return.
          </p>
          <p>
            <code>FROM customers</code> chooses the table.
          </p>
          <p>
            <code>WHERE state = 'Missouri'</code> keeps matching customers.
          </p>
          <span className="chip st-executed">
            <Icon name="check" />
            Read only · no data changed
          </span>
        </div>
      )}
      {!explained && <p className="sample-caption">Use the copy icon to take the SQL with you.</p>}
    </>
  );
}
function HistoryPreview() {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('lookup');
  const rows = tourHistory.filter((row) => filter === 'all' || row.status === filter);
  const current = rows.find((row) => row.id === selected) || rows[0];
  return (
    <>
      <div className="history-demo-filters" role="group" aria-label="Filter sample history">
        {['all', 'executed', 'declined'].map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item === 'all' ? 'All requests' : item}
          </button>
        ))}
      </div>
      <div className="history-demo-list" aria-label="Sample history requests">
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            aria-pressed={current.id === row.id}
            onClick={() => setSelected(row.id)}
          >
            <span>
              {row.request}
              <small>shop.sqlite · {row.operation}</small>
            </span>
            <Icon name={row.status === 'executed' ? 'check' : 'x'} />
          </button>
        ))}
      </div>
      <div className="history-demo-detail" aria-live="polite">
        <SqlBlock
          home
          sql={current.sql}
          operation={current.operation}
          declined={current.status === 'declined'}
        />
        <p className="preview-answer">{current.result}</p>
      </div>
    </>
  );
}
export function HomeTour() {
  const [active, setActive] = useState(0);
  const refs = useRef([]);
  const tab = tabs[active];
  function onKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
      refs.current[next]?.focus();
    }
  }
  return (
    <section className="home-tour dark-surface" id="tour" aria-labelledby="tour-h">
      <div className="wrap">
        <div className="section-heading centered">
          <p className="eyebrow">Inside the workspace</p>
          <h2 id="tour-h">
            Ask, check and approve
            <br />
            in <em>one workspace.</em>
          </h2>
        </div>
        <div className="tour-tabs" role="tablist" aria-label="Explore the workspace">
          {tabs.map((item, index) => (
            <button
              key={item.label}
              id={'tour-tab-' + index}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-controls="tour-panel"
              tabIndex={active === index ? 0 : -1}
              ref={(node) => {
                refs.current[index] = node;
              }}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKey(event, index)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="tour-panel"
          role="tabpanel"
          id="tour-panel"
          aria-labelledby={'tour-tab-' + active}
          tabIndex="0"
        >
          <div className="tour-story" key={'story-' + active}>
            <span className="tour-step">0{active + 1} / 04</span>
            <div className="tour-icon">
              <Icon name={tab.icon} />
            </div>
            <h3>{tab.title}</h3>
            <p>{tab.copy}</p>
            <Link className="inline-link" href={tab.link}>
              {tab.action}
              <Icon name="arrow" />
            </Link>
          </div>
          <div className="tour-window" key={active}>
            <div className="tour-window-top">
              <Brand />
              <span className="sample-label">Interactive sample</span>
            </div>
            <div className="tour-window-content">
              <div className="tour-preview-heading">
                <h4>
                  {tab.label === 'Review the SQL'
                    ? 'Translation'
                    : tab.label === 'Approve changes'
                      ? 'Review change'
                      : tab.label === 'History'
                        ? 'History'
                        : 'Ask your database'}
                </h4>
                <span className="demo-connected">
                  <span />
                  shop.sqlite
                </span>
              </div>
              {active === 0 ? (
                <AskPreview />
              ) : active === 1 ? (
                <ReviewPreview />
              ) : active === 2 ? (
                <HomeApproval />
              ) : (
                <HistoryPreview />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
