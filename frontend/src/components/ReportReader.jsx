import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useEnterMotion } from '../hooks/useMotion';

export function ReportReader({ report, disabled, activity, onEdit, onDelete, onDownload }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const surface = useRef(null),
    keep = useRef(null),
    remove = useRef(null),
    returning = useRef(false);
  useEnterMotion(surface, `${report.report_id}:${report.version}`);
  useEffect(() => {
    setConfirmDelete(false);
  }, [report.report_id, report.version]);
  useEffect(() => {
    if (confirmDelete) {
      returning.current = true;
      keep.current?.focus();
    } else if (returning.current && !disabled) {
      returning.current = false;
      remove.current?.focus();
    }
  }, [confirmDelete, disabled]);
  return (
    <article ref={surface} className="report-reader">
      <header>
        <div>
          <span className="report-status-badge">
            {report.published ? 'Shared report' : 'Draft · private to author & owner'}
          </span>
          <p className="small muted">
            {report.first_name} {report.last_name} · Updated{' '}
            {new Date(report.updated_at * 1000).toLocaleString()}
          </p>
        </div>
        <div className="report-reader-actions">
          <button
            className="btn"
            disabled={disabled || confirmDelete}
            onClick={() => onDownload(report)}
          >
            <Icon name="download" />
            {activity === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
          </button>
          {report.can_edit && (
            <button className="btn" disabled={disabled || confirmDelete} onClick={onEdit}>
              Edit report
            </button>
          )}
          {report.can_delete && (
            <button
              ref={remove}
              className="btn quiet report-delete"
              disabled={disabled || confirmDelete}
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" />
              Delete report
            </button>
          )}
        </div>
      </header>
      {confirmDelete && (
        <section className="report-delete-confirm" role="alert" aria-label="Delete this report?">
          <div>
            <strong>Delete this report?</strong>
            <p>“{report.title}” will be permanently removed for everyone in this workspace.</p>
          </div>
          <div className="report-delete-actions">
            <button
              ref={keep}
              className="btn"
              disabled={disabled}
              onClick={() => setConfirmDelete(false)}
            >
              Keep report
            </button>
            <button
              className="btn report-delete-primary"
              disabled={disabled}
              onClick={() => onDelete(report)}
            >
              {activity === 'delete' ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </section>
      )}
      <h3>{report.title}</h3>
      <p className="report-text">{report.body}</p>
    </article>
  );
}
