import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, '', '/terms');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Terms & Conditions', () => {
  it('opens publicly with accessible topics, data-use expectations, and real help links', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms & Conditions' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('navigation', { name: 'Terms topics' })).toBeTruthy();
    expect(within(main).getByRole('article', { name: 'Terms and conditions' })).toBeTruthy();
    expect(screen.getByText(/does not transfer ownership of your data/)).toBeTruthy();
    expect(screen.getByText(/Removing someone’s database access does not/)).toBeTruthy();
    expect(
      screen.getByText(/AI-generated SQL, charts, and reports can be incomplete/),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'security and data-handling guide' }).getAttribute('href'),
    ).toBe('https://github.com/blueraymusic/Data-Genie/blob/dev/SECURITY.md');
    const topicLinks = within(
      screen.getByRole('navigation', { name: 'Terms topics' }),
    ).getAllByRole('link');
    for (const link of topicLinks) {
      expect(document.querySelector(link.getAttribute('href'))).toBeTruthy();
    }
    expect(location.pathname).toBe('/terms');
  });

  it('lets a visitor return to login without an account or an agreement form', async () => {
    const events = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await events.click(screen.getByRole('link', { name: 'Back to log in' }));
    expect(location.pathname).toBe('/signin');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  });
});
