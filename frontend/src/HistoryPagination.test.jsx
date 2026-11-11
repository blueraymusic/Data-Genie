import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryPage from './pages/HistoryPage';

const session = {
  session_id: 'current',
  database: 'current.sqlite3',
  started_at: '2026-11-03T12:00:00Z',
};
const earlier = {
  ...session,
  session_id: 'earlier',
  database: 'earlier.sqlite3',
  ended_at: '2026-11-03T12:30:00Z',
};
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const records = Array.from({ length: 45 }, (_, index) => ({
  request_id: index + 1,
  text: `Record ${index + 1} query`,
  status: 'executed',
  submitted_at: '2026-11-03T12:00:00Z',
  commands: [
    {
      command_id: index + 1,
      sql: `SELECT id FROM notes /* record ${index + 1} */`,
      operation: index % 2 ? 'UPDATE' : 'SELECT',
      status: 'executed',
      result: {
        payload: {
          rows: Array.from({ length: 500 }, (_, row) => ({ id: `row-${index + 1}-${row}` })),
        },
      },
    },
  ],
})).reverse();
const workbench = (overrides = {}) => ({
  session,
  busy: false,
  pending: false,
  workingCommands: new Set(),
  decide: vi.fn(),
  ...overrides,
});

function serve(items = records) {
  fetch.mockImplementation((path) => {
    if (path === '/api/sessions') return response({ sessions: [session, earlier] });
    const query = new URL(path, 'http://localhost').searchParams;
    const found = items.filter(
      (request) =>
        request.text.toLowerCase().includes((query.get('search') || '').toLowerCase()) &&
        (!query.get('operation') ||
          request.commands.some((command) => command.operation === query.get('operation'))),
    );
    const offset = Number(query.get('offset'));
    const limit = Number(query.get('limit'));
    return response({
      requests: found.slice(offset, offset + limit),
      total: found.length,
      offset,
      limit,
      has_more: offset + limit < found.length,
    });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  serve();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('bounds each history page, keeps navigation at both ends, and mounts saved results only when opened', async () => {
  const events = userEvent.setup();
  render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  const bottom = screen.getByRole('navigation', { name: 'History pages bottom' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  expect(document.querySelectorAll('.history-entry')).toHaveLength(20);
  expect(screen.queryByRole('table')).toBeNull();
  expect(within(top).getByRole('button', { name: 'Previous' }).disabled).toBe(true);
  const command = screen.getAllByText(/View SQL and result/)[0];
  await events.click(command);
  expect(await screen.findByRole('table')).toBeTruthy();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  await events.click(command);
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
  await events.click(within(top).getByRole('button', { name: 'Next' }));
  await within(top).findByText('21–40 of 45 requests · Page 2 of 3');
  expect(screen.queryByRole('heading', { name: 'Record 45 query' })).toBeNull();
  expect(document.querySelectorAll('.history-entry')).toHaveLength(20);
  await events.click(within(bottom).getByRole('button', { name: 'Next' }));
  await within(top).findByText('41–45 of 45 requests · Page 3 of 3');
  expect(document.querySelectorAll('.history-entry')).toHaveLength(5);
  expect(within(bottom).getByRole('button', { name: 'Next' }).disabled).toBe(true);
  await events.click(within(bottom).getByRole('button', { name: 'Previous' }));
  await within(top).findByText('21–40 of 45 requests · Page 2 of 3');
  await events.click(within(top).getByRole('button', { name: 'Newest' }));
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  const queries = fetch.mock.calls
    .filter(([path]) => path.startsWith('/api/history?'))
    .map(([path]) => new URL(path, 'http://localhost').searchParams);
  expect(queries.map((query) => query.get('offset'))).toEqual(['0', '20', '40', '20', '0']);
  expect(queries.every((query) => query.get('limit') === '20')).toBe(true);
});

it('resets the API offset for filters and session changes while preserving request reuse', async () => {
  const events = userEvent.setup();
  const reuse = vi.fn();
  render(<HistoryPage workbench={workbench()} onReuse={reuse} />);
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  await events.click(within(top).getByRole('button', { name: 'Next' }));
  await within(top).findByText('21–40 of 45 requests · Page 2 of 3');
  await events.click(screen.getByText(/^Session & operation/));
  await events.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'UPDATE');
  await events.type(screen.getByRole('searchbox', { name: 'Find a request' }), 'Record 4');
  await events.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await within(top).findByText('1–4 of 4 requests · Page 1 of 1');
  const filtered = new URL(
    fetch.mock.calls.filter(([path]) => path.startsWith('/api/history?')).at(-1)[0],
    'http://localhost',
  ).searchParams;
  expect(Object.fromEntries(filtered)).toMatchObject({
    search: 'Record 4',
    operation: 'UPDATE',
    offset: '0',
    limit: '20',
  });
  await events.click(screen.getAllByRole('button', { name: 'Use request', exact: true })[0]);
  expect(reuse.mock.calls[0][0].text).toBe('Record 44 query');
  await events.selectOptions(
    screen.getByRole('combobox', { name: 'Session', exact: true }),
    'earlier',
  );
  await screen.findAllByRole('button', { name: 'Use in current database' });
  const [path, options] = fetch.mock.calls
    .filter(([path]) => path.startsWith('/api/history?'))
    .at(-1);
  expect(new URL(path, 'http://localhost').searchParams.get('history_session_id')).toBe('earlier');
  expect(new URL(path, 'http://localhost').searchParams.get('offset')).toBe('0');
  expect(options.headers['X-Session-ID']).toBe('current');
});

it('keeps current pending confirmations visible and preserves full long requests for reuse', async () => {
  const pending = {
    request_id: 99,
    text: 'Long request\n' + 'keep all of this '.repeat(40),
    status: 'pending',
    submitted_at: '2026-11-03T12:00:00Z',
    commands: [
      {
        command_id: 99,
        sql: 'DELETE FROM notes',
        operation: 'DELETE',
        status: 'pending',
        requires_confirmation: true,
        confirmation_token: 'test-token',
        preview: { table: 'notes', affected_rows: 2 },
      },
    ],
  };
  serve([pending]);
  const decide = vi.fn().mockResolvedValue({});
  render(<HistoryPage workbench={workbench({ pending: true, decide })} onReuse={vi.fn()} />);
  const events = userEvent.setup();
  expect(await screen.findByRole('button', { name: 'Delete 2 rows' })).toBeTruthy();
  expect(screen.queryByText(pending.text)).toBeNull();
  await events.click(screen.getByText('View full request'));
  await waitFor(() =>
    expect(document.querySelector('.history-full-request pre')?.textContent).toBe(pending.text),
  );
  await events.click(screen.getByRole('button', { name: 'Don’t run' }));
  expect(decide).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ command_id: 99, confirmation_token: 'test-token' }),
    true,
  );
  expect(screen.getByRole('button', { name: 'Use request', exact: true }).disabled).toBe(true);
});

it('shows loading and ignores a stale page response after applying new filters', async () => {
  const events = userEvent.setup();
  const original = fetch.getMockImplementation();
  let resolveOld;
  fetch.mockImplementation((path, options) =>
    path.includes('offset=20')
      ? new Promise((resolve) => {
          resolveOld = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ requests: records.slice(20, 40), total: 45, has_more: true }),
            });
        })
      : original(path, options),
  );
  render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  await events.click(within(top).getByRole('button', { name: 'Next' }));
  await within(top).findByText('Loading history…');
  expect(within(top).getByRole('button', { name: 'Next' }).disabled).toBe(true);
  await events.type(screen.getByRole('searchbox', { name: 'Find a request' }), 'Record 45');
  await events.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await within(top).findByText('1–1 of 1 request · Page 1 of 1');
  resolveOld();
  await waitFor(() => expect(document.querySelectorAll('.history-entry')).toHaveLength(1));
  expect(screen.getByRole('heading', { name: 'Record 45 query' })).toBeTruthy();
});

