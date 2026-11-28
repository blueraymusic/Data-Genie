import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useDismissMotion, useReducedMotion } from '../hooks/useMotion';
import { findHelpAnswers, suggestHelpAnswers } from '../lib/helpAnswers';
import { Link } from '../lib/router';
import { Icon } from './Icon';
import { Modal } from './Modal';

const starters = [
  'How does Data Genie work?',
  'How do I connect PostgreSQL?',
  'How do I replay the walkthrough?',
];

const followUps = new Map([
  ['What can I do with Data Genie?', ['Which database files can I upload?', starters[1]]],
  [
    'How do I connect PostgreSQL?',
    [
      'Why won’t my saved PostgreSQL connection open?',
      'Why is my PostgreSQL connection read-only?',
    ],
  ],
  [
    'How do I replay the walkthrough?',
    ['Can I try Data Genie without an account?', 'How do I get my first database?'],
  ],
]);

function HelpMascot() {
  return (
    <span className="help-mascot" aria-hidden="true">
      <span className="help-mascot-face" />
    </span>
  );
}

function HelpSuggestions({ questions, label, onAsk }) {
  return (
    <div className="help-chat-suggestions" role="group" aria-label={label}>
      {questions.map((question) => (
        <button key={question} type="button" onClick={() => onAsk(question)}>
          <span>{question}</span>
          <Icon name="arrow" className="ic help-chat-suggestion-arrow" />
        </button>
      ))}
    </div>
  );
}

export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([]);
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef(null);
  const transcript = useRef(null);
  const latest = useRef(null);
  const composer = useRef(null);
  const focusReply = useRef(false);
  const followNewTurn = useRef(false);
  const nextId = useRef(0);
  const pending = useRef(null);
  const latestId = messages.at(-1)?.id;
  const searching = messages.at(-1)?.searching;
  const reduced = useReducedMotion();
  const { dismiss, closing } = useDismissMotion(panel, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open || !latest.current) return;
    const log = transcript.current;
    const top = Math.max(0, latest.current.offsetTop - 12);
    if (followNewTurn.current && !reduced && typeof log.scrollTo === 'function')
      log.scrollTo({ top, behavior: 'smooth' });
    else log.scrollTop = top;
    if (focusReply.current)
      latest.current.querySelector('[tabindex="-1"]')?.focus({ preventScroll: true });
    focusReply.current = false;
    followNewTurn.current = false;
  }, [open, latestId, reduced]);

  useEffect(() => () => pending.current?.abort(), []);

  async function ask(value, fromSuggestion = false) {
    const question = value.trim();
    if (!question || pending.current) return;
    const answers = findHelpAnswers(question);
    const request = answers.length ? null : new AbortController();
    pending.current = request;
    const id = ++nextId.current;
    focusReply.current = fromSuggestion;
    followNewTurn.current = true;
    setMessages((previous) => [
      ...previous.slice(-15),
      { id, question, answers, searching: Boolean(request) },
    ]);
    setDraft('');
    if (!request) return;
    const matches = await suggestHelpAnswers(question, request.signal);
    if (request.signal.aborted) return;
    pending.current = null;
    setMessages((previous) =>
      previous.map((turn) =>
        turn.id === id ? { ...turn, answers: matches, searching: false } : turn,
      ),
    );
  }

  return (
    <>
      <button
        className="help-chat-trigger"
        type="button"
        aria-label="Open Data Genie help chat"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Data Genie help"
        onClick={() => setOpen(true)}
      >
        <HelpMascot />
        <span className="help-chat-trigger-label">Help</span>
      </button>
      {open && (
        <Modal
          className={messages.length ? 'help-chat-panel has-messages' : 'help-chat-panel'}
          titleId={titleId}
          descriptionId={descriptionId}
          panelRef={panel}
          closing={closing}
          onClose={dismiss}
        >
          <header className="help-chat-header">
            <HelpMascot />
            <div>
              <h2 id={titleId}>Data Genie help</h2>
              <p id={descriptionId}>Answers from the Data Genie FAQ</p>
            </div>
            <div className="help-chat-header-actions">
              {messages.length > 0 && (
                <button
                  className="help-chat-icon-button"
                  type="button"
                  aria-label="Start a new help chat"
                  title="New chat"
                  onClick={() => {
                    pending.current?.abort();
                    pending.current = null;
                    setMessages([]);
                    setDraft('');
                    composer.current?.focus();
                  }}
                >
                  <Icon name="replay" />
                </button>
              )}
              <button
                className="help-chat-icon-button"
                type="button"
                aria-label="Close help chat"
                onClick={dismiss}
              >
                <Icon name="x" />
              </button>
            </div>
          </header>
          <div className="help-chat-log" role="log" aria-label="Help conversation" ref={transcript}>
            {!messages.length && (
              <div className="help-chat-welcome">
                <p className="help-chat-greeting">How can I help?</p>
                <p className="help-chat-intro">
                  Ask about getting started, connecting a database, or using your workspace.
                </p>
                <HelpSuggestions
                  questions={starters}
                  label="Suggested questions"
                  onAsk={(question) => ask(question, true)}
                />
              </div>
            )}
            {messages.map(({ id, question, answers, searching: waiting }, index) => {
              const isLatest = index === messages.length - 1;
              const related =
                isLatest && (answers.length ? followUps.get(answers[0].question) : starters);
              return (
                <div className="help-chat-turn" key={id} ref={isLatest ? latest : undefined}>
                  <p className="help-chat-question">{question}</p>
                  <div className="help-chat-answer">
                    {waiting ? (
                      <p role="status">Looking for a matching FAQ answer…</p>
                    ) : answers.length === 1 ? (
                      <>
                        <h3 tabIndex={-1}>{answers[0].question}</h3>
                        {answers[0].answer}
                        <Link
                          className="help-chat-source"
                          href={answers[0].href}
                          onClick={() => setOpen(false)}
                        >
                          <Icon name="report" /> Read this in the FAQ
                        </Link>
                      </>
                    ) : answers.length ? (
                      <>
                        <h3 tabIndex={-1}>Which of these did you mean?</h3>
                        <HelpSuggestions
                          questions={answers.map((answer) => answer.question)}
                          label="Related questions"
                          onAsk={(question) => ask(question, true)}
                        />
                      </>
                    ) : (
                      <>
                        <h3 tabIndex={-1}>I couldn’t find an answer in the Data Genie FAQ.</h3>
                        <p>Try one of the suggested questions, or browse the full FAQ.</p>
                        <Link
                          className="help-chat-source"
                          href="/faq"
                          onClick={() => setOpen(false)}
                        >
                          <Icon name="report" /> Browse the FAQ
                        </Link>
                      </>
                    )}
                    {!waiting && related && answers.length < 2 && (
                      <HelpSuggestions
                        questions={related}
                        label="Suggested follow-up questions"
                        onAsk={(question) => ask(question, true)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="help-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <div className="help-chat-composer">
              <input
                ref={composer}
                type="text"
                aria-label="Ask about Data Genie"
                placeholder="Ask about Data Genie…"
                value={draft}
                maxLength={280}
                autoComplete="off"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                className="help-chat-send"
                type="submit"
                aria-label="Send question"
                disabled={searching || !draft.trim()}
              >
                <Icon name="send" />
              </button>
            </div>
            <p className="help-chat-privacy">
              Unmatched questions may be sent to Google Gemini. Leave out passwords and keys.
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}
