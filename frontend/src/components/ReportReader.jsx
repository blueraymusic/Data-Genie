import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useEnterMotion } from '../hooks/useMotion';

export function ReportReader({
  report,
  disabled,
  activity,
  onEdit,
  onDelete,
  onDownload,
  onShare,
  onMove,
  destinations = [],
}) {
  const [confirmDelete, setConfirmDelete] = useState(false),
    [moving, setMoving] = useState(false),
    [destination, setDestination] = useState('');
  const surface = useRef(null),
    keep = useRef(null),
    remove = useRef(null),
    returning = useRef(false);
  useEnterMotion(surface, `${report.report_id}:${report.version}`);
  useEffect(() => {
    setConfirmDelete(false);
    setMoving(false);
    setDestination('');
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
            {report.archived
              ? 'Archived report'
              : report.published
                ? 'Shared report'
                : 'Draft · private to author & owner'}
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
          {report.can_share && (
            <button
              className="btn"
              disabled={disabled || confirmDelete}
              onClick={() => onShare(report)}
            >
              {activity === 'share'
                ? 'Updating sharing…'
                : report.published
                  ? 'Make private'
                  : 'Share with workspace'}
            </button>
          )}
          {report.can_move && destinations.length > 0 && (
            <button
              className="btn"
              disabled={disabled || confirmDelete}
              aria-expanded={moving}
              onClick={() => setMoving((value) => !value)}
            >
              Move report
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
      {moving && !confirmDelete && (
        <section className="report-move-panel" aria-label="Move this report">
          <label>
            Destination workspace
            <select
              value={destination}
              disabled={disabled}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">Choose a workspace you own</option>
              {destinations.map((item) => (
                <option key={item.workspace_id} value={item.workspace_id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">
            The report leaves this workspace and becomes a private draft in its destination. The
            destination owner can share it after review.
          </p>
          <button
            className="btn pri"
            disabled={disabled || !destination}
            onClick={() => onMove(report, destination)}
          >
            {activity === 'move' ? 'Moving…' : 'Move as private draft'}
          </button>
        </section>
      )}
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
