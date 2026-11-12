import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ReportOverlay } from './ReportOverlay';
import { ReportEditor } from './ReportEditor';
import { ReportReader } from './ReportReader';
import { Icon } from './Icon';
import { useEnterMotion } from '../hooks/useMotion';

const blank = { title: '', body: '', published: false };
function excerpt(body) {
  const text = (body || '').trim().replace(/\s+/gu, ' ');
  return text.length > 180 ? text.slice(0, 177) + '…' : text || 'Open to read this report.';
}

export function WorkspaceReports({ workspace, busy: parentBusy }) {
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
    [revision, setRevision] = useState(0);
  const lock = useRef(false),
    baseline = useRef(blank),
    newReportButton = useRef(null),
    surface = useRef(null);
  useEnterMotion(surface, workspace.workspace_id, !loading);
  const owner = workspace.role === 'owner',
    viewer = workspace.role === 'viewer';
  const base = '/api/workspaces/' + encodeURIComponent(workspace.workspace_id) + '/reports';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api(base, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setReports(data.reports || []);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, revision]);
  useEffect(() => {
    if (!overlayOpen && !loading && message === 'Report deleted.') newReportButton.current?.focus();
  }, [overlayOpen, loading, message]);
  const disabled = busy || parentBusy || loading;
  const report = reports.find((item) => item.report_id === selected);
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
      setDraft((current) => ({ ...current, body: result.body }));
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
      const result = await api(base, { method: 'POST', body: draft });
      setDraft(null);
      setSelected(result.report_id);
      setRevision((value) => value + 1);
      setMessage(
        draft.published
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
    (['title', 'body', 'published'].some((field) => draft[field] !== baseline.current[field]) ||
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
    baseline.current = { ...report, published: false };
    setDraft({ ...baseline.current });
    setGoal('');
    setSource('');
  }
  async function deleteReport(item) {
    if (disabled || lock.current || viewer || !item.can_delete) return;
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
                <ReportEditor
                  {...{
                    draft,
                    setDraft,
                    owner,
                    disabled,
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
                  onClose={requestClose}
                />
              ) : report ? (
                <ReportReader
                  {...{ report, disabled, activity }}
                  onEdit={edit}
                  onDelete={deleteReport}
                  onDownload={downloadPdf}
                />
              ) : (
                <p className="report-overlay-notice" role="status">
                  {loading
                    ? 'Refreshing saved report…'
                    : 'Report saved. Close this view to return to your reports.'}
                </p>
              )}
            </>
          )}
        </ReportOverlay>
      )}
    </section>
  );
}
