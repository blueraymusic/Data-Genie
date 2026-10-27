import { Brand } from './Brand';
import { ThemeToggle } from './PublicHeader';
import { SqlBlock } from './SqlBlock';
import { Link } from '../lib/router';
export function AuthShell({ title, lead, children }) {
  return (
    <div className="workspace-page">
      <a className="skip-link" href="#gateTitle">
        Skip to main content
      </a>
      <section className="gate" aria-labelledby="gateTitle">
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
          <aside className="gate-example" aria-label="Example translation">
            <p className="small muted">A question. A translation. A clear result.</p>
            <p className="human-example">show all customers from Missouri</p>
            <div className="example-thread" aria-hidden="true" />
            <SqlBlock sql={"SELECT * FROM customers\nWHERE state = 'Missouri';"} />
            <p className="small muted">
              Your words stay beside the SQL. Every result stays on the record.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
