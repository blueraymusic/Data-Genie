import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { HeroDemo } from './components/HeroDemo';
import { Router } from './lib/router';
import { HomeConnections } from './components/HomeConnections';
import { HomeExamples } from './components/HomeExamples';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, '', '/');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ user: null }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tourPanel = () =>
  screen.getByRole('tabpanel', { name: /^(Ask|Review the SQL|Approve changes|History)$/ });

describe('interactive homepage', () => {
  it('does not offer placeholder text as copyable SQL while translating', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    render(
      <Router>
        <HeroDemo />
      </Router>,
    );
    expect(screen.getByRole('status').textContent).toBe('Translating your request…');
    expect(screen.queryByRole('button', { name: 'Copy SQL' })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('button', { name: 'Copy SQL' })).toBeTruthy();
    expect(screen.getByText('3 customers found in Missouri')).toBeTruthy();
  });

  it('supports arrow, Home and End navigation through the workspace tour', async () => {
    const events = userEvent.setup();
    render(<App />);
    const ask = screen.getByRole('tab', { name: 'Ask', exact: true });
    await events.click(ask);
    await events.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Review the SQL' }));
    expect(tourPanel().getAttribute('aria-labelledby')).toBe('tour-tab-1');
    await events.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(
      within(tourPanel()).getByRole('group', {
        name: 'Filter sample history',
      }),
    ).toBeTruthy();
    await events.keyboard('{Home}');
    expect(document.activeElement).toBe(ask);
    expect(ask.getAttribute('aria-selected')).toBe('true');
  });

  it('changes the sample SQL and rows when asking and following up', async () => {
    const events = userEvent.setup();
    render(<App />);
    const panel = within(tourPanel());
    await events.selectOptions(panel.getByLabelText('Show customers from'), 'Iowa');
    await events.click(panel.getByRole('button', { name: 'Ask', exact: true }));
    expect(panel.getByText('Avery Chen')).toBeTruthy();
    expect(panel.getByText('1 customer in Iowa')).toBeTruthy();
    expect(tourPanel().textContent).toContain("WHERE state = 'Iowa';");
    await events.click(panel.getByRole('button', { name: /Follow up: and Missouri/ }));
    expect(panel.getByText('3 customers in Missouri')).toBeTruthy();
    expect(panel.queryByText('Avery Chen')).toBeNull();
    expect(fetch.mock.calls.every(([, options]) => !options || options.method !== 'POST')).toBe(
      true,
    );
  });

  it('explains and copies the actual displayed query', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.click(screen.getByRole('tab', { name: 'Review the SQL' }));
    const panel = within(tourPanel());
    await events.click(panel.getByRole('button', { name: 'Explain this query' }));
    expect(panel.getByText('Read only · no data changed')).toBeTruthy();
    await events.click(panel.getByRole('button', { name: 'Copy SQL' }));
    expect(await navigator.clipboard.readText()).toBe(
      "SELECT name, state FROM customers\nWHERE state = 'Missouri';",
    );
    expect(panel.getByRole('button', { name: 'Copied' })).toBeTruthy();
    await events.click(panel.getByRole('button', { name: 'Hide explanation' }));
    expect(panel.queryByText('Read only · no data changed')).toBeNull();
  });

  it('filters history and opens the chosen sample request', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.click(screen.getByRole('tab', { name: 'History' }));
    const panel = within(tourPanel());
    await events.click(panel.getByRole('button', { name: 'declined', exact: true }));
    expect(panel.getByText('Not run. You declined this change.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: /show all customers/ })).toBeNull();
    await events.click(panel.getByRole('button', { name: 'executed', exact: true }));
    await events.click(
      panel.getByRole('button', {
        name: /how many customers are in each state/,
      }),
    );
    expect(panel.getByText('6 customers across 4 states.')).toBeTruthy();
    expect(tourPanel().textContent).toContain('COUNT(*) AS customers');
  });

  it('updates lookup and chart examples from the same sample data', async () => {
    const events = userEvent.setup();
    render(<App />);
    const lookup = within(screen.getByRole('article', { name: 'Find your people.' }));
    await events.selectOptions(lookup.getByLabelText('Choose a state'), 'Iowa');
    expect(lookup.getByText('show customers from Iowa')).toBeTruthy();
    expect(lookup.getByText('Avery Chen')).toBeTruthy();
    expect(lookup.queryByText('Jon Reyes')).toBeNull();
    await events.click(screen.getByRole('tab', { name: 'Summarize', exact: true }));
    const summary = within(screen.getByRole('article', { name: 'See the bigger picture.' }));
    await events.click(summary.getByRole('button', { name: 'Percentage' }));
    expect(summary.getByRole('img').getAttribute('aria-label')).toContain('Missouri: 50.0%');
    expect(summary.getByRole('img').getAttribute('aria-label')).toContain('Iowa: 16.7%');
    expect(summary.getByText('50.0%')).toBeTruthy();
    expect(screen.getByRole('article', { name: 'See the bigger picture.' }).textContent).toContain(
      'AS percentage',
    );
  });

  it('approves, resets and declines sample changes without write requests', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.click(screen.getByRole('tab', { name: 'Make changes', exact: true }));
    const change = within(screen.getByRole('article', { name: 'Move things forward.' }));
    await events.click(change.getByRole('button', { name: 'Approve change' }));
    expect(change.getByText('Sample result: Priya Nair’s state is now Kansas.')).toBeTruthy();
    await events.click(change.getByRole('button', { name: 'Try again' }));
    await events.click(change.getByRole('button', { name: 'Don’t run' }));
    expect(change.getByText('Not run. You declined this.')).toBeTruthy();
    await events.click(screen.getByRole('button', { name: 'Delete 3 rows' }));
    expect(screen.getByText('Sample result: 3 rows deleted from sales.')).toBeTruthy();
    expect(fetch.mock.calls.every(([, options]) => !options || options.method !== 'POST')).toBe(
      true,
    );
  });

  it('shows one example at a time, supports keyboard navigation and preserves selections', async () => {
    const events = userEvent.setup();
    render(<App />);
    const choices = within(screen.getByRole('tablist', { name: 'Try a sample request' }));
    await events.selectOptions(screen.getByLabelText('Choose a state'), 'Iowa');
    await events.click(choices.getByRole('tab', { name: 'Look up' }));
    await events.keyboard('{End}');
    expect(choices.getByRole('tab', { name: 'Make changes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('article', { name: 'Find your people.' })).toBeNull();
    expect(screen.getAllByRole('article').length).toBe(1);
    await events.keyboard('{Home}');
    expect(screen.getByLabelText('Choose a state').value).toBe('Iowa');
    expect(screen.getByRole('article').textContent).toContain('Avery Chen');
  });

  it('automatically rotates examples but pauses during interaction and on request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(<HomeExamples />);
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole('tab', { name: 'Summarize' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.mouseEnter(screen.getByRole('tabpanel', { name: 'Summarize' }).parentElement);
    await act(async () => {
      vi.advanceTimersByTime(16000);
    });
    expect(screen.getByRole('tab', { name: 'Summarize' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.mouseLeave(screen.getByRole('tabpanel', { name: 'Summarize' }).parentElement);
    act(() => screen.getByRole('button', { name: 'Pause example slideshow' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Pause example slideshow' }));
    await act(async () => {
      vi.advanceTimersByTime(16000);
    });
    expect(screen.getByRole('tab', { name: 'Summarize' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Resume example slideshow' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume example slideshow' }));
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole('tab', { name: 'Make changes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('keeps the slideshow static for reduced motion', async () => {
    vi.useFakeTimers();
    render(<HomeExamples />);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByRole('tab', { name: 'Look up' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Pause example slideshow' })).toBeNull();
  });

  it('pauses and resumes the logo strip with no duplicate accessible links', async () => {
    const events = userEvent.setup();
    render(<HomeConnections />);
    expect(screen.getAllByRole('link').length).toBe(1);
    await events.click(screen.getByRole('button', { name: 'Pause logo animation' }));
    expect(
      screen.getByRole('button', { name: 'Resume logo animation' }).getAttribute('aria-pressed'),
    ).toBe('true');
    await events.click(screen.getByRole('button', { name: 'Resume logo animation' }));
    expect(
      screen.getByRole('button', { name: 'Pause logo animation' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('routes Try Data Genie to signup and offers Contact us through the mobile menu', async () => {
    const events = userEvent.setup();
    render(<App />);
    expect(
      screen
        .getAllByRole('link', { name: 'Try Data Genie' })
        .every((link) => link.getAttribute('href') === '/signup'),
    ).toBe(true);
    await events.click(screen.getByRole('button', { name: 'Open navigation' }));
    const menu = within(screen.getByRole('navigation', { name: 'Mobile navigation' }));
    await events.click(menu.getByRole('link', { name: 'Contact us' }));
    expect(
      await screen.findByRole('heading', { name: 'We’d love to hear from you.' }),
    ).toBeTruthy();
    expect(location.pathname).toBe('/contact');
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
  });

  it('keeps entry actions appropriate for a signed-in visitor', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { account_id: 1, first_name: 'Preview', email: 'preview@example.test' },
      }),
    });
    render(<App />);
    const header = within(screen.getByRole('banner'));
    expect((await header.findByRole('link', { name: 'Open workspace' })).getAttribute('href')).toBe(
      '/app',
    );
    expect(header.getByRole('link', { name: 'View history' }).getAttribute('href')).toBe(
      '/history',
    );
    expect(screen.getByRole('link', { name: 'Open my database' }).getAttribute('href')).toBe(
      '/databases',
    );
    expect(header.queryByRole('link', { name: 'Try Data Genie' })).toBeNull();
  });

  it('keeps the theme toggle and inline FAQ operable', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await events.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    const question = screen.getByText('Do I need an account to try the demo?').closest('summary');
    await events.click(question);
    expect(question.parentElement.open).toBe(true);
    await events.click(question);
    expect(question.parentElement.open).toBe(false);
  });

  it('offers real entry routes and describes platform names without endorsements', async () => {
    render(<App />);
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/signin');
    expect(header.getByRole('link', { name: 'Try Data Genie' }).getAttribute('href')).toBe(
      '/signup',
    );
    expect(screen.getByRole('link', { name: 'Open my database' }).getAttribute('href')).toBe(
      '/signin',
    );
    expect(screen.getByRole('link', { name: /GitHub source code/ }).getAttribute('href')).toBe(
      'https://github.com/blueraymusic/Data-Genie',
    );
    expect(screen.getByRole('region', { name: 'Connections and platforms' }).textContent).toContain(
      'Microsoft AzureCloud hosting',
    );
    expect(screen.getAllByRole('link').every((link) => link.getAttribute('href') !== '#')).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: 'All questions & answers' }).getAttribute('href')).toBe(
      '/faq',
    );
  });
});
