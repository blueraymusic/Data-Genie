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
  await events.type(screen.getByRole('textbox', { name: 'First name', exact: true }), 'Ana');
  await events.type(screen.getByRole('textbox', { name: 'Last name', exact: true }), 'Brooks');
  await events.type(
    screen.getByRole('textbox', { name: 'Email', exact: true }),
    'ana@example.test',
  );
  await events.selectOptions(
    screen.getByRole('combobox', { name: 'What can we help with?' }),
    'Database connection',
  );
  await events.type(
    screen.getByRole('textbox', { name: 'Your message' }),
    'How do I connect my PostgreSQL database?',
  );
}
describe('Contact us', () => {
  it('is public and provides a direct address and real help links', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'We’d love to hear from you.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: contactEmail }).getAttribute('href')).toBe(
      'mailto:' + contactEmail,
    );
    expect(screen.getByRole('link', { name: 'Questions & answers' }).getAttribute('href')).toBe(
      '/faq',
    );
    expect(screen.getByRole('link', { name: /Documentation/ }).getAttribute('href')).toBe(
      'https://github.com/blueraymusic/Data-Genie#readme',
    );
    expect(
      screen.getByText('Nothing is sent until you send the email. Fields marked * are required.'),
    ).toBeTruthy();
  });
  it('requires valid fields and never opens an empty email draft', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    fireEvent.submit(screen.getByRole('form', { name: 'Contact Data Genie' }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('form').checkValidity()).toBe(false);
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
    expect(mail.searchParams.get('subject')).toBe('Data Genie — Database connection');
    expect(mail.searchParams.get('body')).toContain('How do I connect my PostgreSQL database?');
    expect(mail.searchParams.get('body')).toContain('Email: ana@example.test');
    expect(screen.getByRole('status').textContent).toContain(
      'Review and send it in your email app',
    );
    expect(screen.getByRole('textbox', { name: 'Your message' }).value).toContain('PostgreSQL');
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
    values.set('first_name', 'Ana');
    values.set('last_name', 'Brooks');
    values.set('email', 'ana@example.test');
    values.set('reason', 'Feedback or a feature idea');
    values.set('message', 'A question &bcc=other@example.test\nabout "customers"');
    const mail = new URL(contactDraft(values).url);
    expect([...mail.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(mail.searchParams.get('body')).toContain('&bcc=other@example.test');
  });
});
