import { Brand } from './Brand';
import { ThemeToggle } from './PublicHeader';
import { SqlBlock } from './SqlBlock';
import { Link } from '../lib/router';
export function AuthShell({ title, lead, children, variant = 'auth' }) {
  return (
    <div className="workspace-page">
      <a className="skip-link" href="#gateTitle">
        Skip to main content
      </a>
      <section className={'gate entry-gate gate-' + variant} aria-labelledby="gateTitle">
        <header className="gate-header">
          <Brand />
          <Link href="/">Back to homepage</Link>
          <ThemeToggle className="icon-button" />
        </header>
        <div className="gate-layout">
          <main className="gate-form">
            <h1 id="gateTitle" tabIndex="-1">
              {title}
            </h1>
            <p className="lead">{lead}</p>
            {children}
          </main>
          {variant !== 'databases' && (
            <aside className="gate-example" aria-label="Example translation">
              <p className="eyebrow">In your workspace</p>
              <h2>Your question stays beside the answer.</h2>
              <p className="example-label">Your request</p>
              <p className="human-example">show all customers from Missouri</p>
              <div className="example-thread" aria-hidden="true" />
              <p className="example-label">The SQL</p>
              <SqlBlock sql={"SELECT * FROM customers\nWHERE state = 'Missouri';"} />
              <p className="small muted">
                Read the SQL, see the result, and follow up. Changes wait for your confirmation.
              </p>
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}
