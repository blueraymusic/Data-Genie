import { useEffect, useState } from 'react';
import { demos } from '../data/home';
import { SqlBlock } from './SqlBlock';
import { ResultTable } from './ResultTable';
import { Brand } from './Brand';
import { Icon } from './Icon';
import { Link } from '../lib/router';

export function HeroDemo() {
  const [active, setActive] = useState(0),
    [replay, setReplay] = useState(0);
  const [ready, setReady] = useState(true),
    [typed, setTyped] = useState(demos[0].request);
  const [decision, setDecision] = useState(null);
  const demo = demos[active];
  useEffect(() => {
    setDecision(null);
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) {
      setTyped(demo.request);
      setReady(true);
      return;
    }
    setTyped('');
    setReady(false);
    let index = 0;
    const interval = setInterval(() => {
      index += 2;
      setTyped(demo.request.slice(0, index));
      if (index >= demo.request.length) clearInterval(interval);
    }, 24);
    const timer = setTimeout(() => setReady(true), demo.request.length * 12 + 200);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [active, replay, demo.request]);
  const status =
    !ready || (demo.operation === 'INSERT' && !decision)
      ? 'pending'
      : decision === 'declined'
        ? 'declined'
        : 'executed';
  const choose = (index) => {
    setActive(index);
    setReplay((value) => value + 1);
  };
  return (
    <div className="stage" id="demo" aria-label="Interactive sample demo" tabIndex="-1">
      <div className="stage-top">
        <Brand />
        <span>
          Interactive demo <span className="sample-dot">·</span> Sample data
        </span>
      </div>
      <div className="demo-window-body">
        <aside className="demo-sidebar" aria-label="Sample database">
          <p className="demo-label">Database</p>
          <div className="demo-database">
            <Icon name="database" />
            <code>shop.sqlite</code>
          </div>
          <span className="demo-nav-current">
            <Icon name="workspace" />
            Ask
          </span>
          <Link href="/history">
            <Icon name="clock" />
            Your history
          </Link>
          <p className="demo-label">Tables</p>
          {['customers', 'products', 'sales'].map((table, index) => (
            <button key={table} type="button" onClick={() => choose(index === 0 ? 0 : 1)}>
              <Icon name="table" />
              {table}
            </button>
          ))}
          <div className="demo-connected">
            <span />
            Sample connected
          </div>
        </aside>
        <div className="stage-body">
          <div className="demo-workspace-title">
            <h2>Workspace</h2>
            <span className="sample-label">Sample</span>
          </div>
          <div className="demo-translation">
            <p className="demo-label">Your request</p>
            <p className={'demo-request' + (!ready ? ' typing' : '')}>{typed}</p>
            <div className="demo-meta">
              <span className={'chip st-' + status}>
                <Icon
                  name={status === 'pending' ? 'clock' : status === 'declined' ? 'x' : 'check'}
                />
                {status}
              </span>
              <span>shop.sqlite</span>
            </div>
            <div className="demo-sql">
              <p className="demo-label">SQL translation</p>
              {ready ? (
                <SqlBlock home sql={demo.sql} operation={demo.operation} />
              ) : (
                <div className="demo-sql-loading" role="status">
                  <span>Translating your request…</span>
                  <i />
                  <i />
                </div>
              )}
            </div>
            <p className="demo-note">{ready ? demo.note : 'Writing the SQL…'}</p>
          </div>
          <div className="demo-result" aria-live="polite">
            {ready &&
              (demo.operation === 'INSERT' ? (
                decision ? (
                  <div className="demo-decision">
                    <Icon name={decision === 'declined' ? 'x' : 'check'} />
                    <p>
                      {decision === 'declined'
                        ? 'Not run. You declined this.'
                        : '1 row added to customers. Sample only.'}
                    </p>
                  </div>
                ) : (
                  <div className="demo-confirm">
                    <p>This will add Ana Lee to customers.</p>
                    <p className="muted">Sample only. No real database is changed.</p>
                    <div className="button-row">
                      <button className="btn btn-primary" onClick={() => setDecision('executed')}>
                        Add customer
                      </button>
                      <button className="btn btn-secondary" onClick={() => setDecision('declined')}>
                        Don’t run
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <h3 className="demo-answer">
                    {active === 0
                      ? '3 customers found in Missouri'
                      : 'Average sale amount by category'}
                  </h3>
                  <ResultTable home rows={demo.rows} />
                </>
              ))}
          </div>
        </div>
      </div>
      <div className="picks" role="group" aria-label="Example requests">
        {demos.map((item, index) => (
          <button
            className="pick"
            type="button"
            key={item.request}
            aria-label={item.request}
            aria-pressed={active === index}
            onClick={() => choose(index)}
          >
            {['Look up', 'Summarize', 'Make a change'][index]}
          </button>
        ))}
        <button
          className="btn btn-quiet btn-sm"
          type="button"
          onClick={() => setReplay((value) => value + 1)}
        >
          <Icon name="replay" />
          Replay
        </button>
      </div>
    </div>
  );
}
