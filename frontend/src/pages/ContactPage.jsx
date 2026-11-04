import { useEffect, useRef, useState } from 'react';
import { Brand } from '../components/Brand';
import { PublicHeader } from '../components/PublicHeader';
import { Icon } from '../components/Icon';
import { Link } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { contactDraft, contactEmail, contactReasons } from '../lib/contact';

export default function ContactPage() {
  const { user } = useAuth();
  const form = useRef(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    document.title = 'Contact us | Data Genie';
  }, []);
  function draft() {
    for (const [key, label] of [
      ['first_name', 'your first name'],
      ['last_name', 'your last name'],
      ['message', 'a message'],
    ]) {
      const field = form.current.elements.namedItem(key);
      field.setCustomValidity(field.value.trim() ? '' : 'Enter ' + label + '.');
    }
    if (!form.current.reportValidity()) return null;
    return contactDraft(new FormData(form.current));
  }
  function openEmail(event) {
    event.preventDefault();
    const prepared = draft();
    if (!prepared) return;
    const link = document.createElement('a');
    link.href = prepared.url;
    document.body.append(link);
    link.click();
    link.remove();
    setMessage(
      'Your email draft is ready. Review and send it in your email app. If it didn’t open, use Copy message.',
    );
  }
  async function copy() {
    const prepared = draft();
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(
        `To: ${contactEmail}\nSubject: ${prepared.subject}\n\n${prepared.body}`,
      );
      setMessage('Message copied. Paste it into an email to ' + contactEmail + '.');
    } catch {
      setMessage('Copy is unavailable. You can email us directly at ' + contactEmail + '.');
    }
  }
  return (
    <div className="home-page contact-page" data-authenticated={user ? 'true' : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <PublicHeader contact />
      <main id="main">
        <section className="contact-intro">
          <div className="wrap">
            <p className="eyebrow">Contact us</p>
            <h1>
              We’d love to <em>hear from you.</em>
            </h1>
            <p>A question, a rough edge, or an idea for Data Genie? Tell us about it.</p>
          </div>
        </section>
        <div className="wrap contact-layout">
          <form
            className="contact-form"
            aria-label="Contact Data Genie"
            ref={form}
            onSubmit={openEmail}
            onInput={(event) => event.target.setCustomValidity?.('')}
          >
            <p className="contact-form-intro">
              Fill in your message. We’ll open your email app with a draft for you to review and
              send.
            </p>
            <div className="contact-fields">
              <label>
                First name <span aria-hidden="true">*</span>
                <input name="first_name" autoComplete="given-name" maxLength="100" required />
              </label>
              <label>
                Last name <span aria-hidden="true">*</span>
                <input name="last_name" autoComplete="family-name" maxLength="100" required />
              </label>
              <label>
                Email <span aria-hidden="true">*</span>
                <input name="email" type="email" autoComplete="email" maxLength="254" required />
              </label>
              <label>
                Organization <span className="optional">(optional)</span>
                <input name="company" autoComplete="organization" maxLength="160" />
              </label>
              <label className="contact-wide">
                What can we help with? <span aria-hidden="true">*</span>
                <select name="reason" defaultValue="" required>
                  <option value="" disabled>
                    Choose a reason
                  </option>
                  {contactReasons.map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </label>
              <label className="contact-wide">
                Your message <span aria-hidden="true">*</span>
                <textarea
                  name="message"
                  rows="5"
                  maxLength="2500"
                  required
                  placeholder="What are you trying to do, and how can we help?"
                />
              </label>
            </div>
            <p className="contact-note">
              Nothing is sent until you send the email. Fields marked * are required.
            </p>
            <div className="contact-form-actions">
              <button className="btn btn-primary" type="submit">
                Open email draft <Icon name="arrow" />
              </button>
              <button className="btn btn-secondary" type="button" onClick={copy}>
                Copy message
              </button>
            </div>
            <p className="contact-status" role="status">
              {message}
            </p>
          </form>
          <aside className="contact-help" aria-labelledby="contact-help-h">
            <h2 id="contact-help-h">Need a quick answer?</h2>
            <div>
              <Link href="/faq">
                Questions & answers <Icon name="arrow" />
              </Link>
              <p>Connections, approvals, accounts and your saved history.</p>
            </div>
            <div>
              <a
                href="https://github.com/blueraymusic/Data-Genie#readme"
                target="_blank"
                rel="noreferrer"
              >
                Documentation <Icon name="arrow" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <p>Read the project guide and setup instructions.</p>
            </div>
            <div>
              <a
                href="https://github.com/blueraymusic/Data-Genie/issues"
                target="_blank"
                rel="noreferrer"
              >
                Report an issue <Icon name="arrow" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <p>Found a bug? Share the steps that led to it.</p>
            </div>
            <div className="contact-direct">
              <p>Prefer to write directly?</p>
              <a href={'mailto:' + contactEmail}>{contactEmail}</a>
            </div>
          </aside>
        </div>
      </main>
      <footer className="home-footer dark-surface">
        <div className="wrap footer-row">
          <Brand />
          <nav aria-label="Footer navigation">
            <Link href="/">Homepage</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/signup">Try Data Genie</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
