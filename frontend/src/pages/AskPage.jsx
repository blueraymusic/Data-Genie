import { useLayoutEffect, useRef, useState } from 'react';
import { Translation } from '../components/CommandResult';
import { quoteIdentifier } from '../lib/api';
import { requestProblem } from '../lib/requestValidation';
export default function AskPage({ workbench, selected, mode, draft, setDraft, onNewTable }) {
  const textarea = useRef(null),
    end = useRef(null);
  const [validation, setValidation] = useState('');
  useLayoutEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 150) + 'px';
    }
  }, [draft]);
  useLayoutEffect(() => {
    if (workbench.feed.length) end.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [workbench.feed.length, workbench.busy]);
  const examples = selected
    ? [
        `show ${quoteIdentifier(selected)}`,
        `count ${quoteIdentifier(selected)}`,
        `show columns from ${quoteIdentifier(selected)}`,
      ]
    : ['show the structure of the database', 'create a table notes with a body'];
  async function ask(event) {
    event.preventDefault();
    if (!draft.trim() || workbench.busy || workbench.pending) return;
    const text = draft.trim();
    const problem = requestProblem(text, workbench.feed.length > 0);
    setValidation(problem);
    if (problem) {
      textarea.current?.focus();
      return;
    }
    setDraft('');
    await workbench.submit(text, false, mode, selected);
  }
  return (
    <section id="v-ask" className={workbench.feed.length ? 'has-requests' : undefined}>
      <div className="workspace-intro">
        <h1>Ask in plain English.</h1>
        <p className="lead">
          Your words on the left. The SQL on the right. The result, on the record.
        </p>
        {!workbench.session.tables.length && (
          <p className="empty-inline">
            This database is empty. Start with a new table or ask Data Genie to create one.
          </p>
        )}
        <div className="chips">
          {examples.map((example) => (
            <button
              type="button"
              key={example}
              disabled={workbench.busy || workbench.pending}
              onClick={() => {
                setDraft(example);
                setValidation('');
                textarea.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
      <div id="feed" aria-live="polite">
        {workbench.feed.map((request) => (
          <Translation
            key={request.request_id}
            request={request}
            workbench={workbench}
            onUseSuggestion={(suggestion) => {
              setDraft(suggestion);
              setValidation('');
              textarea.current?.focus();
            }}
          />
        ))}
      </div>
      <div ref={end} />
      <div className="composer">
        {workbench.feed.length > 0 && (
          <div className="conversation-tools">
            <span>Follow-ups use recent requests in this database.</span>
            <button
              type="button"
              className="text-button"
              disabled={workbench.busy || workbench.pending}
              onClick={async () => {
                if (await workbench.newConversation()) {
                  setDraft('');
                  setValidation('');
                  textarea.current?.focus();
                }
              }}
            >
              New conversation
            </button>
          </div>
        )}
        <div className="composer-tools">
          <label className="composer-label" htmlFor="request-input">
            {workbench.feed.length ? 'Follow up or ask a new question' : 'Your next request'}
          </label>
          <button
            className="text-button"
            onClick={onNewTable}
            disabled={workbench.busy || workbench.pending}
          >
            New table
          </button>
          <span>Changes always wait for your OK.</span>
        </div>
        <form className="ask" onSubmit={ask}>
          <textarea
            id="request-input"
            ref={textarea}
            rows="1"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidation('');
            }}
            disabled={workbench.busy || workbench.pending}
            aria-label="Ask in plain English"
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? 'request-validation' : 'composer-hint'}
            placeholder={
              workbench.pending
                ? 'Review the pending change above to continue.'
                : workbench.feed.length
                  ? 'Ask a follow-up, or start a new question…'
                  : 'Ask in plain English…'
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form.requestSubmit();
              }
            }}
          />
          <button
            className="btn pri"
            disabled={workbench.busy || workbench.pending || !draft.trim()}
          >
            {workbench.busy ? 'Writing…' : 'Ask'}
          </button>
        </form>
        {validation && (
          <p className="request-validation" id="request-validation" role="alert">
            {validation}
          </p>
        )}
        <p className="composer-hint" id="composer-hint">
          {mode === 'gemini' ? 'Gemini AI' : 'Keywords'} · Enter to ask. Shift + Enter for a new
          line.
        </p>
      </div>
    </section>
  );
}
