import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ReportOverlay } from './ReportOverlay';
import { ReportEditor } from './ReportEditor';
import { ReportReader } from './ReportReader';
import { Icon } from './Icon';
import { useEnterMotion } from '../hooks/useMotion';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useReportCollaboration } from '../hooks/useReportCollaboration';
import { setDragPreview } from '../lib/dragPreview';

const blank = { title: '', body: '', published: false };
function excerpt(body) {
  const text = (body || '').trim().replace(/\s+/gu, ' ');
  return text.length > 180 ? text.slice(0, 177) + '…' : text || 'Open to read this report.';
}

export function WorkspaceReports({ workspace, workspaces = [], busy: parentBusy }) {
  const [reports, setReports] = useState([]),
    [selected, setSelected] = useState(null),
    [overlayOpen, setOverlayOpen] = useState(false),
    [draft, setDraft] = useState(null),
    [goal, setGoal] = useState(''),
    [source, setSource] = useState(''),
    [ai, setAi] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [dragging, setDragging] = useState(null),
    [dropTarget, setDropTarget] = useState(null),
    [revision, setRevision] = useState(0);
  const lock = useRef(false),
    loadRequest = useRef(null),
    loadedBase = useRef(null),
    baseline = useRef(blank),
    newReportButton = useRef(null),
    surface = useRef(null);
  useEnterMotion(surface, workspace.workspace_id, !loading);
  const owner = workspace.role === 'owner',
    viewer = workspace.role === 'viewer' || Boolean(workspace.archived_at);
  const base = '/api/workspaces/' + encodeURIComponent(workspace.workspace_id) + '/reports';
  const destinations = workspaces.filter(
    (item) =>
      item.role === 'owner' && !item.archived_at && item.workspace_id !== workspace.workspace_id,
  );
  useLiveRefresh(() => {
    if (!lock.current && !loadRequest.current) setRevision((value) => value + 1);
  });
  useEffect(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    if (loadedBase.current !== base) setLoading(true);
    api(base, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          loadedBase.current = base;
          setReports(data.reports || []);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (loadRequest.current === controller) loadRequest.current = null;
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, revision]);
  useEffect(() => {
    if (!overlayOpen && !loading && message === 'Report deleted.') newReportButton.current?.focus();
  }, [overlayOpen, loading, message]);
  const disabled = busy || parentBusy || loading;
  const report = reports.find((item) => item.report_id === selected);
  const live = useReportCollaboration({
    base,
    enabled: Boolean(draft && report?.live_editing && !viewer),
    draft,
    setDraft,
  });
  const editorDisabled =
    disabled || (draft?.report_id && !report?.can_edit) || (live.active && !live.ready);
  function open(item) {
    setOverlayOpen(true);
    setSelected(item?.report_id || null);
    setDraft(null);
    setAi(false);
    setError('');
    setMessage('');
  }
  function create(body = '') {
    open(null);
    baseline.current = { ...blank, body };
    setDraft({ ...blank, body });
    setGoal('');
    setSource('');
  }
  async function generate() {
    if (disabled || lock.current || viewer) return;
    lock.current = true;
    setBusy(true);
    setActivity('generate');
    setError('');
    try {
      const result = await api(base + '/generate', {
        method: 'POST',
        body: { goal, source },
      });
      live.changeDraft((current) => ({ ...current, body: result.body }));
      setAi(false);
      setMessage('AI draft ready. Check its facts and edit before saving.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  async function save(event) {
    event.preventDefault();
    if (disabled || lock.current || viewer) return;
    lock.current = true;
    setBusy(true);
    setActivity('save');
    setError('');
    try {
      const synced = await live.flush();
      const payload = synced
        ? {
            ...draft,
            title: synced.title,
            body: synced.body,
            published: synced.published,
            version: synced.base_version,
            collaboration_revision: synced.revision,
          }
        : draft;
      const result = await api(base, { method: 'POST', body: payload });
      setDraft(null);
      setSelected(result.report_id);
      setLoading(true);
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      setMessage(
        payload.published
          ? 'Report shared with this workspace.'
          : 'Draft saved. Only you and the owner can see it.',
      );
    } catch (failure) {
      setError(failure.message);
      if (failure.message.includes('changed in another session')) setRevision((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  const hasUnsavedChanges = Boolean(
    draft &&
    ((live.active
      ? live.pending || draft.published !== baseline.current.published
      : ['title', 'body', 'published'].some((field) => draft[field] !== baseline.current[field])) ||
      goal.trim() ||
      source.trim()),
  );
  function close() {
    if (busy || lock.current) return;
    setOverlayOpen(false);
    setDraft(null);
    setAi(false);
  }
  function edit() {
    setError('');
    setMessage('');
    baseline.current = { ...report };
    setDraft({ ...baseline.current });
    setGoal('');
    setSource('');
  }
  async function deleteReport(item) {
    if (disabled || lock.current || !item.can_delete) return;
    lock.current = true;
    setBusy(true);
    setActivity('delete');
    setError('');
    setMessage('');
    try {
      await api(base + '/' + encodeURIComponent(item.report_id) + '/delete', {
        method: 'POST',
        body: { version: item.version },
      });
      setOverlayOpen(false);
      setSelected(null);
      setReports((current) => current.filter((report) => report.report_id !== item.report_id));
      setMessage('Report deleted.');
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event('dg-workspaces-changed'));
    } catch (failure) {
      setError(failure.message);
      if (failure.message.includes('changed in another session')) setRevision((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  async function shareReport(item) {
    if (disabled || lock.current || !owner || !item.can_share) return;
    lock.current = true;
    setBusy(true);
    setActivity('share');
    setError('');
    setMessage('');
    try {
      await api(base, { method: 'POST', body: { ...item, published: !item.published } });
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      setMessage(
        item.published
          ? 'Report is now private to its author and workspace owner.'
          : 'Report shared with this workspace.',
      );
    } catch (failure) {
      setError(failure.message);
      if (failure.message.includes('changed in another session')) setRevision((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  async function moveReport(item, destinationId) {
    if (disabled || lock.current || !item?.can_move || !owner) return;
    const destination = destinations.find((target) => target.workspace_id === destinationId);
    if (!destination) return;
    lock.current = true;
    setBusy(true);
    setActivity('move');
    setError('');
    setMessage('');
    try {
      await api(base + '/' + encodeURIComponent(item.report_id) + '/move', {
        method: 'POST',
        body: { workspace_id: destinationId, version: item.version },
      });
      setReports((current) => current.filter((report) => report.report_id !== item.report_id));
      setOverlayOpen(false);
      setSelected(null);
      setDragging(null);
      setRevision((value) => value + 1);
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      setMessage('Report moved to ' + destination.name + ' as a private draft.');
    } catch (failure) {
      setError(failure.message);
      if (failure.message.includes('changed in another session')) setRevision((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  async function downloadPdf(item) {
    if (disabled || lock.current || !item) return;
    lock.current = true;
    setBusy(true);
    setActivity('pdf');
    setError('');
    setMessage('');
    try {
      const blob = await api(base + '/' + encodeURIComponent(item.report_id) + '/pdf', {
        responseType: 'blob',
      });
      if (!blob.size || blob.type !== 'application/pdf')
        throw new Error('The PDF could not be prepared. Please try again.');
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download =
        (item.title
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/gu, '')
          .slice(0, 90) || 'data-genie-report') + '.pdf';
      document.body.append(link);
      link.click();
      link.remove();
      const revoke = URL.revokeObjectURL.bind(URL);
      setTimeout(() => revoke(url), 1000);
      setMessage('PDF download started.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
      setActivity('');
    }
  }
  return (
    <section ref={surface} className="workspace-reports" aria-label="Workspace reports">
      <header className="workspace-section-heading">
        <div>
          <h2>{viewer ? 'Shared reports' : 'Reports'}</h2>
          <p
            className={'small muted' + (loading ? ' report-loading' : '')}
            role={loading ? 'status' : undefined}
          >
            {loading
              ? 'Loading reports…'
              : workspace.archived_at
                ? 'Archived reports are read-only. Workspace members can download or delete reports they can view.'
                : viewer
                  ? 'Reports approved and shared by your workspace owner.'
                  : 'Your findings, the evidence, and what comes next.'}
          </p>
        </div>
        {!viewer && (
          <button
            ref={newReportButton}
            className="btn pri"
            disabled={disabled}
            onClick={() => create()}
          >
            <Icon name="plus" />
            New report
          </button>
        )}
      </header>
      {!overlayOpen && error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {!overlayOpen && message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      <nav className="report-library" aria-label="Saved reports" aria-busy={loading}>
        {reports.map((item) => (
          <button
            key={item.report_id}
            className={dragging === item.report_id ? 'is-dragging' : undefined}
            draggable={Boolean(item.can_move && destinations.length && !disabled)}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-data-genie-report', item.report_id);
              event.dataTransfer.effectAllowed = 'move';
              setDragPreview(event);
              setDragging(item.report_id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropTarget(null);
            }}
            aria-label={'Open report: ' + item.title}
            disabled={disabled}
            onClick={() => open(item)}
          >
            <span className="report-card-top">
              <Icon name="report" />
              <span className="report-status-badge">
                {item.published ? 'Shared report' : 'Draft'}
              </span>
            </span>
            <strong>{item.title}</strong>
            <span className="report-card-excerpt">{excerpt(item.body)}</span>
            <span className="report-card-meta">
              <span>
                {item.first_name} {item.last_name}
              </span>
              {item.updated_at && (
                <time dateTime={new Date(item.updated_at * 1000).toISOString()}>
                  {new Date(item.updated_at * 1000).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              )}
            </span>
            <span className="report-library-open">
              Open report <Icon name="arrow" />
            </span>
          </button>
        ))}
      </nav>
      {dragging && destinations.length > 0 && (
        <section className="report-move-targets" aria-label="Move report to a workspace">
          <p>Drop the report into a workspace you own. It will become a private draft.</p>
          <div>
            {destinations.map((target) => (
              <button
                className={'btn' + (dropTarget === target.workspace_id ? ' is-drop-target' : '')}
                key={target.workspace_id}
                disabled={disabled}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/x-data-genie-report')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTarget(target.workspace_id);
                  }
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropTarget(null);
                  const id = event.dataTransfer.getData('application/x-data-genie-report');
                  moveReport(
                    reports.find((item) => item.report_id === id),
                    target.workspace_id,
                  );
                }}
                onClick={() =>
                  moveReport(
                    reports.find((item) => item.report_id === dragging),
                    target.workspace_id,
                  )
                }
              >
                {target.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {!loading && !reports.length && (
        <div className="report-library-empty">
          <span className="report-empty-mark" aria-hidden="true">
            <Icon name="report" />
          </span>
          <p className="eyebrow">A home for your findings</p>
          <h3>{viewer ? 'No shared reports yet.' : 'Room for your next finding.'}</h3>
          <p className="muted">
            {viewer
              ? 'No reports have been shared yet.'
              : 'No reports yet. Start with a blank page or a template.'}
          </p>
        </div>
      )}
      {overlayOpen && (
        <ReportOverlay
          title={
            draft ? (draft.report_id ? 'Edit report' : 'New report') : report?.title || 'Report'
          }
          workspaceName={workspace.name}
          busy={busy || parentBusy}
          dirty={hasUnsavedChanges}
          onClose={close}
        >
          {(requestClose) => (
            <>
              {error && (
                <p role="alert" className="err report-overlay-notice">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="report-overlay-notice">
                  {message}
                </p>
              )}
              {draft ? (
                <>
                  {draft.report_id && !report?.can_edit && (
                    <p role="status" className="report-overlay-notice">
                      Live editing is no longer available for this report. Your local writing is
                      kept here so you can copy it.
                    </p>
                  )}
                  {!live.active && report && report.version !== draft.version && (
                    <p role="status" className="report-overlay-notice">
                      This report changed in another session. Your writing is kept here; reopen the
                      saved report before saving your changes.
                    </p>
                  )}
                  <ReportEditor
                    {...{
                      draft,
                      owner,
                      busy,
                      activity,
                      ai,
                      setAi,
                      goal,
                      setGoal,
                      source,
                      setSource,
                      generate,
                      save,
                    }}
                    setDraft={live.changeDraft}
                    disabled={editorDisabled}
                    live={live}
                    onClose={requestClose}
                  />
                </>
              ) : report ? (
                <ReportReader
                  {...{ report, disabled, activity, destinations }}
                  onEdit={edit}
                  onDelete={deleteReport}
                  onDownload={downloadPdf}
                  onShare={shareReport}
                  onMove={moveReport}
                />
              ) : (
                <p className="report-overlay-notice" role="status">
                  {loading
                    ? 'Refreshing saved report…'
                    : 'This report is no longer available in this workspace. It may have been moved, deleted, or made private.'}
                </p>
              )}
            </>
          )}
        </ReportOverlay>
      )}
    </section>
  );
}
