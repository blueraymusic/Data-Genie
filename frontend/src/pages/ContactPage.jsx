import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PublicHeader } from '../components/PublicHeader';
import { Icon } from '../components/Icon';
import { Link } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { contactDraft, contactEmail, contactTopics } from '../lib/contact';

const requiredMessages = {
  full_name: 'Enter your full name.',
  email: 'Enter your email address.',
  message: 'Enter a message so we know how to help.',
};

function fieldError(field) {
  if (!field.value.trim()) return requiredMessages[field.name];
  if (field.validity.typeMismatch) return 'Enter a valid email address, such as name@company.com.';
  return '';
}

export default function ContactPage() {
  const { user } = useAuth();
  const form = useRef(null);
  const focusError = useRef(null);
  const [topic, setTopic] = useState('support');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const selectedTopic = contactTopics.find(({ id }) => id === topic);

  useEffect(() => {
    document.title = 'Contact us | Data Genie';
  }, []);
  useLayoutEffect(() => {
    if (!focusError.current) return;
    form.current.elements.namedItem(focusError.current).focus();
    focusError.current = null;
  }, [errors]);

  function draft() {
    const fields = form.current.elements;
    const nextErrors = {};
    for (const name of Object.keys(requiredMessages)) {
      const error = fieldError(fields.namedItem(name));
      if (error) nextErrors[name] = error;
    }
    const firstError = Object.keys(nextErrors)[0];
    focusError.current = firstError;
    setErrors(nextErrors);
    setStatus(firstError ? 'Check the highlighted fields.' : '');
    if (firstError) return null;
    return contactDraft(new FormData(form.current));
  }

  function clearFieldError({ target }) {
    if (!errors[target.name] || fieldError(target)) return;
    setErrors((previous) => ({ ...previous, [target.name]: '' }));
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
    setStatus(
      'Draft ready. Review and send it in your email app. If it didn’t open, use Copy message.',
    );
  }

  async function copy() {
    const prepared = draft();
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(
        'To: ' + contactEmail + '\nSubject: ' + prepared.subject + '\n\n' + prepared.body,
      );
      setStatus('Message copied. Paste it into an email to ' + contactEmail + '.');
    } catch {
      setStatus('Copy is unavailable. You can email us directly at ' + contactEmail + '.');
    }
  }

  function requestDemo(event) {
    event.preventDefault();
    setTopic('demo');
    form.current.elements.namedItem('message').focus();
  }

  return (
    <div className="home-page contact-page" data-authenticated={user ? 'true' : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <PublicHeader contact />
      <main className="wrap contact-layout" id="main" tabIndex={-1}>
        <header className="contact-heading">
          <p className="contact-kicker">Contact us</p>
          <h1>
            Let’s talk <em>data.</em>
          </h1>
          <p className="contact-lead">Get support, request a demo, or ask about pricing.</p>
        </header>
        <form
          className="contact-form"
          aria-label="Contact Data Genie"
          aria-describedby="contact-method"
          ref={form}
          noValidate
          onSubmit={openEmail}
          onInput={clearFieldError}
        >
          <fieldset className="contact-topics">
            <legend>How can we help?</legend>
            <div className="contact-topic-options">
              {contactTopics.map(({ id, label }) => (
                <label key={id}>
                  <input
                    type="radio"
                    name="topic"
                    value={id}
                    checked={topic === id}
                    onChange={() => setTopic(id)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="contact-fields">
            <div className="contact-field">
              <label htmlFor="contact-name">Full name</label>
              <input
                id="contact-name"
                name="full_name"
                autoComplete="name"
                placeholder="Jane Smith"
                maxLength="200"
                required
                aria-invalid={errors.full_name ? true : undefined}
                aria-describedby={errors.full_name ? 'contact-name-error' : undefined}
              />
              {errors.full_name && (
                <p className="contact-error" id="contact-name-error">
                  {errors.full_name}
                </p>
              )}
            </div>
            <div className="contact-field">
              <label htmlFor="contact-email">Work email</label>
              <input
                id="contact-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="jane@work.com"
                maxLength="254"
                required
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'contact-email-error' : undefined}
              />
              {errors.email && (
                <p className="contact-error" id="contact-email-error">
                  {errors.email}
                </p>
              )}
            </div>
            <div className="contact-field contact-wide">
              <label htmlFor="contact-company">
                Company <span>(optional)</span>
              </label>
              <input
                id="contact-company"
                name="company"
                autoComplete="organization"
                placeholder="Company name"
                maxLength="160"
              />
            </div>
            <div className="contact-field contact-wide">
              <label htmlFor="contact-message">Message</label>
              <p className="contact-hint" id="contact-topic-hint" aria-live="polite">
                {selectedTopic.hint}
              </p>
              <textarea
                id="contact-message"
                name="message"
                rows="3"
                maxLength="2500"
                required
                aria-invalid={errors.message ? true : undefined}
                aria-describedby={
                  errors.message ? 'contact-topic-hint contact-message-error' : 'contact-topic-hint'
                }
              />
              {errors.message && (
                <p className="contact-error" id="contact-message-error">
                  {errors.message}
                </p>
              )}
            </div>
          </div>
          <div className="contact-form-actions">
            <button className="btn btn-primary" type="submit">
              Open email draft <Icon name="arrow" />
            </button>
            <button className="btn btn-quiet" type="button" onClick={copy}>
              <Icon name="copy" /> Copy message
            </button>
          </div>
          <p className="contact-method" id="contact-method">
            You review and send the draft in your email app.
          </p>
          <p className="contact-status" role="status">
            {status}
          </p>
        </form>
        <aside className="contact-resources">
          <ul className="contact-trust" aria-label="Data Genie controls">
            <li>
              <Icon name="check" /> Change approvals
            </li>
            <li>
              <Icon name="check" /> Workspace permissions
            </li>
            <li>
              <Icon name="check" /> Request history
            </li>
          </ul>
          <nav className="contact-help" aria-label="Other ways to get help">
            <Link href="/faq">
              Support docs <Icon name="arrow" />
            </Link>
            <a
              href={
                'mailto:' +
                contactEmail +
                '?subject=' +
                encodeURIComponent('Data Genie — Enterprise & Pricing')
              }
            >
              Email about pricing <Icon name="arrow" />
            </a>
            <a href="#contact-message" onClick={requestDemo}>
              Request a live demo <Icon name="arrow" />
            </a>
          </nav>
        </aside>
      </main>
    </div>
  );
}
