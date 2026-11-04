import { useState } from 'react';
import { SqlBlock } from './SqlBlock';
import { Icon } from './Icon';
import { sampleUpdate } from '../data/homeSamples';

export function HomeApproval({
  change = sampleUpdate,
  approveLabel = 'Approve change',
  approvedText = 'Sample result: Priya Nair’s state is now Kansas.',
}) {
  const [decision, setDecision] = useState(null);
  return (
    <div className="home-approval">
      <div className="sample-meta">
        <span className={'chip st-' + (decision || 'pending')}>
          <Icon
            name={decision === 'executed' ? 'check' : decision === 'declined' ? 'x' : 'clock'}
          />
          {decision || 'Waiting for your OK'}
        </span>
        <span className="sample-label">Sample only</span>
      </div>
      <p className="example-request">{change.request}</p>
      <SqlBlock
        home
        sql={change.sql}
        operation={change.operation}
        declined={decision === 'declined'}
      />
      <div className="approval-answer" aria-live="polite">
        {decision ? (
          <>
            <p className="approval-outcome">
              {decision === 'executed' ? approvedText : 'Not run. You declined this.'}
            </p>
            <p className="sample-caption">Your real data has not been changed.</p>
          </>
        ) : (
          <>
            <p>{change.description}</p>
            <p className="sample-caption">This is a local demo. No database is changed.</p>
          </>
        )}
      </div>
      <div className="button-row">
        {decision ? (
          <button className="btn btn-secondary" type="button" onClick={() => setDecision(null)}>
            Try again <Icon name="replay" />
          </button>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setDecision('declined')}
            >
              Don’t run
            </button>
            <button
              className={'btn ' + (change.operation === 'DELETE' ? 'btn-danger' : 'btn-primary')}
              type="button"
              onClick={() => setDecision('executed')}
            >
              {approveLabel}
              <Icon name="check" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
