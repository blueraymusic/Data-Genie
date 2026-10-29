import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { api, setCsrfToken } from './lib/api';
import { sortedRows } from './lib/resultData';
import { viewFromRoute } from './pages/WorkspaceApp';
import { ResultOutput } from './components/CommandResult';

configure({ asyncUtilTimeout: 3000 });

const user = {
  account_id: 1,
  first_name: 'Audit',
  last_name: 'Reader',
  email: 'audit@example.test',
};
const session = {
  ...user,
  session_id: 'current',
  database_id: 1,
  database: 'sample.sqlite3',
  source: 'demo',
  started_at: new Date().toISOString(),
  tables: ['notes'],
  table_details: [{ name: 'notes', columns: [{ name: 'id', type: 'INTEGER' }], row_count: 2 }],
  ai: { enabled: false },
};
const earlier = { ...session, session_id: 'earlier', ended_at: new Date().toISOString() };
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
function setup(path, active = false) {
  history.replaceState({}, '', path);
  if (active)
    sessionStorage.setItem(
      'data-genie-session',
      JSON.stringify({ session_id: session.session_id }),
    );
  fetch.mockImplementation((url) =>
    response(
      url === '/api/auth/session'
        ? { user, csrf_token: 'current-token' }
        : url === '/api/status'
          ? session
          : url === '/api/sessions'
            ? { sessions: [earlier] }
            : { requests: [] },
    ),
  );
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setCsrfToken('');
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens Account without a database or a fake connected indicator', async () => {
  setup('/account');
  render(<App />);
  expect(
    await screen.findByRole('heading', { name: 'Account & preferences', exact: true }),
  ).toBeTruthy();
  expect(screen.getByLabelText('Current password')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Download SQLite file' })).toBeNull();
  expect(screen.queryByLabelText('Open session')).toBeNull();
  expect(document.querySelector('.session-timer')).toBeNull();
});

it('restores keyboard focus after dismissing the account menu', async () => {
  setup('/account');
  const events = userEvent.setup();
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'Open user menu' });
  await events.click(trigger);
  await events.tab();
  expect(document.activeElement.textContent).toBe('Account & preferences');
  await events.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('redirects an authenticated sign-in URL to Databases', async () => {
  setup('/signin');
  render(<App />);
  expect(
    await screen.findByRole('heading', { name: 'Choose your database.', exact: true }),
  ).toBeTruthy();
  await waitFor(() => expect(location.pathname).toBe('/databases'));
});

it('opens saved history without restoring or connecting a database', async () => {
  setup('/history');
  render(<App />);
  expect(await screen.findByText('No saved requests match these filters.')).toBeTruthy();
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/history?'))).toBe(true),
  );
  const [, options] = fetch.mock.calls.find(([url]) => url.startsWith('/api/history?'));
  expect(options.headers['X-Session-ID']).toBeUndefined();
  expect(fetch.mock.calls.some(([url]) => url === '/api/status')).toBe(false);
});

