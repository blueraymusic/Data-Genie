import { useLayoutEffect, useRef, useState } from 'react';
import { Translation } from '../components/CommandResult';
import { quoteIdentifier } from '../lib/api';
import { requestProblem } from '../lib/requestValidation';
export default function AskPage({ workbench, selected, mode, draft, setDraft, onNewTable }) {
  const textarea = useRef(null),
    feed = useRef(null),
    wasBlocked = useRef(false);
  const [validation, setValidation] = useState('');
  const context = workbench.session.conversation_context;
  const contextTables = context?.tables || [];
  const changedTable = Boolean(
    selected && contextTables.length && !contextTables.includes(selected),
  );
  useLayoutEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 150) + 'px';
    }
  }, [draft]);
  useLayoutEffect(() => {
    const latest = feed.current?.lastElementChild;
    if (!workbench.feed.length || !latest) return;
    latest.scrollIntoView({ block: 'start', behavior: 'auto' });
    const container = feed.current.closest('.content'),
      composer = container?.querySelector('.composer');
    if (composer) {
      const overlap = latest.getBoundingClientRect().bottom - composer.getBoundingClientRect().top;
      if (overlap > 0) container.scrollTo({ top: container.scrollTop + overlap, behavior: 'auto' });
    }
  }, [workbench.feed.length, workbench.busy]);
  useLayoutEffect(() => {
    const blocked = Boolean(workbench.busy || workbench.pending);
    if (wasBlocked.current && !blocked) textarea.current?.focus({ preventScroll: true });
    if (workbench.pending && !workbench.busy)
      feed.current?.lastElementChild?.querySelector('.confirm')?.focus({ preventScroll: true });
    wasBlocked.current = blocked;
  }, [workbench.busy, workbench.pending]);
  const examples = selected
    ? [
        `show ${quoteIdentifier(selected)}`,
        `count ${quoteIdentifier(selected)}`,
        `show columns from ${quoteIdentifier(selected)}`,
      ]
    : workbench.session.read_only
      ? ['show the structure of the database']
      : ['show the structure of the database', 'create a table notes with a body'];
  async function ask(event) {
    event.preventDefault();
    if (!draft.trim() || workbench.busy || workbench.pending) return;
    const text = draft.trim();
    const previous = workbench.feed.at(-1);
    const answering = Boolean(
      workbench.session.pending_intent ||
      (previous &&
        (previous.needs_clarification ||
          previous.intent ||
          (previous.error &&
            previous.status === 'rejected' &&
            !previous.error.startsWith('Gemini')))),
    );
    const problem = requestProblem(text, workbench.feed.length > 0, answering);
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
            {workbench.session.read_only ? (
              'This schema has no readable tables. Choose another schema, or add a connection with changes enabled.'
            ) : (
              <>
                This database is empty.{' '}
                <button type="button" className="text-button" onClick={onNewTable}>
                  Create your first table
                </button>
                , or describe the table you need below.
              </>
            )}
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
      <div id="feed" ref={feed} aria-live="polite">
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
      <div className="composer">
        {workbench.session.pending_intent && (
          <p className="pending-intent" title={workbench.session.pending_intent}>
            <strong>Working on:</strong> {workbench.session.pending_intent}
          </p>
        )}
        <div className="conversation-tools">
          <div
            className="conversation-context"
            aria-label="Conversation context"
            title={context?.request || undefined}
          >
            <span className="context-dot" aria-hidden="true" />
            <span>
              {changedTable
                ? `Using ${selected} · selected table changed`
                : contextTables.length
                  ? `Following up on ${contextTables.join(', ')}`
                  : selected
                    ? `Using ${selected}`
                    : 'Ready for your first table'}
              {!changedTable && context?.filters?.length > 0 && (
                <span className="context-filters"> · {context.filters.join(' · ')}</span>
              )}
            </span>
          </div>
          {workbench.feed.length > 0 && (
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
          )}
        </div>
        <div className="composer-tools">
          <label className="composer-label" htmlFor="request-input">
            {workbench.feed.length ? 'Follow up or ask a new question' : 'Your next request'}
          </label>
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
                  ? 'Ask a follow-up…'
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
          Enter to ask · Shift + Enter for a new line · Changes wait for your OK.
        </p>
      </div>
    </section>
  );
}
