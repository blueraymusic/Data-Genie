import { useEffect, useRef } from 'react';
import { useScrollReveal } from '../hooks/useMotion';
import { useAuth } from '../context/AuthContext';
import { PublicHeader, EntryLink } from '../components/PublicHeader';
import { Brand } from '../components/Brand';
import { HeroDemo } from '../components/HeroDemo';
import { HomeTour } from '../components/HomeTour';
import { HomeExamples } from '../components/HomeExamples';
import { HomeSafety } from '../components/HomeSafety';
import { HomeConnections } from '../components/HomeConnections';
import { Link } from '../lib/router';
import { Icon } from '../components/Icon';

const steps = [
  [
    'Ask in plain English',
    'Choose your database, then type what you want to know. Try “show all customers from Missouri.”',
  ],
  [
    'See the SQL',
    'Data Genie translates your request into SQL and explains it, so you can check what will happen.',
  ],
  [
    'Get your answer',
    'Reads run straight away and return rows. Changes always wait for your OK. Your requests stay in History.',
  ],
];
const questions = [
  [
    'Do I need an account to try the demo?',
    'No. The interactive examples on this page use sample data. Create an account when you’re ready to work with your own database.',
  ],
  [
    'Which databases can I use?',
    'Upload a SQLite file, create a new SQLite database, or connect an external PostgreSQL database. PostgreSQL connections start read-only.',
  ],
  [
    'Can Data Genie change my data?',
    'Only after you approve the SQL. Confirmed PostgreSQL changes apply directly to your connected database. You can also manage tables and columns in Structure.',
  ],
  [
    'Can I see my earlier requests?',
    'Yes. History saves your requests, SQL, status and available results. Search and filter it to find an earlier answer.',
  ],
  [
    'Can I work with my team?',
    'Yes. Choose “Create team workspace” on the database screen, then add databases and invite teammates using their account email and a private code. You choose what each person can do with each database.',
  ],
];
export default function HomePage() {
  const { user } = useAuth();
  const page = useRef(null);
  useScrollReveal(page, '.section-heading, .home-steps > li, .home-closing .wrap');
  useEffect(() => {
    document.title = 'Data Genie: ask your database in plain English';
  }, []);
  return (
    <div className="home-page" ref={page} data-authenticated={user ? 'true' : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main">
        <section className="home-hero" id="top" aria-labelledby="h1">
          <div className="wrap hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">Your words. Your data.</p>
              <h1 id="h1">
                Ask your database in <em>plain English.</em>
              </h1>
              <p className="hero-lede">
                Ask a question. See the SQL and your answer. Changes always wait for your OK.
              </p>
              <div className="cta-row">
                <Link href="/signup" className="btn btn-primary">
                  Try Data Genie <Icon name="arrow" />
                </Link>
                <Link href={user ? '/databases' : '/signin'} className="btn btn-dark">
                  Open my database
                </Link>
              </div>
              <p className="hero-hint">
                <Link href="/#demo">Explore the sample demo</Link> · No account needed.
                <br /> SQLite files and PostgreSQL connections.
              </p>
            </div>
            <div className="hero-preview">
              <HeroDemo />
            </div>
          </div>
        </section>
        <HomeConnections />
        <HomeTour />
        <section className="home-section" id="how" aria-labelledby="how-h">
          <div className="wrap">
            <div className="section-heading centered">
              <p className="eyebrow">How it works</p>
              <h2 id="how-h">
                From question to answer in <em>three steps.</em>
              </h2>
            </div>
            <ol className="home-steps" role="list">
              {steps.map(([title, copy], index) => (
                <li key={title} data-motion-delay={index * 70}>
                  <span className="step-number" aria-hidden="true">
                    0{index + 1}
                  </span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <HomeExamples />
        <HomeSafety />
        <section className="home-section home-faq" id="questions" aria-labelledby="home-faq-h">
          <div className="wrap faq-layout">
            <div className="section-heading">
              <p className="eyebrow">FAQ</p>
              <h2 id="home-faq-h">
                Questions,
                <br />
                <em>answered.</em>
              </h2>
              <Link href="/faq" className="inline-link">
                All questions & answers <Icon name="arrow" />
              </Link>
            </div>
            <div className="home-faq-list">
              {questions.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="home-closing" aria-labelledby="closing-title">
          <div className="wrap">
            <h2 id="closing-title">
              Your next answer starts <em>with a question.</em>
            </h2>
            <EntryLink primary className="btn btn-primary" />
          </div>
        </section>
      </main>
      <footer className="home-footer dark-surface">
        <div className="wrap">
          <div className="footer-row">
            <Brand />
            <nav aria-label="Footer navigation">
              <Link href="/#how">How it works</Link>
              <Link href="/#ask">What you can ask</Link>
              <Link href="/#safety">Safety</Link>
              <Link href="/faq">FAQ</Link>
              <Link href="/contact">Contact us</Link>
              <EntryLink />
            </nav>
          </div>
          <div className="footer-meta">
            <p className="eyebrow">Your words. Your data.</p>
            <span>Made by Blueray Inc.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
