import { Link } from '../lib/router';
import '../styles/request-window.css';

export function RequestWindowControls({ window: requestWindow, feedId }) {
  if (!requestWindow.total) return null;
  const { start, end, total, pendingOutsideCount, hasEarlier, viewingEarlier } = requestWindow;
  return (
    <nav className="request-window-controls" aria-label="Recent request navigation">
      <p className="request-window-count" aria-live="polite" aria-atomic="true">
        Recent requests {start + 1}–{end} of {total}.
        {pendingOutsideCount > 0 && (
          <>
            {' '}
            {pendingOutsideCount} pending{' '}
            {pendingOutsideCount === 1 ? 'request is' : 'requests are'} also shown.
          </>
        )}{' '}
        <Link href="/history">View all in History</Link>
      </p>
      {(hasEarlier || viewingEarlier) && (
        <div className="request-window-actions">
          {hasEarlier && (
            <button
              type="button"
              className="btn"
              aria-controls={feedId}
              onClick={requestWindow.showEarlier}
            >
              Show earlier requests
            </button>
          )}
          {viewingEarlier && (
            <button
              type="button"
              className="text-button"
              aria-controls={feedId}
              onClick={requestWindow.jumpToLatest}
            >
              Back to latest requests
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
