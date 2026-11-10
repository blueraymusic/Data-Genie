import { useLayoutEffect, useRef, useState } from 'react';
import { Translation } from '../components/CommandResult';
import { quoteIdentifier } from '../lib/api';
import { Link } from '../lib/router';
import { requestProblem } from '../lib/requestValidation';
import { Icon } from '../components/Icon';
import { useRequestWindow } from '../hooks/useRequestWindow';
import { RequestWindowControls } from '../components/RequestWindowControls';
import { databaseAccess } from '../lib/access';
export default function AskPage({ workbench, selected, draft, setDraft, onNewTable }) {
  const textarea = useRef(null),
    feed = useRef(null),
    wasBlocked = useRef(false),
    lastJump = useRef(0);
  const [validation, setValidation] = useState(''),
    [attachments, setAttachments] = useState([]),
    [readingFiles, setReadingFiles] = useState(false);
  useLayoutEffect(() => {
    setAttachments([]);
  }, [workbench.session.session_id]);
  const requestWindow = useRequestWindow(workbench.feed, workbench.session.session_id);
  const aiAvailable = Boolean(workbench.session.ai?.enabled);
  const canChangeStructure = databaseAccess(workbench.session).permissions.structure;
  const blocked =
    !aiAvailable ||
    readingFiles ||
    !databaseAccess(workbench.session).canRead ||
    workbench.busy ||
    workbench.pending ||
    workbench.workingCommands?.size > 0;
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
    if (requestWindow.viewingEarlier) return;
    const jumping = lastJump.current !== requestWindow.jumpVersion;
    lastJump.current = requestWindow.jumpVersion;
    const latest =
      (!jumping &&
        workbench.pending &&
        feed.current?.querySelector('.confirm')?.closest('.exchange')) ||
      feed.current?.lastElementChild;
    if (!workbench.feed.length || !latest) return;
    latest.scrollIntoView({ block: 'start', behavior: 'auto' });
    const container = feed.current.closest('.content'),
      composer = container?.querySelector('.composer');
    if (composer) {
      const overlap = latest.getBoundingClientRect().bottom - composer.getBoundingClientRect().top;
      if (overlap > 0) container.scrollTo({ top: container.scrollTop + overlap, behavior: 'auto' });
    }
  }, [
    workbench.session.session_id,
    requestWindow.latestRequestId,
    requestWindow.viewingEarlier,
    requestWindow.jumpVersion,
    workbench.busy,
    workbench.pending,
    workbench.workingCommands?.size,
  ]);
  useLayoutEffect(() => {
    const blocked = Boolean(workbench.busy || workbench.pending);
    if (wasBlocked.current && !blocked) textarea.current?.focus({ preventScroll: true });
    if (workbench.pending && !workbench.busy)
      feed.current?.querySelector('.confirm')?.focus({ preventScroll: true });
    wasBlocked.current = blocked;
  }, [workbench.busy, workbench.pending]);
  const examples = selected
    ? [
        `show ${quoteIdentifier(selected)}`,
        `count ${quoteIdentifier(selected)}`,
        `show columns from ${quoteIdentifier(selected)}`,
      ]
    : !canChangeStructure
      ? ['show the structure of the database']
      : ['show the structure of the database', 'create a table notes with a body'];
  async function ask(event) {
    event.preventDefault();
    if (!draft.trim() || blocked) return;
    const text = draft.trim();
    const previous = workbench.feed.at(-1);
    const answering = Boolean(
      workbench.session.pending_intent ||
      (previous &&
        (previous.needs_clarification ||
          previous.intent ||
          (previous.error &&
            previous.status === 'rejected' &&
            !['Data Genie AI', 'Gemini'].some((prefix) => previous.error.startsWith(prefix))))),
    );
    const problem = requestProblem(text, workbench.feed.length > 0, answering);
    setValidation(problem);
    if (problem) {
      textarea.current?.focus();
      return;
    }
    setDraft('');
    let result;
    if (attachments.length)
      result = await workbench.submit(
        text,
        false,
        'gemini',
        selected,
        attachments.map(({ mime_type, data }) => ({ mime_type, data })),
      );
    else result = await workbench.submit(text, false, 'gemini', selected);
    if (result && result.matched !== false) setAttachments([]);
  }
  return (
    <section id="v-ask" className={workbench.feed.length ? 'has-requests' : undefined}>
      <div className="workspace-intro">
        <h1>Ask your database.</h1>
        <p className="lead">
          Ask a question, see the SQL, and work with the answer. You can follow up here.
        </p>
        {!aiAvailable && (
          <p className="status-note" role="status">
            Data Genie AI is unavailable. <Link href="/app?view=sql">Open SQL</Link> to run
            statements without an AI service.
          </p>
        )}
        {!workbench.session.tables.length && (
          <p className="empty-inline">
            {!canChangeStructure ? (
              'This database has no tables yet. A workspace owner can add one or give you permission to change its structure.'
            ) : (
              <>
                This database is empty.{' '}
                <button type="button" className="text-button" onClick={onNewTable}>
                  Create your first table
                </button>
                {aiAvailable ? ', or describe the table you need below.' : '.'}
              </>
            )}
          </p>
        )}
        <div className="chips">
          {examples.map((example, index) => (
            <button
              type="button"
              key={example}
              aria-label={example}
              disabled={blocked}
              onClick={() => {
                setDraft(example);
                setValidation('');
                textarea.current?.focus();
              }}
            >
              <span>
                <strong>
                  {selected
                    ? ['Preview rows', 'Count records', 'Explore columns'][index]
                    : ['Explore the structure', 'Create a table'][index]}
                </strong>
                <span>{example}</span>
              </span>
              <Icon name="arrow" className="ic suggestion-arrow" />
            </button>
          ))}
        </div>
      </div>
      <RequestWindowControls window={requestWindow} feedId="feed" />
      <div id="feed" ref={feed} aria-live="polite">
        {requestWindow.requests.map((request) => (
          <Translation
            key={request.request_id}
            request={request}
            workbench={workbench}
            compactResult={request.request_id !== requestWindow.latestRequestId}
            onUseSuggestion={
              aiAvailable
                ? (suggestion) => {
                    setDraft(suggestion);
                    setValidation('');
                    textarea.current?.focus();
                  }
                : undefined
            }
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
          <div className="conversation-actions">
            {requestWindow.total > 1 && (
              <button
                type="button"
                className="text-button"
                aria-controls="feed"
                onClick={requestWindow.jumpToLatest}
              >
                Jump to latest
              </button>
            )}
            {workbench.feed.length > 0 && (
              <button
                type="button"
                className="text-button"
                disabled={blocked}
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
        </div>
        <div className="composer-tools">
          <label className="context-upload">
            {readingFiles ? 'Reading files…' : 'Attach PDF or image'}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              disabled={blocked}
              onChange={async (event) => {
                const files = [...event.target.files];
                event.target.value = '';
                if (
                  files.length + attachments.length > 2 ||
                  files.reduce(
                    (sum, file) => sum + file.size,
                    attachments.reduce((sum, file) => sum + file.size, 0),
                  ) >
                    4 * 1024 * 1024
                ) {
                  setValidation('Attach up to two files, 4 MB combined.');
                  return;
                }
                setReadingFiles(true);
                try {
                  if (
                    files.some(
                      (file) =>
                        !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(
                          file.type,
                        ),
                    )
                  )
                    throw new Error('Use PDF, PNG, JPEG or WebP files.');
                  const loaded = await Promise.all(
                    files.map(
                      (file) =>
                        new Promise((resolve, reject) => {
                          const reader = new FileReader();
                          reader.onerror = () =>
                            reject(new Error('Could not read the attachment.'));
                          reader.onload = () =>
                            resolve({
                              name: file.name,
                              size: file.size,
                              mime_type: file.type,
                              data: String(reader.result).split(',')[1],
                            });
                          reader.readAsDataURL(file);
                        }),
                    ),
                  );
                  setAttachments((current) => [...current, ...loaded]);
                  setValidation('');
                } catch (error) {
                  setValidation(error.message);
                } finally {
                  setReadingFiles(false);
                }
              }}
            />
          </label>
          <label className="composer-label" htmlFor="request-input">
            {workbench.feed.length ? 'Follow up or ask a new question' : 'Your next request'}
          </label>
        </div>
        {attachments.length > 0 && (
          <div className="context-files">
            <span className="small muted">
              Sent to Data Genie AI for this request only; not saved.
            </span>
            {attachments.map((file, index) => (
              <button
                type="button"
                className="btn quiet"
                key={index}
                disabled={blocked}
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
              >
                Remove {file.name}
              </button>
            ))}
          </div>
        )}
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
            disabled={blocked}
            aria-label="Ask in plain English"
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? 'request-validation' : 'composer-hint'}
            placeholder={
              !aiAvailable
                ? 'Data Genie AI is unavailable. Open the SQL tab to continue.'
                : workbench.pending
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
          <button className="btn pri" disabled={blocked || !draft.trim()}>
            {workbench.busy ? 'Writing…' : 'Ask'}
            {!workbench.busy && <Icon name="send" />}
          </button>
        </form>
        {validation && (
          <p className="request-validation" id="request-validation" role="alert">
            {validation}
          </p>
        )}
        <p className="composer-hint" id="composer-hint">
          {aiAvailable
            ? 'Enter to ask · Shift + Enter for a new line · Changes wait for your OK.'
            : 'SQL works without AI. Choose the SQL tab to write a statement.'}
        </p>
      </div>
    </section>
  );
}
