import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { faqAnswerAnchor, faqGroups } from '../data/faq';
import { PublicHeader } from '../components/PublicHeader';
import { Icon } from '../components/Icon';
import { Link, useRouter } from '../lib/router';

const topics = faqGroups.map((group) => ({
  ...group,
  items: group.items.map((item, index) => ({
    ...item,
    key: group.id + '-' + index,
    anchor: faqAnswerAnchor(item.question),
  })),
}));

export default function FaqPage() {
  const { route } = useRouter();
  const anchor = route.split('#')[1];
  const linkedTopic = topics.find(
    (topic) => topic.id === anchor || topic.items.some((item) => item.anchor === anchor),
  );
  const activeTopic = linkedTopic?.id;
  const linkedAnswer = linkedTopic?.items.find((item) => item.anchor === anchor)?.key;
  const searchField = useRef(null);
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(new Set(['getting-started-0']));
  const groups = useMemo(
    () =>
      topics
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            (item.question + ' ' + item.search).toLowerCase().includes(search.trim().toLowerCase()),
          ),
        }))
        .filter((group) => group.items.length),
    [search],
  );
  const matches = groups.flatMap((group) => group.items);
  const allOpen = matches.length > 0 && matches.every((item) => opened.has(item.key));
  useEffect(() => {
    document.title = 'Frequently asked questions | Data Genie';
  }, []);
  useLayoutEffect(() => {
    if (!linkedAnswer) return;
    setSearch('');
    setOpened((previous) => new Set(previous).add(linkedAnswer));
  }, [linkedAnswer]);
  function filter(value) {
    setSearch(value);
    setOpened(
      new Set(
        value.trim()
          ? faqGroups.flatMap((group) => group.items.map((_, index) => group.id + '-' + index))
          : ['getting-started-0'],
      ),
    );
  }
  function toggle(key, value) {
    setOpened((previous) => {
      if (previous.has(key) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  return (
    <div className="faq-page">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <PublicHeader faq />
      <main className="wrap" id="main" tabIndex={-1}>
        <header className="faq-intro">
          <div>
            <h1>Frequently asked questions</h1>
            <p>
              Find answers about connecting databases, reviewing changes, and managing your data.
            </p>
          </div>
          <form
            className="search"
            role="search"
            aria-label="Search FAQs"
            onSubmit={(event) => event.preventDefault()}
          >
            <Icon name="search" />
            <input
              ref={searchField}
              type="search"
              value={search}
              onChange={(event) => filter(event.target.value)}
              placeholder="Search questions and answers…"
              aria-label="Search questions and answers"
              aria-controls="faqAnswers"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  filter('');
                  searchField.current.focus();
                }}
              >
                Clear
              </button>
            )}
          </form>
        </header>
        <div className="faq-layout">
          <aside className="topics" aria-label="FAQ topics">
            <h2>Browse by topic</h2>
            <nav aria-label="Jump to a topic">
              {faqGroups.map((group) => (
                <Link
                  key={group.id}
                  href={'/faq#' + group.id}
                  aria-current={activeTopic === group.id ? 'location' : undefined}
                  onClick={(event) => {
                    if (search) {
                      filter('');
                      if (anchor === group.id) {
                        event.preventDefault();
                        requestAnimationFrame(() => {
                          const heading = document.getElementById(group.id);
                          heading?.scrollIntoView();
                          heading?.focus({ preventScroll: true });
                        });
                      }
                    }
                  }}
                >
                  {group.title}
                </Link>
              ))}
            </nav>
          </aside>
          <div className="questions">
            <div className="faq-tools">
              <span role="status">
                {search.trim()
                  ? `${matches.length} matching ${matches.length === 1 ? 'question' : 'questions'}`
                  : `${matches.length} questions`}
              </span>
              <button
                className="text-button"
                type="button"
                disabled={!matches.length}
                onClick={() =>
                  setOpened(allOpen ? new Set() : new Set(matches.map((item) => item.key)))
                }
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            {!matches.length && (
              <p className="no-matches">
                No matching questions. Try “database”, “changes”, or “history”.
              </p>
            )}
            <div id="faqAnswers">
              {groups.map((group) => (
                <section
                  className="faq-group"
                  id={group.id}
                  key={group.id}
                  aria-labelledby={group.id + '-title'}
                  tabIndex={-1}
                >
                  <h2 id={group.id + '-title'}>{group.title}</h2>
                  {group.items.map((item) => (
                    <details
                      key={item.key}
                      open={opened.has(item.key)}
                      onToggle={(event) => toggle(item.key, event.currentTarget.open)}
                    >
                      <summary id={item.anchor} tabIndex={0}>
                        {item.question}
                        <span className="faq-disclosure" aria-hidden="true" />
                      </summary>
                      <div className="answer">{item.answer}</div>
                    </details>
                  ))}
                </section>
              ))}
            </div>
            <section className="next-step">
              <div>
                <h2>Still need help?</h2>
                <p>Get in touch about a question or a problem with Data Genie.</p>
              </div>
              <Link href="/contact">
                Contact us <Icon name="arrow" />
              </Link>
            </section>
          </div>
        </div>
      </main>
      <footer className="wrap foot">
        <span>Data Genie, by Adel Sissoko.</span>
        <div>
          <Link href="/contact">Contact us</Link> · <Link href="/">Homepage</Link>
        </div>
      </footer>
    </div>
  );
}
