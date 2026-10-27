import { useEffect, useState } from 'react';
import { demos } from '../data/home';
import { SqlBlock } from './SqlBlock';
import { ResultTable } from './ResultTable';
import { Icon } from './Icon';
export function HeroDemo() {
  const [active, setActive] = useState(0),
    [replay, setReplay] = useState(0),
    [typed, setTyped] = useState(demos[0].request),
    [ready, setReady] = useState(true),
    [decision, setDecision] = useState(null);
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
    const timer = setTimeout(() => setReady(true), demo.request.length * 12 + 450);
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
  return (
    <div className="stage" aria-label="Live example">
      <div className="stage-top">
        <span>Sample data</span>
        <code>shop.sqlite</code>
      </div>
      <div className="stage-body">
        <div className={'tx' + (ready ? ' drawn static' : '')}>
          <div className="margin">
            <span className="time">
              {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className={'chip st-' + status}>
              <Icon name={status === 'pending' ? 'clock' : status === 'declined' ? 'x' : 'check'} />
              {status}
            </span>
          </div>
          <p className={'req' + (!ready ? ' typing' : '')}>{typed}</p>
          <svg
            className="thread"
            viewBox="0 0 100 64"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path className="line" d="M0 16C55 16 45 47 100 47" />
          </svg>
          <div className="sqlcol">
            <SqlBlock home sql={ready ? demo.sql : ''} operation={demo.operation} />
          </div>
          <p className="note">{ready ? demo.note : 'Writing the SQL…'}</p>
          <div className="result" aria-live="polite">
            {ready &&
              (demo.operation === 'INSERT' ? (
                decision ? (
                  <p className={decision === 'declined' ? 'notrun' : 'msg'}>
                    {decision === 'declined'
                      ? 'Not run. You declined this.'
                      : '1 row added to customers. Sample only.'}
                  </p>
                ) : (
                  <div className="confirm">
                    <p className="t">This will add Ana Lee to customers.</p>
                    <p className="s">
                      This sample only demonstrates the confirmation. No real database is changed.
                    </p>
                    <div className="row">
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
                <ResultTable home rows={demo.rows} />
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
            aria-pressed={active === index}
            onClick={() => {
              setActive(index);
              setReplay((value) => value + 1);
            }}
          >
            {item.request}
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
