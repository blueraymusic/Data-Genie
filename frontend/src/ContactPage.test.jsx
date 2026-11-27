import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { contactDraft, contactEmail } from './lib/contact';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, '', '/contact');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ user: null }) })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fill(events) {
  await events.type(screen.getByRole('textbox', { name: 'Full name' }), 'Ana Brooks');
  await events.type(screen.getByRole('textbox', { name: 'Work email' }), 'ana@example.test');
  await events.type(
    screen.getByRole('textbox', { name: 'Message' }),
    'How do I connect my PostgreSQL database?',
  );
}
describe('Contact us', () => {
  it('is public and provides a direct address and real help links', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Let’s talk data.' })).toBeTruthy();
    expect(
      new URL(screen.getByRole('link', { name: 'Email about pricing' }).getAttribute('href'))
        .pathname,
    ).toBe(contactEmail);
    expect(screen.getByRole('link', { name: 'Support docs' }).getAttribute('href')).toBe('/faq');
    expect(screen.getByText('You review and send the draft in your email app.')).toBeTruthy();
  });
  it('requires valid fields and never opens an empty email draft', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    fireEvent.submit(screen.getByRole('form', { name: 'Contact Data Genie' }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('form').checkValidity()).toBe(false);
    const name = screen.getByRole('textbox', { name: 'Full name' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(screen.getByText('Enter your full name.')).toBeTruthy();
  });
  it('moves to the first invalid field and clears its inline error when corrected', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.type(screen.getByRole('textbox', { name: 'Full name' }), 'Ana Brooks');
    const email = screen.getByRole('textbox', { name: 'Work email' });
    await events.type(email, 'ana');
    await events.click(screen.getByRole('button', { name: 'Open email draft' }));
    expect(document.activeElement).toBe(email);
    expect(screen.getByText(/Enter a valid email address/)).toBeTruthy();
    await events.type(email, '@example.test');
    expect(email.getAttribute('aria-invalid')).toBeNull();
  });
  it('updates the message guidance when a topic or the live demo link is selected', async () => {
    const events = userEvent.setup();
    render(<App />);
    const support = screen.getByRole('radio', { name: 'Technical Support' });
    expect(support.checked).toBe(true);
    await events.click(screen.getByRole('radio', { name: 'Enterprise & Pricing' }));
    expect(screen.getByRole('radio', { name: 'Enterprise & Pricing' }).checked).toBe(true);
    expect(screen.getByText('Tell us about your team size and what you need.')).toBeTruthy();
    await events.click(screen.getByRole('link', { name: 'Request a live demo' }));
    expect(screen.getByRole('radio', { name: 'Request a Demo' }).checked).toBe(true);
    expect(screen.getByText('Tell us what you’d like to see and your time zone.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  });
  it('opens a correctly addressed email draft and preserves the form', async () => {
    const events = userEvent.setup();
    let url;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      url = this.href;
    });
    render(<App />);
    await fill(events);
    await events.click(screen.getByRole('button', { name: 'Open email draft' }));
    const mail = new URL(url);
    expect(mail.pathname).toBe(contactEmail);
    expect(mail.searchParams.get('subject')).toBe('Data Genie — Technical Support');
    expect(mail.searchParams.get('body')).toContain('How do I connect my PostgreSQL database?');
    expect(mail.searchParams.get('body')).toContain('Email: ana@example.test');
    expect(screen.getByRole('status').textContent).toContain(
      'Review and send it in your email app',
    );
    expect(screen.getByRole('textbox', { name: 'Message' }).value).toContain('PostgreSQL');
    expect(fetch.mock.calls.every(([, options]) => !options || options.method !== 'POST')).toBe(
      true,
    );
  });
  it('copies the message when a visitor prefers another email app', async () => {
    const events = userEvent.setup();
    render(<App />);
    await fill(events);
    await events.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await navigator.clipboard.readText()).toContain('To: ' + contactEmail);
    expect(await navigator.clipboard.readText()).toContain('Name: Ana Brooks');
    expect(screen.getByRole('status').textContent).toContain('Message copied.');
  });
  it('encodes message content as body text rather than mail parameters', () => {
    const values = new FormData();
    values.set('full_name', 'Ana Brooks');
    values.set('email', 'ana@example.test');
    values.set('topic', 'partners');
    values.set('message', 'A question &bcc=other@example.test\nabout "customers"');
    const mail = new URL(contactDraft(values).url);
    expect([...mail.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(mail.searchParams.get('body')).toContain('&bcc=other@example.test');
  });
});