it('stops the History loading state on failure and clears the error after retry', async () => {
  setup('/history');
  const base = fetch.getMockImplementation();
  let reads = 0;
  fetch.mockImplementation((url, options) =>
    url.startsWith('/api/history?')
      ? ++reads === 1
        ? response({ error: 'History temporarily unavailable' }, 503)
        : response({ requests: [] })
      : base(url, options),
  );
  const events = userEvent.setup();
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'History temporarily unavailable',
  );
  expect(screen.queryByText('Loading history…')).toBeNull();
  await events.click(screen.getByRole('button', { name: 'Try again', exact: true }));
  expect(await screen.findByText('No saved requests match these filters.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('stops Structure loading on an error and recovers on refresh', async () => {
  setup('/app?view=structure', true);
  const base = fetch.getMockImplementation();
  let reads = 0;
  fetch.mockImplementation((url, options) =>
    url === '/api/schema'
      ? ++reads === 1
        ? response({ error: 'Database is offline' }, 503)
        : response({ tables: [] })
      : base(url, options),
  );
  const events = userEvent.setup();
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain('Database is offline');
  expect(screen.queryByText('Loading structure…')).toBeNull();
  await events.click(screen.getByRole('button', { name: 'Refresh structure', exact: true }));
  expect(await screen.findByText('This database has no tables yet.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps a cancelled JSON response as an abort instead of a server error', async () => {
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => {
      throw new DOMException('cancelled', 'AbortError');
    },
  });
  await expect(api('/api/schema')).rejects.toHaveProperty('name', 'AbortError');
});

it('ignores an expired response from a previous login after the token has changed', async () => {
  let resolve;
  fetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const expired = vi.fn();
  window.addEventListener('genie-auth-expired', expired);
  setCsrfToken('old-token');
  const pending = api('/api/status');
  const check = expect(pending).rejects.toHaveProperty('status', 401);
  setCsrfToken('new-token');
  resolve({
    ok: false,
    status: 401,
    json: async () => ({ auth_required: true, error: 'Old login expired' }),
  });
  await check;
  expect(expired).not.toHaveBeenCalled();
  window.removeEventListener('genie-auth-expired', expired);
});

it('sorts decimal and large integer strings numerically without rounding them', () => {
  const values = [
    '2.9',
    '2.10',
    '2.01',
    '-2.2',
    '-2.02',
    '9007199254740993',
    '9007199254740992',
    '9e-20',
  ];
  const rows = values.map((value) => ({ value }));
  expect(sortedRows(rows, { column: 'value', direction: 'asc' }).map((row) => row.value)).toEqual([
    '-2.2',
    '-2.02',
    '9e-20',
    '2.01',
    '2.10',
    '2.9',
    '9007199254740992',
    '9007199254740993',
  ]);
  expect(
    sortedRows([{ value: '12.30' }, { value: '12.03' }], { column: 'value', direction: 'desc' })[0]
      .value,
  ).toBe('12.30');
});

it('does not crash on a malformed URL fragment', async () => {
  setup('/#%bad%');
  render(<App />);
  expect(
    await screen.findByRole('heading', {
      name: 'Ask your database in plain English.',
      exact: true,
    }),
  ).toBeTruthy();
  expect(screen.queryByText('The page could not be displayed.')).toBeNull();
});

it('keeps the Structure and SQL views selected when their URLs contain a fragment', () => {
  expect(viewFromRoute('/app?view=structure#schema-table-0')).toBe('schema');
  expect(viewFromRoute('/app?view=sql#result')).toBe('sql');
});

it('charts PostgreSQL decimal strings while keeping the exact displayed values', () => {
  render(
    <ResultOutput
      command={{
        sql_operation: 'SELECT',
        visualization: 'bar',
        rows: [{ label: 'Sample', value: '12.50' }],
      }}
    />,
  );
  expect(screen.getByRole('img', { name: 'Values by category' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Values by category' }).textContent).toContain('12.50');
});

it('keeps values outside the safe chart range in a table without rounding them', () => {
  render(
    <ResultOutput
      command={{
        sql_operation: 'SELECT',
        visualization: 'bar',
        rows: [{ label: 'Sample', value: '9007199254740993' }],
      }}
    />,
  );
  expect(screen.queryByRole('img', { name: 'Values by category' })).toBeNull();
  expect(screen.getByRole('cell', { name: '9007199254740993' })).toBeTruthy();
});

it('makes copy and CSV export available for summary results', async () => {
  const events = userEvent.setup();
  render(
    <ResultOutput
      command={{
        sql_operation: 'SELECT',
        visualization: 'table',
        result_type: 'summary',
        rows: [{ row_count: 65 }],
      }}
    />,
  );
  await events.click(screen.getByText('View result data'));
  expect(screen.getByRole('button', { name: 'Copy results', exact: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download CSV', exact: true })).toBeTruthy();
});
