import { useEffect } from 'react';
import { PublicHeader } from '../components/PublicHeader';
import { Link } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import '../styles/terms.css';

const sections = [
  {
    id: 'account',
    title: 'Your account',
    content: (
      <>
        <p>
          Keep your account details accurate and your password, verification codes, and recovery
          links private. Use only an account you are authorized to access. Google sign-in is
          available when the installation has it configured.
        </p>
        <p>
          Hosted and local installations have separate accounts and saved data. Signing in to one
          does not give you access to the other.
        </p>
      </>
    ),
  },
  {
    id: 'your-data',
    title: 'Data you bring',
    content: (
      <>
        <p>
          Uploading a file or connecting a database does not transfer ownership of your data to Data
          Genie. Only bring data you have permission to use, and check that sharing it with
          teammates or an AI service is allowed.
        </p>
        <p>
          Data Genie stores account information, saved history, databases, and reports in the
          installation you use. See the{' '}
          <a href="https://github.com/blueraymusic/Data-Genie/blob/dev/SECURITY.md">
            security and data-handling guide
          </a>{' '}
          for how data and credentials are handled.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Teams and sharing',
    content: (
      <>
        <p>
          Workspace roles, database permissions, and report sharing determine what other people can
          access. Review the recipient and permissions before inviting someone, sharing a report,
          moving a database, or transferring a team workspace.
        </p>
        <p>
          A shared report is a saved snapshot. Removing someone’s database access does not remove
          information already included in a shared report or an earlier download.
        </p>
      </>
    ),
  },
  {
    id: 'ai-and-changes',
    title: 'AI answers and database changes',
    content: (
      <>
        <p>
          AI-generated SQL, charts, and reports can be incomplete or incorrect. Review the SQL and
          the underlying results before relying on an answer or sharing it with others.
        </p>
        <p>
          Ask sends database structure and request context to the configured AI service. Text,
          files, and report source notes you submit for AI processing are also sent to that service.
          Its own settings and terms apply to that processing.
        </p>
        <p>
          Review a proposed change before confirming it. Confirmed PostgreSQL changes affect the
          connected database directly. In the browser, confirmed SQLite changes affect the uploaded
          working copy; download that copy to keep the updated file.
        </p>
      </>
    ),
  },
  {
    id: 'integrations',
    title: 'Agents and connected services',
    content: (
      <p>
        Grant agents and integrations only the workspace access and permissions they need. Keep API
        keys and connection credentials private, check their activity, and revoke access when it is
        no longer needed. An integration’s permissions do not replace your responsibility to review
        a proposed database change.
      </p>
    ),
  },
  {
    id: 'saving',
    title: 'Saving, exports, and removal',
    content: (
      <>
        <p>
          Keep your own backups and export important work. Check the selected database and export
          format before downloading. A query-result export contains the loaded result, while a
          database export can contain more data.
        </p>
        <p>
          Read each removal or account-deletion confirmation carefully. Deleting an account does not
          remove copies other people have downloaded, and shared report archives can remain
          available to their existing audience. The <Link href="/faq">FAQ</Link> explains the
          available export and deletion controls.
        </p>
      </>
    ),
  },
  {
    id: 'responsible-use',
    title: 'Responsible use',
    content: (
      <p>
        Do not use Data Genie to access data without permission, bypass access controls, distribute
        malicious content, or disrupt the service. Respect the rights of the people whose
        information you handle. Report a suspected security issue through the private reporting
        steps in the security guide, without publishing passwords or database records.
      </p>
    ),
  },
  {
    id: 'questions',
    title: 'Questions and updates',
    content: (
      <p>
        Features and available integrations may change. Review this page when deciding how to use
        the service, and <Link href="/contact">contact us</Link> if anything is unclear or you need
        help with your account or data.
      </p>
    ),
  },
];

export default function TermsPage() {
  const { user } = useAuth();
  useEffect(() => {
    document.title = 'Terms & Conditions | Data Genie';
  }, []);
  return (
    <div className="faq-page terms-page" data-authenticated={user ? 'true' : undefined}>
      <a className="skip-link" href="#terms-content">
        Skip to main content
      </a>
      <PublicHeader />
      <main className="wrap" id="terms-content" tabIndex="-1">
        <header className="intro terms-intro">
          <p className="eyebrow">Using Data Genie</p>
          <h1>Terms & Conditions</h1>
          <p className="lede">Clear expectations for your account, data, and shared work.</p>
        </header>
        <div className="terms-layout">
          <nav className="terms-topics" aria-label="Terms topics">
            <p className="eyebrow">On this page</p>
            {sections.map(({ id, title }) => (
              <a key={id} href={'#terms-' + id}>
                {title}
              </a>
            ))}
          </nav>
          <article className="terms-document" aria-label="Terms and conditions">
            <p className="terms-summary">
              Data Genie helps you ask questions, review SQL, and work with databases and reports.
              Use it only with data and accounts you have permission to access. The following terms
              describe the responsibilities that come with using these tools.
            </p>
            {sections.map(({ id, title, content }, index) => (
              <section key={id} id={'terms-' + id} aria-labelledby={'terms-' + id + '-title'}>
                <h2 id={'terms-' + id + '-title'}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  {title}
                </h2>
                {content}
              </section>
            ))}
            <div className="terms-actions">
              <Link className="btn primary" href="/signup">
                Create an account
              </Link>
              <Link href="/signin">Back to log in</Link>
            </div>
          </article>
        </div>
      </main>
      <footer className="wrap foot">
        <span>Data Genie · Blueray Inc.</span>
        <div>
          <Link href="/contact">Contact us</Link> · <Link href="/">Homepage</Link>
        </div>
      </footer>
    </div>
  );
}
