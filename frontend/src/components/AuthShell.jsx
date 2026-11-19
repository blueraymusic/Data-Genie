import { Brand } from './Brand';
import { ThemeToggle } from './PublicHeader';
import { SqlBlock } from './SqlBlock';
import { Link } from '../lib/router';
import { Icon } from './Icon';
export function AuthShell({ title, lead, children, variant = 'auth', eyebrow, headerAction }) {
  const compact = ['signin', 'signup', 'recovery'].includes(variant);
  return (
    <div className={'workspace-page' + (compact ? ' auth-screen' : '')}>
      <a className="skip-link" href="#gateTitle">
        Skip to main content
      </a>
      <section className={'gate entry-gate gate-' + variant} aria-labelledby="gateTitle">
        <header className="gate-header">
          <Brand />
          <nav aria-label={compact ? 'Account access' : 'Page navigation'}>
            {headerAction || <Link href="/">Back to homepage</Link>}
          </nav>
          <ThemeToggle className="icon-button" />
        </header>
        <div className="gate-layout">
          <main className="gate-form">
            <div className="gate-intro">
              {eyebrow && (
                <p className="eyebrow auth-step" aria-live="polite">
                  {eyebrow}
                </p>
              )}
              <h1 id="gateTitle" tabIndex="-1">
                {title}
              </h1>
              {lead && <p className="lead">{lead}</p>}
            </div>
            {compact ? <div className="auth-content">{children}</div> : children}
            {compact && (
              <footer className="auth-footer">
                <p>
                  {variant === 'signup' ? (
                    <>
                      Read our{' '}
                      <Link href="/terms" target="_blank" rel="noopener">
                        Terms &amp; Conditions<span className="sr-only"> (opens in a new tab)</span>
                      </Link>{' '}
                      before creating an account.
                    </>
                  ) : (
                    <Link href="/terms" target="_blank" rel="noopener">
                      Terms &amp; Conditions<span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                  )}
                </p>
                <Link href="/contact" target="_blank" rel="noopener">
                  Need help?
                </Link>
              </footer>
            )}
          </main>
          {compact ? (
            <aside className="auth-story" aria-label="Working with Data Genie">
              <p className="eyebrow">Make sense of your data</p>
              <h2>
                Ask a question.
                <br />
                <em>Know what happens next.</em>
              </h2>
              <div className="auth-story-preview">
                <p className="example-label">Your request</p>
                <p className="human-example">Show customers from Missouri.</p>
                <SqlBlock sql={"SELECT * FROM customers\nWHERE state = 'Missouri';"} />
                <div className="auth-story-result">
                  <Icon name="check" />
                  <span>Read the SQL. Review the result.</span>
                </div>
              </div>
              <p className="auth-story-note">
                <Icon name="lock" />
                Changes wait for your confirmation.
              </p>
            </aside>
          ) : (
            variant !== 'databases' && (
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
            )
          )}
        </div>
      </section>
    </div>
  );
}
