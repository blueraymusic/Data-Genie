import { useEffect, useMemo, useState } from 'react';
import { faqGroups } from '../data/faq';
import { PublicHeader, EntryLink } from '../components/PublicHeader';
import { Icon } from '../components/Icon';
import { Link } from '../lib/router';
import { useAuth } from '../context/AuthContext';

export default function FaqPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(new Set(['getting-started-0']));
  const groups = useMemo(
    () =>
      faqGroups
        .map((group) => ({
          ...group,
          items: group.items
            .map((item, index) => ({ ...item, key: group.id + '-' + index }))
            .filter((item) =>
              (item.question + ' ' + item.search)
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
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
    <div className="faq-page" data-authenticated={user ? 'true' : undefined}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <PublicHeader faq />
      <main className="wrap" id="main">
        <div className="intro">
          <p className="eyebrow">A little clarity</p>
          <h1>
            Questions about
            <br />
            Data Genie.
          </h1>
          <p className="lede">
            How it works, where your data goes, and what happens before a change runs.
          </p>
        </div>
        <div className="faq-layout">
          <aside className="topics" aria-label="FAQ topics">
            <p className="eyebrow">On this page</p>
            <nav aria-label="Jump to a topic">
              {faqGroups.map((group) => (
                <a
                  key={group.id}
                  href={'#' + group.id}
                  onClick={(event) => {
                    if (search) {
                      event.preventDefault();
                      filter('');
                      requestAnimationFrame(() =>
                        document.getElementById(group.id)?.scrollIntoView(),
                      );
                    }
                  }}
                >
                  {group.title}
                </a>
              ))}
            </nav>
            <p className="topic-note">
              Your words. The SQL.
              <br />A clear record of both.
            </p>
          </aside>
          <div className="questions">
            <form
              className="search"
              role="search"
              aria-label="Search FAQs"
              onSubmit={(event) => event.preventDefault()}
            >
              <Icon name="search" />
              <input
                type="search"
                value={search}
                onChange={(event) => filter(event.target.value)}
                placeholder="Search questions and answers…"
                aria-label="Search questions and answers"
                aria-controls="faqAnswers"
              />
              {search && (
                <button type="button" onClick={() => filter('')}>
                  Clear
                </button>
              )}
            </form>
            <div className="faq-tools">
              <span role="status">
                {search.trim()
                  ? `${matches.length} matching ${matches.length === 1 ? 'question' : 'questions'}`
                  : 'Browse the topics below'}
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
                >
                  <h2 id={group.id + '-title'}>{group.title}</h2>
                  {group.items.map((item) => (
                    <details
                      key={item.key}
                      open={opened.has(item.key)}
                      onToggle={(event) => toggle(item.key, event.currentTarget.open)}
                    >
                      <summary>
                        {item.question}
                        <span aria-hidden="true" />
                      </summary>
                      <div className="answer">{item.answer}</div>
                    </details>
                  ))}
                </section>
              ))}
            </div>
            <section className="next-step">
              <h2>Put your first question to work.</h2>
              <p>Bring a SQLite file, connect PostgreSQL, start fresh, or explore the sample.</p>
              <EntryLink primary className="btn primary" />
              <Link className="back-link" href="/">
                Back to homepage <span aria-hidden="true">↗</span>
              </Link>
            </section>
          </div>
        </div>
      </main>
      <footer className="wrap foot">
        <span>Data Genie, by Adel Sissoko.</span>
        <Link href="/">Homepage</Link>
      </footer>
    </div>
  );
}
