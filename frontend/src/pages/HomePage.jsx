import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { PublicHeader } from '../components/PublicHeader';
import { HeroDemo } from '../components/HeroDemo';
import { HomeSafety } from '../components/HomeSafety';
import { HomeHistory } from '../components/HomeHistory';
import { SqlBlock } from '../components/SqlBlock';
import { examples } from '../data/home';
import { Link } from '../lib/router';
export default function HomePage() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = 'Data Genie: ask your database in plain English';
  }, []);
  const steps = [
    [
      'Connect a SQLite file',
      'Upload a file, create an empty database, or try the sample. Data Genie reads its structure.',
    ],
    ['Ask in plain English', 'Type what you want to find, add, change or total up. No SQL needed.'],
    [
      'Review the SQL',
      'Every request shows the SQL it wrote. Anything risky waits for your OK first.',
    ],
    ['Get the result', 'The result and the SQL behind it are saved, so you can find them again.'],
  ];
  return (
    <div className="home-page" data-authenticated={user ? 'true' : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main">
        <section className="hero wrap" id="top" aria-labelledby="h1">
          <div className="hero-intro">
            <h1 id="h1">Ask your database in plain English.</h1>
            <div className="hero-start">
              <p className="lede">
                Ask a question. See the SQL and your answer. Changes always wait for your OK.
              </p>
              <div className="cta-row">
                <Link href="/#demo" className="btn btn-primary">
                  Try the demo <span aria-hidden="true">↓</span>
                </Link>
                <Link href={user ? '/databases' : '/signin'} className="btn btn-secondary">
                  Open my database
                </Link>
              </div>
              <p className="hero-hint">
                No account needed to try the demo. SQLite files supported.
              </p>
            </div>
          </div>
          <HeroDemo />
        </section>
        <section className="sec wrap" id="how" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps" role="list">
            {steps.map(([title, copy], index) => (
              <li className="step" key={title}>
                <span className="num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="sec wrap" id="ask" aria-labelledby="ask-h">
          <h2 id="ask-h">What you can ask</h2>
          <p className="lede">
            Write it the way you would say it. Here is each request next to the SQL Data Genie
            writes for it.
          </p>
          <div className="ask-grid">
            {examples.map((group) => (
              <div key={group.title}>
                <h3>{group.title}</h3>
                {group.items.map((item) => (
                  <div className="mini" key={item.request}>
                    <p className="req">{item.request}</p>
                    <SqlBlock home sql={item.sql} operation={item.operation} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
        <HomeSafety />
        <HomeHistory />
      </main>
      <footer className="foot">
        <div className="wrap">
          <span>Data Genie, by Adel Sissoko.</span>
          <Link href="/faq">FAQ</Link>
        </div>
      </footer>
    </div>
  );
}