it('applies an operation immediately from page two without submitting an unfinished text search', async () => {
  const events = userEvent.setup();
  render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  await events.click(within(top).getByRole('button', { name: 'Next' }));
  await within(top).findByText('21–40 of 45 requests · Page 2 of 3');
  const search = screen.getByRole('searchbox', { name: 'Find a request' });
  await events.type(search, 'Record 4');
  await events.click(screen.getByText(/^Session & operation/));
  await events.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'UPDATE');
  await within(top).findByText('1–20 of 22 requests · Page 1 of 2');
  const query = new URL(
    fetch.mock.calls.filter(([path]) => path.startsWith('/api/history?')).at(-1)[0],
    'http://localhost',
  ).searchParams;
  expect(Object.fromEntries(query)).toMatchObject({ search: '', operation: 'UPDATE', offset: '0' });
  expect(search.value).toBe('Record 4');
  await events.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await within(top).findByText('1–4 of 4 requests · Page 1 of 1');
});

it('clears applied text with the search field and keeps Clear filters available outside the disclosure', async () => {
  const events = userEvent.setup();
  render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  await events.click(screen.getByText(/^Session & operation/));
  await events.selectOptions(screen.getByRole('combobox', { name: 'Operation' }), 'UPDATE');
  const search = screen.getByRole('searchbox', { name: 'Find a request' });
  await events.type(search, 'Record 4');
  await events.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await within(top).findByText('1–4 of 4 requests · Page 1 of 1');
  await events.clear(search);
  await within(top).findByText('1–20 of 22 requests · Page 1 of 2');
  expect(screen.getByRole('combobox', { name: 'Operation' }).value).toBe('UPDATE');
  await events.click(screen.getByText(/^Session & operation/));
  await events.click(screen.getByRole('button', { name: 'Clear filters' }));
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  expect(search.value).toBe('');
});

it('keeps the empty state compact and restores pagination when requests become available', async () => {
  serve([]);
  const events = userEvent.setup();
  render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  await screen.findByText('No saved requests match these filters.');
  expect(screen.getByRole('status').textContent).toBe('0 requests');
  expect(screen.queryByRole('navigation', { name: 'History pages bottom' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Newest|Previous|Next)$/ })).toBeNull();
  serve();
  await events.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  const top = screen.getByRole('navigation', { name: 'History pages top' });
  await within(top).findByText('1–20 of 45 requests · Page 1 of 3');
  expect(within(top).getByRole('button', { name: 'Next', exact: true }).disabled).toBe(false);
});
