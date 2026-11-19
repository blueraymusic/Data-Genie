import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const user = {
  account_id: 7,
  first_name: 'SQL',
  last_name: 'Reader',
  email: 'sql@example.test',
};
const session = {
  ...user,
  session_id: 'sql-session',
  database_id: 7,
  database: 'notes.sqlite3',
  source: 'created',
  started_at: new Date().toISOString(),
  tables: ['order items'],
  table_details: [{ name: 'order items', columns: [{ name: 'id', type: 'INTEGER' }] }],
  ai: { enabled: true },
};
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
function setup({ path = '/app?view=sql', active = true, data = session, saved = [] } = {}) {
  history.replaceState({}, '', path);
  if (active)
    sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: data.session_id }));
  fetch.mockImplementation((path) =>
    response(
      path === '/api/auth/session'
        ? { user, csrf_token: 'test-token' }
        : path === '/api/status' || path === '/api/sessions/resume'
          ? data
          : path === '/api/sessions'
            ? { sessions: saved }
            : { requests: [] },
    ),
  );
  return fetch.getMockImplementation();
}
async function chooseExample(events, name) {
  await events.click(screen.getByRole('button', { name: 'Examples', exact: true }));
  await events.click(screen.getByRole('button', { name, exact: true }));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SQL workspace', () => {
  it('runs a quoted-table example through the SQL API without invoking AI', async () => {
    const base = setup();
    fetch.mockImplementation((path, options) =>
      path === '/api/query'
        ? response({
            request_id: 3,
            command_id: 9,
            sql: JSON.parse(options.body).sql,
            sql_operation: 'SELECT',
            rows: [{ id: 1 }],
          })
        : base(path, options),
    );
    const events = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
    const tabs = screen.getByRole('navigation', { name: 'Workspace views' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Ask', 'SQL', 'Structure']);
    await chooseExample(events, 'Preview rows');
    expect(input.value).toBe('SELECT * FROM "order items" LIMIT 50;');
    await chooseExample(events, 'Filter rows');
    expect(input.value).toBe('SELECT * FROM "order items" WHERE "id" IS NOT NULL LIMIT 50;');
    await chooseExample(events, 'Preview rows');
    expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(false);
    await events.click(screen.getByRole('button', { name: 'Run SQL', exact: true }));
    expect(await screen.findByRole('cell', { name: '1', exact: true })).toBeTruthy();
    const [, options] = fetch.mock.calls.find(([path]) => path === '/api/query');
    expect(JSON.parse(options.body)).toEqual({ sql: 'SELECT * FROM "order items" LIMIT 50;' });
    expect(options.headers['X-Session-ID']).toBe(session.session_id);
    expect(fetch.mock.calls.some(([path]) => path === '/api/ask')).toBe(false);
  });

  it.each(['Control', 'Meta'])(
    'runs SQL with %s+Enter while plain Enter keeps a newline',
    async (modifier) => {
      const base = setup();
      fetch.mockImplementation((path, options) =>
        path === '/api/query'
          ? response({
              request_id: 29,
              command_id: 30,
              sql: JSON.parse(options.body).sql,
              sql_operation: 'SELECT',
              rows: [{ value: 4 }],
            })
          : base(path, options),
      );
      const events = userEvent.setup();
      render(<App />);
      const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
      await events.type(input, 'SELECT{Enter}4 AS value;');
      expect(input.value).toBe('SELECT\n4 AS value;');
      expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(false);
      await events.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
      expect(await screen.findByRole('cell', { name: '4', exact: true })).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(input.closest('.sql-composer')).toBeTruthy();
      const feed = document.getElementById('sql-feed');
      expect(
        feed.compareDocumentPosition(input.closest('.sql-composer')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(feed.querySelector('.exchange-results').scrollIntoView).toHaveBeenCalled();
    },
  );

  it('keeps examples and help compact and returns focus to the editor or disclosure', async () => {
    setup();
    const events = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
    expect(screen.queryByRole('button', { name: 'Preview rows', exact: true })).toBeNull();
    await chooseExample(events, 'Preview rows');
    expect(screen.queryByRole('group', { name: 'SQLite examples' })).toBeNull();
    expect(document.activeElement).toBe(input);
    const help = screen.getByRole('button', { name: 'SQLite syntax help', exact: true });
    await events.click(help);
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'SQLite syntax help' })).toBeTruthy();
    await events.keyboard('{Escape}');
    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(help);
    expect(screen.queryByRole('region', { name: 'SQLite syntax help' })).toBeNull();
  });

  it('keeps a long SQL feed bounded and lets earlier requests stay in view until returning to latest', async () => {
    const base = setup();
    const requests = Array.from({ length: 30 }, (_, index) => ({
      request_id: index + 1,
      text: `SELECT ${index + 1} AS value;`,
      status: 'executed',
      submitted_at: session.started_at,
      commands: [
        {
          command_id: index + 100,
          sql: `SELECT ${index + 1} AS value;`,
          status: 'executed',
          sql_operation: 'SELECT',
          rows: [{ value: index + 1 }],
        },
      ],
    })).reverse();
    fetch.mockImplementation((path, options) =>
      path.startsWith('/api/history?') && path.includes('include_pending=1')
        ? response({ requests })
        : base(path, options),
    );
    const events = userEvent.setup();
    render(<App />);
    await screen.findByRole('cell', { name: '30', exact: true });
    const feed = document.getElementById('sql-feed');
    expect(feed.querySelectorAll(':scope > article')).toHaveLength(8);
    expect(within(feed).queryByRole('cell', { name: '1', exact: true })).toBeNull();
    Element.prototype.scrollIntoView.mockClear();
    await events.click(screen.getByRole('button', { name: 'Show earlier requests', exact: true }));
    expect(feed.querySelectorAll(':scope > article')).toHaveLength(10);
    expect(within(feed).queryByRole('cell', { name: '30', exact: true })).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    const input = screen.getByRole('textbox', { name: 'SQL statement', exact: true });
    expect(input.closest('.sql-composer')).toBeTruthy();
    await events.click(
      within(input.closest('.sql-composer')).getByRole('button', {
        name: 'Jump to latest',
        exact: true,
      }),
    );
    expect(feed.querySelectorAll(':scope > article')).toHaveLength(8);
    expect(within(feed).getByRole('cell', { name: '30', exact: true })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(
      screen.queryByText('Write SQLite SQL directly. No AI service or AI key needed.'),
    ).toBeNull();
  });

  it('keeps SQL writes pending until confirmation and blocks another statement', async () => {
    const base = setup();
    const command = {
      request_id: 4,
      command_id: 10,
      sql: 'DELETE FROM "order items" WHERE id = 1;',
      sql_operation: 'DELETE',
      status: 'pending',
      requires_confirmation: true,
      confirmation_token: 'confirm-token',
      preview: { table: 'order items', affected_rows: 1 },
    };
    fetch.mockImplementation((path, options) =>
      path === '/api/query'
        ? response({ ...command, commands: [command] })
        : path === '/api/commands/confirm'
          ? response({
              ...command,
              status: 'executed',
              requires_confirmation: false,
              changes: 1,
              message: 'One item deleted.',
            })
          : base(path, options),
    );
    const events = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
    await events.type(input, command.sql);
    await events.click(screen.getByRole('button', { name: 'Run SQL', exact: true }));
    const confirm = await screen.findByRole('button', { name: 'Delete 1 row', exact: true });
    expect(input.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Examples', exact: true }).disabled).toBe(true);
    expect(fetch.mock.calls.some(([path]) => path === '/api/commands/confirm')).toBe(false);
    await events.click(confirm);
    expect(await screen.findByText('One item deleted.')).toBeTruthy();
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(
      JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/commands/confirm')[1].body),
    ).toEqual({ command_id: 10, confirmation_token: 'confirm-token' });
  });

  it.each([
    [session, 'SQLite syntax help', 'INTEGER PRIMARY KEY', "SELECT date('now') AS today;"],
    [
      {
        ...session,
        source: 'postgresql',
        dialect: 'postgresql',
        schema_name: 'public',
        read_only: false,
      },
      'PostgreSQL syntax help',
      'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
      'SELECT CURRENT_DATE AS today FROM "order items" LIMIT 1;',
    ],
  ])(
    'offers syntax and examples for the connected dialect',
    async (data, help, identity, dateSql) => {
      setup({ data });
      const events = userEvent.setup();
      render(<App />);
      const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
      await events.click(screen.getByText(help));
      expect(
        screen.getByText((text, element) => element.tagName === 'CODE' && text.includes(identity)),
      ).toBeTruthy();
      await chooseExample(events, "Get today's date");
      expect(input.value).toBe(dateSql);
      await chooseExample(events, 'Create a notes table');
      expect(input.value).toContain(identity);
      expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(false);
    },
  );

  it.each([true, false])(
    'avoids unsupported PostgreSQL constant reads when no tables exist',
    async (readOnly) => {
      setup({
        data: {
          ...session,
          source: 'postgresql',
          dialect: 'postgresql',
          read_only: readOnly,
          tables: [],
          table_details: [],
        },
      });
      render(<App />);
      const input = await screen.findByRole('textbox', { name: 'SQL statement', exact: true });
      expect(input.placeholder).not.toContain('SELECT 1');
      expect(screen.queryByRole('button', { name: 'Try a simple read', exact: true })).toBeNull();
      expect(screen.queryByRole('button', { name: "Get today's date", exact: true })).toBeNull();
      expect(
        screen.getByText(
          readOnly
            ? 'This schema has no readable tables. Choose a schema with tables before running queries.'
            : 'This schema has no tables yet. Create a table before running queries.',
        ),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Create a table', exact: true }).disabled).toBe(
        readOnly,
      );
      expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(false);
    },
  );

  it('validates PostgreSQL name bytes in the global new-table dialog before preparing SQL', async () => {
    const base = setup({
      data: { ...session, source: 'postgresql', dialect: 'postgresql', read_only: false },
    });
    fetch.mockImplementation((path, options) =>
      path === '/api/query'
        ? response({
            request_id: 17,
            commands: [
              {
                command_id: 18,
                sql: JSON.parse(options.body).sql,
                sql_operation: 'CREATE',
                status: 'pending',
                requires_confirmation: true,
                preview: { table: 'notes next' },
              },
            ],
          })
        : base(path, options),
    );
    const events = userEvent.setup();
    render(<App />);
    await events.click(await screen.findByRole('button', { name: 'Create a table', exact: true }));
    const input = screen.getByRole('textbox', { name: 'Table name', exact: true });
    await events.type(input, 'é'.repeat(32));
    await events.click(screen.getByRole('button', { name: 'Review table', exact: true }));
    expect(
      screen.getByText('PostgreSQL names must be 63 bytes or fewer. Choose a shorter name.'),
    ).toBeTruthy();
    expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(false);
    await events.clear(input);
    await events.type(input, 'notes next');
    await events.click(screen.getByRole('button', { name: 'Review table', exact: true }));
    await screen.findByRole('button', { name: 'Create table notes next', exact: true });
    expect(JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/query')[1].body)).toEqual({
      sql: 'CREATE TABLE "notes next" ("id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY)',
    });
  });

  it('keeps an explicit Ask route available and guides unavailable AI to SQL', async () => {
    setup({ path: '/app?view=ask', data: { ...session, ai: { enabled: false } } });
    localStorage.setItem('dg-request-mode:7', 'sql');
    const events = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Ask in plain English', exact: true });
    expect(location.search).toBe('?view=ask');
    expect(input.disabled).toBe(true);
    expect(within(input.form).getByRole('button', { name: 'Ask', exact: true }).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Data Genie AI is unavailable/)).toBeTruthy();
    await events.click(screen.getByRole('link', { name: 'Open SQL', exact: true }));
    expect(
      (await screen.findByRole('textbox', { name: 'SQL statement', exact: true })).disabled,
    ).toBe(false);
    expect(fetch.mock.calls.some(([path]) => path === '/api/ask')).toBe(false);
  });

  it('uses Data Genie AI on Ask even when SQL is the saved default and keeps both drafts across tabs', async () => {
    const base = setup({ path: '/app?view=ask' });
    localStorage.setItem('dg-request-mode:7', 'sql');
    fetch.mockImplementation((path, options) =>
      path === '/api/ask'
        ? response({ matched: false, request_id: 8, message: 'Please name a column.' })
        : base(path, options),
    );
    const events = userEvent.setup();
    render(<App />);
    await events.type(
      await screen.findByRole('textbox', { name: 'Ask in plain English', exact: true }),
      'show recent orders',
    );
    const tabs = screen.getByRole('navigation', { name: 'Workspace views' });
    await events.click(within(tabs).getByRole('button', { name: 'SQL', exact: true }));
    await events.type(
      screen.getByRole('textbox', { name: 'SQL statement', exact: true }),
      'SELECT 5;',
    );
    await events.click(within(tabs).getByRole('button', { name: 'Ask', exact: true }));
    expect(screen.getByRole('textbox', { name: 'Ask in plain English', exact: true }).value).toBe(
      'show recent orders',
    );
    await events.click(
      within(
        screen.getByRole('textbox', { name: 'Ask in plain English', exact: true }).form,
      ).getByRole('button', { name: 'Ask', exact: true }),
    );
    await screen.findByText('Please name a column.');
    expect(JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/ask')[1].body)).toEqual({
      question: 'show recent orders',
      interpreter: 'gemini',
      selected_table: 'order items',
    });
    await events.click(within(tabs).getByRole('button', { name: 'SQL', exact: true }));
    expect(screen.getByRole('textbox', { name: 'SQL statement', exact: true }).value).toBe(
      'SELECT 5;',
    );
  });

  it('migrates the saved Keywords preference to SQL and explains the default view', async () => {
    setup({ path: '/account' });
    localStorage.setItem('dg-request-mode:7', 'keywords');
    const events = userEvent.setup();
    render(<App />);
    const mode = await screen.findByRole('group', {
      name: 'Default workspace view',
      exact: true,
    });
    expect(within(mode).getByRole('radio', { name: 'SQL', exact: true }).checked).toBe(true);
    expect(localStorage.getItem('dg-request-mode:7')).toBe('sql');
    expect(
      within(mode)
        .getAllByRole('radio')
        .map((option) => option.getAttribute('aria-label')),
    ).toEqual(['Data Genie AI', 'SQL']);
    expect(screen.getByText(/Local SQLite works offline while Data Genie is running/)).toBeTruthy();
    await events.click(within(mode).getByRole('radio', { name: 'Data Genie AI' }));
    expect(localStorage.getItem('dg-request-mode:7')).toBe('gemini');
    expect(location.pathname).toBe('/account');
  });

  it.each([
    [false, null, 'SQL statement'],
    [false, 'gemini', 'SQL statement'],
    [true, 'sql', 'SQL statement'],
    [true, null, 'Ask in plain English'],
  ])(
    'opens a database in the usable saved default without changing an explicit tab later',
    async (enabled, preference, textbox) => {
      setup({
        path: '/app',
        active: false,
        data: { ...session, ai: { enabled } },
        saved: [session],
      });
      if (preference) localStorage.setItem('dg-request-mode:7', preference);
      const events = userEvent.setup();
      render(<App />);
      await events.click(await screen.findByRole('button', { name: /notes\.sqlite3.*Open/ }));
      expect(await screen.findByRole('textbox', { name: textbox, exact: true })).toBeTruthy();
      const tabs = screen.getByRole('navigation', { name: 'Workspace views' });
      await events.click(within(tabs).getByRole('button', { name: 'Ask', exact: true }));
      expect(
        await screen.findByRole('textbox', { name: 'Ask in plain English', exact: true }),
      ).toBeTruthy();
      expect(location.search).toBe('?view=ask');
    },
  );

  it.each([
    ['/app?view=ask', 'sql', 'Ask in plain English'],
    ['/app?view=sql#saved-result', 'gemini', 'SQL statement'],
  ])('keeps a workspace deep link when choosing its database', async (path, preference, label) => {
    setup({ path, active: false, saved: [session] });
    localStorage.setItem('dg-request-mode:7', preference);
    const events = userEvent.setup();
    render(<App />);
    await events.click(await screen.findByRole('button', { name: /notes\.sqlite3.*Open/ }));
    expect(await screen.findByRole('textbox', { name: label, exact: true })).toBeTruthy();
    expect(location.pathname + location.search + location.hash).toBe(path);
  });

  it('clears both editor drafts after a successful switch to a fresh session', async () => {
    const remote = {
      ...session,
      session_id: 'fresh-session',
      database_id: 8,
      database: 'other.sqlite3',
    };
    const base = setup({ saved: [session, remote] });
    let current = session;
    fetch.mockImplementation((path, options) => {
      if (path === '/api/status') return response(current);
      if (path === '/api/sessions/resume') {
        current = remote;
        return response(remote);
      }
      return base(path, options);
    });
    const events = userEvent.setup();
    render(<App />);
    await events.type(
      await screen.findByRole('textbox', { name: 'SQL statement', exact: true }),
      'SELECT 5;',
    );
    let tabs = screen.getByRole('navigation', { name: 'Workspace views' });
    await events.click(within(tabs).getByRole('button', { name: 'Ask', exact: true }));
    await events.type(
      screen.getByRole('textbox', { name: 'Ask in plain English', exact: true }),
      'show recent items',
    );
    await events.click(screen.getByRole('button', { name: 'Change', exact: true }));
    await events.click(await screen.findByRole('button', { name: /other\.sqlite3.*Open/ }));
    expect(
      (await screen.findByRole('textbox', { name: 'Ask in plain English', exact: true })).value,
    ).toBe('');
    tabs = screen.getByRole('navigation', { name: 'Workspace views' });
    await events.click(within(tabs).getByRole('button', { name: 'SQL', exact: true }));
    expect(screen.getByRole('textbox', { name: 'SQL statement', exact: true }).value).toBe('');
  });

  it.each([
    [
      'SELECT 8 AS value;',
      'SQL statement',
      'gemini',
      [{ command_id: 21, sql: 'SELECT 8 AS value;', status: 'executed' }],
    ],
    [
      'show order items',
      'Ask in plain English',
      'sql',
      [{ command_id: 21, sql: 'SELECT * FROM "order items"', status: 'executed' }],
    ],
  ])(
    'reuses saved input in its matching editor without submitting it',
    async (text, label, preference, commands) => {
      const base = setup({ path: '/history', saved: [session] });
      localStorage.setItem('dg-request-mode:7', preference);
      fetch.mockImplementation((path, options) =>
        path.startsWith('/api/history?') && !path.includes('include_pending=1')
          ? response({
              requests: [
                {
                  request_id: 20,
                  text,
                  submitted_at: session.started_at,
                  status: 'executed',
                  commands,
                },
              ],
            })
          : base(path, options),
      );
      const events = userEvent.setup();
      render(<App />);
      await events.click(await screen.findByRole('button', { name: 'Use request', exact: true }));
      expect((await screen.findByRole('textbox', { name: label, exact: true })).value).toBe(text);
      expect(fetch.mock.calls.some(([path]) => path === '/api/query' || path === '/api/ask')).toBe(
        false,
      );
    },
  );
});
