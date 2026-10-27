import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { Confirmation, Translation, ResultOutput } from './components/CommandResult';
import AskPage from './pages/AskPage';
import { SqlBlock } from './components/SqlBlock';
import { normalizeCommand } from './hooks/useWorkbench';

const user = {
  account_id: 1,
  first_name: 'Test',
  last_name: 'Reader',
  email: 'reader@example.test',
};
const session = {
  ...user,
  session_id: 'session-1',
  database: 'shop.sqlite',
  source: 'demo',
  started_at: new Date().toISOString(),
  tables: ['customers'],
  table_details: [
    {
      name: 'customers',
      row_count: 6,
      columns: [{ name: 'customer_id', type: 'INTEGER', primary_key: true }],
    },
  ],
  ai: { enabled: false },
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, '', '/');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.GenieTheme = {
    current: 'dark',
    toggle() {
      this.current = this.current === 'dark' ? 'light' : 'dark';
      window.dispatchEvent(new Event('genie-theme'));
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((path) => response(path === '/api/auth/session' ? { user: null } : { sessions: [] })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('React pages and account flow', () => {
  it('keeps the homepage demo confirmation local', async () => {
    const events = userEvent.setup();
    render(<App />);
    await events.click(
      screen.getByRole('button', { name: 'add a customer named Ana Lee in Missouri', exact: true }),
    );
    await events.click(await screen.findByRole('button', { name: 'Add customer', exact: true }));
    expect(screen.getByText('1 row added to customers. Sample only.')).toBeTruthy();
    expect(fetch.mock.calls.every(([, options]) => !options || options.method !== 'POST')).toBe(
      true,
    );
  });

  it('searches FAQ answers and handles no matches', async () => {
    history.replaceState({}, '', '/faq');
    const events = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: 'Search questions and answers' });
    await events.type(search, 'Gemini');
    expect(screen.getByText('4 matching questions')).toBeTruthy();
    await events.clear(search);
    await events.type(search, 'no-matching-words');
    expect(screen.getByText(/No matching questions/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand all' }).disabled).toBe(true);
    await events.click(screen.getByRole('button', { name: 'Clear', exact: true }));
    expect(screen.getByRole('heading', { name: 'Getting started', exact: true })).toBeTruthy();
  });

  it('validates registration then opens the authenticated database chooser', async () => {
    history.replaceState({}, '', '/signup');
    fetch.mockImplementation((path) =>
      response(
        path === '/api/auth/session'
          ? { user: null }
          : path === '/api/auth/register'
            ? { user, csrf_token: 'csrf-test' }
            : { sessions: [] },
      ),
    );
    const events = userEvent.setup();
    render(<App />);
    await events.type(
      await screen.findByRole('textbox', { name: 'First name', exact: true }),
      'Test',
    );
    await events.type(screen.getByRole('textbox', { name: 'Last name', exact: true }), 'Reader');
    await events.type(screen.getByRole('textbox', { name: 'Email', exact: true }), user.email);
    await events.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase');
    await events.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'a different long password',
    );
    await events.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(screen.getByText('The passwords do not match.')).toBeTruthy();
    await events.clear(screen.getByLabelText('Confirm password', { exact: true }));
    await events.type(
      screen.getByLabelText('Confirm password', { exact: true }),
      'a long test passphrase',
    );
    await events.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(
      await screen.findByRole('heading', { name: 'Choose your database.', exact: true }),
    ).toBeTruthy();
    expect(localStorage.getItem('password')).toBeNull();
  });

  it('does not execute a prepared database change until confirmation', async () => {
    history.replaceState({}, '', '/app');
    sessionStorage.setItem(
      'data-genie-session',
      JSON.stringify({ session_id: session.session_id }),
    );
    const command = {
      command_id: 10,
      request_id: 2,
      kind: 'DML',
      sql_operation: 'DELETE',
      operation: 'write',
      sql: 'DELETE FROM customers WHERE customer_id=1',
      status: 'pending',
      requires_confirmation: true,
      confirmation_token: 'command-token',
      preview: { table: 'customers', affected_rows: 1 },
    };
    fetch.mockImplementation((path) =>
      response(
        path === '/api/auth/session'
          ? { user, csrf_token: 'csrf-test' }
          : path === '/api/status'
            ? session
            : path === '/api/history'
              ? { requests: [] }
              : path === '/api/ask'
                ? { ...command, commands: [command] }
                : path === '/api/commands/confirm'
                  ? {
                      ...command,
                      status: 'executed',
                      requires_confirmation: false,
                      changes: 1,
                      message: '1 row(s) affected.',
                    }
                  : { sessions: [] },
      ),
    );
    const events = userEvent.setup();
    render(<App />);
    const question = await screen.findByRole('textbox', {
      name: 'Ask in plain English',
      exact: true,
    });
    await events.type(question, 'delete customer 1{Enter}');
    const confirm = await screen.findByRole('button', { name: 'Delete 1 row', exact: true });
    expect(question.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'New conversation', exact: true }).disabled).toBe(
      true,
    );
    expect(fetch.mock.calls.some(([path]) => path === '/api/commands/confirm')).toBe(false);
    expect(
      JSON.parse(fetch.mock.calls.find(([path]) => path === '/api/ask')[1].body).selected_table,
    ).toBe('customers');
    await events.click(confirm);
    expect((await screen.findAllByText('1 row(s) affected.')).length).toBeGreaterThan(0);
    const call = fetch.mock.calls.find(([path]) => path === '/api/commands/confirm');
    expect(call[1].headers['X-CSRF-Token']).toBe('csrf-test');
    await waitFor(() => expect(question.disabled).toBe(false));
  });

  it('starts a new conversation without restoring earlier turns after reload', async () => {
    history.replaceState({}, '', '/app');
    sessionStorage.setItem(
      'data-genie-session',
      JSON.stringify({ session_id: session.session_id }),
    );
    let boundary = 0;
    const previous = {
      request_id: 1,
      text: 'show customers',
      submitted_at: new Date().toISOString(),
      status: 'executed',
      commands: [{ sql: 'SELECT * FROM customers', status: 'executed', rows: [{ name: 'Ana' }] }],
    };
    fetch.mockImplementation((path) => {
      if (path === '/api/conversation/reset') {
        boundary = 1;
        return response({ conversation_after: boundary });
      }
      return response(
        path === '/api/auth/session'
          ? { user, csrf_token: 'csrf-test' }
          : path === '/api/status'
            ? { ...session, conversation_after: boundary }
            : path === '/api/history'
              ? { requests: [previous] }
              : { sessions: [] },
      );
    });
    const events = userEvent.setup();
    const mounted = render(<App />);
    expect(await screen.findByText('show customers', { exact: true })).toBeTruthy();
    await events.click(screen.getByRole('button', { name: 'New conversation', exact: true }));
    await waitFor(() => expect(screen.queryByText('show customers', { exact: true })).toBeNull());
    const reset = fetch.mock.calls.find(([path]) => path === '/api/conversation/reset');
    expect(reset[1].headers['X-CSRF-Token']).toBe('csrf-test');
    mounted.unmount();
    render(<App />);
    await screen.findByRole('textbox', { name: 'Ask in plain English', exact: true });
    expect(screen.queryByText('show customers', { exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New conversation', exact: true })).toBeNull();
  });
});

describe('command safety', () => {
  it('keeps incomplete input in the composer without submitting it', async () => {
    const submit = vi.fn(),
      setDraft = vi.fn(),
      events = userEvent.setup();
    render(<AskPage workbench={{ session, feed: [], submit }} draft="e" setDraft={setDraft} />);
    await events.click(screen.getByRole('button', { name: 'Ask', exact: true }));
    expect(submit).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox').value).toBe('e');
    expect(screen.getByRole('alert').textContent).toContain(
      'Describe what you want to see or change',
    );
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
  });

  it('accepts a brief contextual reply while still blocking a single letter', async () => {
    const submit = vi.fn(),
      events = userEvent.setup();
    const props = {
      workbench: {
        session,
        feed: [
          {
            request_id: 1,
            text: 'show customers',
            submitted_at: new Date().toISOString(),
            status: 'executed',
            commands: [],
          },
        ],
        submit,
        workingCommands: new Set(),
      },
      selected: 'customers',
      mode: 'gemini',
      setDraft: vi.fn(),
    };
    const view = render(<AskPage {...props} draft="Iowa" />);
    await events.click(screen.getByRole('button', { name: 'Ask', exact: true }));
    expect(submit).toHaveBeenCalledWith('Iowa', false, 'gemini', 'customers');
    view.rerender(<AskPage {...props} draft="e" />);
    await events.click(screen.getByRole('button', { name: 'Ask', exact: true }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain(
      'Describe what you want to see or change',
    );
  });

  it('distinguishes the request, generated SQL, and actual result', () => {
    render(
      <Translation
        request={{
          text: 'show customers',
          status: 'executed',
          submitted_at: new Date().toISOString(),
          commands: [
            { sql: 'SELECT * FROM customers', status: 'executed', rows: [{ name: 'Ana' }] },
          ],
        }}
        workbench={{ workingCommands: new Set() }}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Your request' })).getByText('show customers'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Generated SQL' })).getByRole('button', {
        name: 'Copy SQL',
      }),
    ).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Result' })).getByText('Ana')).toBeTruthy();
  });

  it('shows clarification once without a SQL block or empty result', () => {
    render(
      <Translation
        request={{
          text: 'show me the data',
          status: 'rejected',
          submitted_at: new Date().toISOString(),
          error: 'Which table would you like to see?',
          needs_clarification: true,
          commands: [],
        }}
        workbench={{ workingCommands: new Set() }}
      />,
    );
    expect(screen.getAllByText('Which table would you like to see?').length).toBe(1);
    expect(screen.queryByRole('region', { name: 'Generated SQL' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Result' })).toBeNull();
    expect(screen.getByText('No SQL run. No changes made.')).toBeTruthy();
  });

  it('shows text values in a table instead of inventing numeric chart values', () => {
    render(
      <ResultOutput
        command={{
          visualization: 'bar',
          sql: 'SELECT name AS label, type AS value FROM items',
          rows: [{ label: 'customers', value: 'table' }],
        }}
      />,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('cell', { name: 'table', exact: true })).toBeTruthy();
  });

  it('lets the user choose a schema-based suggestion before submitting', async () => {
    const choose = vi.fn(),
      events = userEvent.setup();
    render(
      <Translation
        request={{
          text: 'visualize the data',
          status: 'rejected',
          submitted_at: new Date().toISOString(),
          error: 'Choose a grouping.',
          needs_clarification: true,
          commands: [],
          suggestions: ['count "customers" by state'],
        }}
        workbench={{ workingCommands: new Set() }}
        onUseSuggestion={choose}
      />,
    );
    await events.click(
      screen.getByRole('button', { name: 'count "customers" by state', exact: true }),
    );
    expect(choose).toHaveBeenCalledWith('count "customers" by state');
  });

  it('keeps grouped results as charts even when only one group matches', () => {
    render(
      <ResultOutput
        command={{
          visualization: 'bar',
          has_aggregation: true,
          result_type: 'summary',
          rows: [{ label: 'Missouri', value: 3 }],
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Values by category' })).toBeTruthy();
  });

  it('requires the exact table name before dropping it and respects earlier steps', async () => {
    const events = userEvent.setup(),
      decide = vi.fn();
    const command = { command_id: 1, sql_operation: 'DROP', preview: { table: 'customers' } };
    const { rerender } = render(<Confirmation command={command} onDecide={decide} />);
    const confirm = screen.getByRole('button', { name: 'Drop table customers', exact: true });
    expect(confirm.disabled).toBe(true);
    await events.type(screen.getByLabelText('Type customers to confirm'), 'Customers');
    expect(confirm.disabled).toBe(true);
    await events.clear(screen.getByLabelText('Type customers to confirm'));
    await events.type(screen.getByLabelText('Type customers to confirm'), 'customers');
    expect(confirm.disabled).toBe(false);
    rerender(
      <Confirmation command={command} onDecide={decide} predecessors={[{ status: 'pending' }]} />,
    );
    expect(confirm.disabled).toBe(true);
  });

  it('renders SQL as text and restores declined commands without confirmation', () => {
    const { container } = render(<SqlBlock sql={"SELECT '<img src=x onerror=alert(1)>'"} />);
    expect(container.querySelector('img')).toBeNull();
    expect(within(container).getByText("'<img src=x onerror=alert(1)>'")).toBeTruthy();
    expect(
      normalizeCommand({
        operation: 'DELETE',
        requires_confirmation: true,
        status: 'declined',
        result: { payload: { changes: 0 } },
      }).requires_confirmation,
    ).toBe(false);
  });
});
