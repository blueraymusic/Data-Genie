import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

const template = 'Summary\n\nKey findings\n• \n\nEvidence\n\nNext steps\n\nLimitations\n';

export function ReportEditor({
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
  onClose,
}) {
  const titleInput = useRef(null);
  const assistantId = useId();
  const [preview, setPreview] = useState(false);
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/u).length : 0;
  useEffect(() => {
    if (!preview) titleInput.current?.focus();
  }, [preview]);
  return (
    <form className="report-editor" onSubmit={save}>
      <div className="report-editor-layout">
        <aside className="report-writing-tools" aria-label="Writing tools">
          <div className="report-tools-heading">
            <p className="eyebrow">Writing tools</p>
            <h3>Make sense of your findings.</h3>
            <p>Start with your words. Add the evidence that matters.</p>
          </div>
          <div className="report-tools">
            <button
              type="button"
              className="report-tool"
              aria-label="Use a template"
              disabled={disabled || Boolean(draft.body.trim())}
              onClick={() => setDraft((value) => ({ ...value, body: template }))}
            >
              <Icon name="layers" />
              <span>
                <strong>Use a template</strong>
                <small>Summary, findings, next steps</small>
              </span>
            </button>
            <button
              type="button"
              className="report-tool"
              aria-label="Draft with Data Genie AI"
              disabled={disabled}
              aria-expanded={ai}
              aria-controls={assistantId}
              onClick={() => setAi((value) => !value)}
            >
              <Icon name="report" />
              <span>
                <strong>Draft with Data Genie AI</strong>
                <small>Turn your notes into a first draft</small>
              </span>
            </button>
          </div>
          {ai && (
            <section
              id={assistantId}
              className="report-ai-context"
              aria-label="Draft with Data Genie"
            >
              <label>
                What should the report cover?
                <input
                  maxLength={1000}
                  value={goal}
                  disabled={disabled}
                  placeholder="e.g. This month’s sales"
                  onChange={(event) => setGoal(event.target.value)}
                />
              </label>
              <label>
                Source notes or query results
                <textarea
                  rows={5}
                  maxLength={12000}
                  value={source}
                  disabled={disabled}
                  placeholder="Paste the evidence for your report…"
                  onChange={(event) => setSource(event.target.value)}
                />
              </label>
              <p className="small muted">
                Only these notes are used. No database queries run. Generating replaces the report
                text.
              </p>
              <button
                type="button"
                className="btn pri"
                disabled={disabled || !goal.trim() || !source.trim()}
                onClick={generate}
              >
                {activity === 'generate' ? 'Preparing draft…' : 'Generate draft'}
              </button>
            </section>
          )}
          <p className="report-writing-note">
            <Icon name="check" />
            Review, then share. Nothing is saved or shared automatically.
          </p>
        </aside>
        <div className="report-editor-main">
          <div className="report-document-toolbar">
            <div className="report-view-switch" role="group" aria-label="Report view">
              <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                Write
              </button>
              <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                Preview
              </button>
            </div>
            <span className="report-word-count">
              {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
            </span>
          </div>
          <div className="report-editor-sheet">
            <div className="report-paper-kicker">
              <span className="report-status-badge">
                {draft.published ? 'Ready to share' : 'Private draft'}
              </span>
              <Icon name="report" />
            </div>
            {preview ? (
              <article className="report-preview" aria-label="Report preview">
                <h3>{draft.title.trim() || 'Untitled report'}</h3>
                <p className={'report-text' + (!draft.body.trim() ? ' muted' : '')}>
                  {draft.body || 'Your report will appear here as you write.'}
                </p>
              </article>
            ) : (
              <>
                <label className="report-title-label">
                  <span>Report title</span>
                  <input
                    required
                    ref={titleInput}
                    maxLength={120}
                    value={draft.title}
                    disabled={disabled}
                    placeholder="Give your report a title"
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, title: event.target.value }))
                    }
                  />
                </label>
                <label className="report-body-label">
                  <span>Report</span>
                  <textarea
                    required
                    maxLength={20000}
                    value={draft.body}
                    disabled={disabled}
                    placeholder="What did you find? Start writing here…"
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, body: event.target.value }))
                    }
                  />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
      <footer className="report-actions">
        {owner ? (
          <label className="report-share-choice">
            <input
              type="checkbox"
              checked={draft.published}
              disabled={disabled}
              onChange={(event) =>
                setDraft((value) => ({ ...value, published: event.target.checked }))
              }
            />
            <span>
              Share with all workspace members and viewers
              <small>
                {draft.published
                  ? 'Everyone in this workspace can read it after you save.'
                  : 'Keep unchecked to save a private draft.'}
              </small>
            </span>
          </label>
        ) : (
          <span className="report-save-note">
            <Icon name="check" />
            Private draft · The owner reviews before sharing.
          </span>
        )}
        <div className="report-save-actions">
          <button type="button" className="btn quiet" disabled={disabled} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn pri"
            disabled={disabled || !draft.title.trim() || !draft.body.trim()}
          >
            {activity === 'save' ? 'Saving…' : 'Save report'}
            {!busy && <Icon name="arrow" />}
          </button>
        </div>
      </footer>
    </form>
  );
}
