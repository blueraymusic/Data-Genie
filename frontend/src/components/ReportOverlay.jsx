import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function ReportOverlay({ title, workspaceName, busy, dirty, onClose, children }) {
  const titleId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const keepEditing = useRef(null);
  const returnFocus = useRef(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (confirmDiscard) keepEditing.current?.focus();
    else returnFocus.current?.focus();
  }, [confirmDiscard]);
  function requestClose() {
    if (busy) return;
    if (dirty) {
      if (!confirmDiscard) returnFocus.current = document.activeElement;
      setConfirmDiscard(true);
    } else onClose();
  }
  return (
    <Modal titleId={titleId} className="report-overlay" onClose={requestClose}>
      <header className="report-overlay-header">
        <span className="report-heading-icon" aria-hidden="true">
          <Icon name="report" />
        </span>
        <div className="report-heading-copy">
          <p className="eyebrow">{workspaceName || 'Workspace'} · Reports</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        {dirty && <span className="report-unsaved">Unsaved changes</span>}
        <button
          type="button"
          className="btn quiet"
          disabled={busy}
          onClick={requestClose}
          aria-label="Close report"
        >
          <Icon name="x" />
          Close
        </button>
      </header>
      {confirmDiscard && (
        <section className="report-discard-prompt" role="alert" aria-label="Unsaved report changes">
          <div>
            <strong>Discard unsaved changes?</strong>
            <p>Your changes haven’t been saved.</p>
          </div>
          <button
            ref={keepEditing}
            type="button"
            className="btn pri"
            disabled={busy}
            onClick={() => setConfirmDiscard(false)}
          >
            Keep editing
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Discard changes
          </button>
        </section>
      )}
      <div className="report-overlay-content" inert={confirmDiscard || undefined}>
        {children(requestClose)}
      </div>
    </Modal>
  );
}
