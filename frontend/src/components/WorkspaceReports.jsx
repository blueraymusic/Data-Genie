import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const template = 'Summary\n\nKey findings\n• \n\nEvidence\n\nNext steps\n\nLimitations\n';
const blank = { title: '', body: '', published: false };

export function WorkspaceReports({ workspace, busy: parentBusy }) {
  const [reports, setReports] = useState([]),
    [selected, setSelected] = useState(null),
    [draft, setDraft] = useState(null),
    [goal, setGoal] = useState(''),
    [source, setSource] = useState(''),
    [ai, setAi] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  const lock = useRef(false);
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
          setError('');
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
  const disabled = busy || parentBusy || loading;
  const report = reports.find((item) => item.report_id === selected);
  function open(item) {
    setSelected(item?.report_id || null);
    setDraft(null);
    setAi(false);
    setError('');
    setMessage('');
  }
  function create(body = '') {
    open(null);
    setDraft({ ...blank, body });
    setGoal('');
    setSource('');
  }
  async function generate() {
    if (disabled || lock.current || viewer) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api(base + '/generate', { method: 'POST', body: { goal, source } });
      setDraft((current) => ({ ...current, body: result.body }));
      setAi(false);
      setMessage('AI draft ready. Check its facts and edit before saving.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (disabled || lock.current || viewer) return;
    lock.current = true;
    setBusy(true);
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
    }
  }
  return (
    <section className="workspace-reports" aria-label="Workspace reports">
      <header className="workspace-section-heading">
        <div>
          <h2>{viewer ? 'Shared reports' : 'Reports'}</h2>
          <p className="small muted">
            {viewer
              ? 'Reports approved and shared by your workspace owner.'
              : 'Write a draft, review the facts, then ask the owner to share it.'}
          </p>
        </div>
        {!viewer && !draft && (
          <button className="btn pri" disabled={disabled} onClick={() => create()}>
            New report
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      {loading && (
        <p className="workspace-loading" role="status">
          Loading reports…
        </p>
      )}
      <div className="reports-layout">
        <nav className="reports-list" aria-label="Saved reports">
          {reports.map((item) => (
            <button
              key={item.report_id}
              aria-current={selected === item.report_id ? 'page' : undefined}
              disabled={disabled || Boolean(draft)}
              onClick={() => open(item)}
            >
              <strong>{item.title}</strong>
              <small>
                {item.published ? 'Shared' : 'Draft'} · {item.first_name}
              </small>
            </button>
          ))}
          {!loading && !reports.length && (
            <p className="small muted">
              {viewer
                ? 'No reports have been shared yet.'
                : 'No reports yet. Start with a blank page or a template.'}
            </p>
          )}
        </nav>
        <div className="report-document">
          {draft ? (
            <form className="report-editor" onSubmit={save}>
              <div className="report-tools">
                <button
                  type="button"
                  className="btn quiet"
                  disabled={disabled || Boolean(draft.body.trim())}
                  onClick={() => setDraft((value) => ({ ...value, body: template }))}
                >
                  Use a template
                </button>
                <button
                  type="button"
                  className="btn quiet"
                  disabled={disabled}
                  onClick={() => setAi((value) => !value)}
                >
                  Draft with Data Genie AI
                </button>
              </div>
              <label>
                Report title
                <input
                  required
                  autoFocus
                  maxLength={120}
                  value={draft.title}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, title: event.target.value }))
                  }
                />
              </label>
              {ai && (
                <div className="report-ai-context">
                  <label>
                    What should the report cover?
                    <input
                      maxLength={1000}
                      value={goal}
                      disabled={disabled}
                      onChange={(event) => setGoal(event.target.value)}
                    />
                  </label>
                  <label>
                    Source notes or query results
                    <textarea
                      rows={3}
                      maxLength={12000}
                      value={source}
                      disabled={disabled}
                      onChange={(event) => setSource(event.target.value)}
                    />
                  </label>
                  <p className="small muted">
                    Only these notes are sent to Data Genie AI. No database queries run. Generating
                    replaces the report text; review before saving.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    disabled={disabled || !goal.trim() || !source.trim()}
                    onClick={generate}
                  >
                    {busy ? 'Preparing draft…' : 'Generate draft'}
                  </button>
                </div>
              )}
              <label className="report-body-label">
                Report
                <textarea
                  required
                  maxLength={20000}
                  value={draft.body}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, body: event.target.value }))
                  }
                />
              </label>
              <footer className="report-actions">
                {owner ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.published}
                      disabled={disabled}
                      onChange={(event) =>
                        setDraft((value) => ({ ...value, published: event.target.checked }))
                      }
                    />
                    Share with all workspace members and viewers
                  </label>
                ) : (
                  <span className="small muted">The owner reviews drafts before sharing.</span>
                )}
                <button
                  type="button"
                  className="btn quiet"
                  disabled={disabled}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn pri"
                  disabled={disabled || !draft.title.trim() || !draft.body.trim()}
                >
                  {busy ? 'Saving…' : 'Save report'}
                </button>
              </footer>
            </form>
          ) : report ? (
            <article className="report-reading">
              <header>
                <div>
                  <span className="eyebrow">
                    {report.published ? 'Shared report' : 'Draft · private to author & owner'}
                  </span>
                  <h3>{report.title}</h3>
                </div>
                {report.can_edit && (
                  <button
                    className="btn"
                    disabled={disabled}
                    onClick={() => setDraft({ ...report, published: false })}
                  >
                    Edit report
                  </button>
                )}
              </header>
              <p className="report-text">{report.body}</p>
              <p className="small muted">
                {report.first_name} {report.last_name} · Updated{' '}
                {new Date(report.updated_at * 1000).toLocaleString()}
              </p>
            </article>
          ) : (
            <div className="report-placeholder">
              <h3>
                {viewer
                  ? 'A clear view of the findings.'
                  : 'Turn findings into something you can share.'}
              </h3>
              <p className="muted">
                {viewer
                  ? 'Choose a shared report to read it here.'
                  : 'Choose a report or start a new one. Drafts stay private until the owner shares them.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
