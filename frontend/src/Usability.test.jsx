import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultTable } from './components/ResultTable';
import { Confirmation, ResultOutput, Translation } from './components/CommandResult';
import { exportRows, sortedRows } from './lib/resultData';
import AskPage from './pages/AskPage';
import { DatabaseForm } from './components/DatabaseForm';
import { api } from './lib/api';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('explains how to recover when the Data Genie server cannot be reached', async () => {
  fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(api('/api/sessions')).rejects.toMatchObject({
    code: 'app_unavailable',
    recovery: 'restart_server',
    message: expect.stringContaining('npm start'),
  });
});

it('connects PostgreSQL with credentials masked and changes disabled by default', async () => {
  const events = userEvent.setup(),
    open = vi.fn().mockResolvedValue();
  render(<DatabaseForm onOpen={open} />);
  await events.click(screen.getByRole('radio', { name: /PostgreSQL/ }));
  const input = screen.getByLabelText('PostgreSQL connection URL');
  expect(input.getAttribute('type')).toBe('password');
  expect(screen.getByLabelText('Allow changes after I confirm them').checked).toBe(false);
  await events.type(input, 'postgresql://user:fixture-password@localhost/shop');
  await events.click(screen.getByRole('button', { name: 'Connect PostgreSQL', exact: true }));
  expect(open).toHaveBeenCalledWith({
    database_mode: 'postgresql',
    database_name: '',
    connection_url: 'postgresql://user:fixture-password@localhost/shop',
    schema_name: 'public',
    allow_changes: false,
  });
  expect(input.value).toBe('');
});

it('tests a PostgreSQL connection and clears stale connection feedback after edits', async () => {
  const events = userEvent.setup();
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      connected: true,
      database: 'shop',
      schema_name: 'public',
      table_count: 2,
    }),
  });
  render(<DatabaseForm onOpen={vi.fn()} />);
  await events.click(screen.getByRole('radio', { name: /PostgreSQL/ }));
  await events.type(
    screen.getByLabelText('PostgreSQL connection URL'),
    'postgresql://user:fixture-password@localhost/shop',
  );
  await events.click(screen.getByRole('button', { name: 'Test connection', exact: true }));
  expect(await screen.findByText('Connected to shop · public · 2 tables')).toBeTruthy();
  expect(fetch.mock.calls[0][0]).toBe('/api/connections/test');
  await events.type(screen.getByLabelText('Schema'), 'other');
  expect(screen.queryByText('Connected to shop · public · 2 tables')).toBeNull();
});

it('accepts a numeric clarification answer and keeps the original goal visible', async () => {
  const events = userEvent.setup(),
    submit = vi.fn();
  render(
    <AskPage
      mode="gemini"
      selected="customers"
      draft="5"
      setDraft={vi.fn()}
      workbench={{
        session: {
          tables: ['customers'],
          pending_intent: 'Generate sample customers with integer IDs.',
        },
        feed: [
          {
            request_id: 1,
            text: 'ints',
            status: 'rejected',
            submitted_at: new Date().toISOString(),
            needs_clarification: true,
            intent: 'Generate sample customers with integer IDs.',
            error: 'How many sample customers should I add?',
            choices: [{ label: '5 rows', request: '5' }],
            commands: [],
          },
        ],
        submit,
        workingCommands: new Set(),
      }}
    />,
  );
  expect(screen.getByText(/Generate sample customers with integer IDs/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '5 rows', exact: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Preview rows', exact: true })).toBeNull();
  await events.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  expect(submit).toHaveBeenCalledWith('5', false, 'gemini', 'customers');
});

it('shows real table inventory as a database inspection without generated SQL', () => {
  render(
    <Translation
      request={{
        text: 'how many tables do I have and what are their names',
        status: 'executed',
        submitted_at: new Date().toISOString(),
        commands: [
          {
            metadata: true,
            inventory: true,
            result_heading: '2 tables in this database',
            answer: 'You have 2 tables: customers, employees.',
            rows: [{ table_name: 'customers' }, { table_name: 'employees' }],
          },
        ],
      }}
      workbench={{ workingCommands: new Set() }}
    />,
  );
  expect(screen.getByRole('heading', { name: '2 tables in this database' })).toBeTruthy();
  expect(screen.getByText('You have 2 tables: customers, employees.')).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'customers', exact: true })).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'employees', exact: true })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Generated SQL' })).toBeNull();
});

it('shows execution summaries only after a write has actually executed', () => {
  const command = {
    command_id: 12,
    sql: "INSERT INTO customers(name) VALUES ('Sample')",
    operation: 'INSERT',
    answer: 'Added a sample customer.',
    status: 'pending',
    requires_confirmation: true,
    preview: { table: 'customers', affected_rows: 1 },
  };
  const workbench = { workingCommands: new Set(), decide: vi.fn() };
  const request = {
    text: 'Add a sample customer',
    submitted_at: new Date().toISOString(),
    status: 'pending',
    commands: [command],
  };
  const { rerender } = render(<Translation request={request} workbench={workbench} />);
  expect(screen.queryByText('Added a sample customer.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Add 1 row' })).toBeTruthy();
  rerender(
    <Translation
      request={{
        ...request,
        status: 'executed',
        commands: [{ ...command, status: 'executed', requires_confirmation: false }],
      }}
      workbench={workbench}
    />,
  );
  expect(screen.getByText('Added a sample customer.')).toBeTruthy();
});

it('sorts numbers numerically, keeps nulls last, and copies the displayed order', async () => {
  const events = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const rows = [{ amount: 10 }, { amount: null }, { amount: 2 }];
  render(<ResultTable rows={rows} />);
  await events.click(screen.getByRole('button', { name: 'amount', exact: true }));
  expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending');
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '10', 'NULL']);
  await events.click(screen.getByRole('button', { name: 'Copy results' }));
  expect(copy).toHaveBeenCalledWith('amount\r\n2\r\n10\r\n');
  await events.click(screen.getByRole('button', { name: 'amount', exact: true }));
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['10', '2', 'NULL']);
  expect(rows[0].amount).toBe(10);
});

it('exports quoted CSV safely without converting numeric negatives to text', () => {
  const text = exportRows([
    { name: '=HYPERLINK("example")', amount: -2 },
    { name: 'a,b\n"c"', amount: null },
  ]);
  expect(text).toBe('"name","amount"\r\n"\'=HYPERLINK(""example"")","-2"\r\n"a,b\n""c""",""');
  expect(exportRows([{ name: '  +formula' }])).toContain("'  +formula");
  expect(
    sortedRows([{ name: 'Customer 10' }, { name: 'Customer 2' }], {
      column: 'name',
      direction: 'asc',
    })[0].name,
  ).toBe('Customer 2');
});

it('loads more from the saved read command without submitting another SQL request', async () => {
  const events = userEvent.setup();
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      rows: [{ id: 2 }],
      has_more: false,
      message: 'Additional rows read from the current database.',
    }),
  });
  render(
    <ResultOutput
      sessionId="session-1"
      command={{
        command_id: 8,
        sql: 'SELECT * FROM customers LIMIT 50',
        sql_operation: 'SELECT',
        rows: [{ id: 1 }],
        has_more: true,
        targets: [{ table_name: 'customers', access_type: 'read' }],
      }}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Show more' }));
  expect(await screen.findByText('2 customers found')).toBeTruthy();
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '2']);
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/results/page?command_id=8&offset=1');
  expect(options.method).toBe('GET');
  expect(options.headers['X-Session-ID']).toBe('session-1');
});

it('offers a concrete recovery request for an empty filtered result', async () => {
  const events = userEvent.setup(),
    useSuggestion = vi.fn();
  render(
    <ResultOutput
      onUseSuggestion={useSuggestion}
      command={{
        sql: "SELECT * FROM customers WHERE state='missing'",
        sql_operation: 'SELECT',
        rows: [],
        recovery: [{ label: 'Show all customers', request: 'show "customers"' }],
      }}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Show all customers' }));
  expect(useSuggestion).toHaveBeenCalledWith('show "customers"');
});

it('uses table names as clarification choices without running SQL', async () => {
  const events = userEvent.setup(),
    useSuggestion = vi.fn();
  render(
    <Translation
      request={{
        request_id: 1,
        text: 'show my data',
        status: 'rejected',
        submitted_at: new Date().toISOString(),
        commands: [],
        needs_clarification: true,
        error: 'Which table would you like to explore?',
        choices: [{ label: 'customers', request: 'show "customers"' }],
      }}
      workbench={{ workingCommands: new Set() }}
      onUseSuggestion={useSuggestion}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'customers', exact: true }));
  expect(useSuggestion).toHaveBeenCalledWith('show "customers"');
  expect(fetch).not.toHaveBeenCalled();
});

it('shows the actual follow-up table and filters and flags a changed selection', () => {
  const props = {
    workbench: {
      session: {
        tables: ['customers', 'sales'],
        conversation_context: {
          tables: ['customers'],
          filters: ['state: Iowa'],
          request: 'which ones are in Iowa?',
        },
      },
      feed: [],
    },
    selected: 'customers',
    draft: '',
    setDraft: vi.fn(),
  };
  const mounted = render(<AskPage {...props} />);
  expect(screen.getByLabelText('Conversation context').textContent).toContain(
    'Following up on customers',
  );
  expect(screen.getByLabelText('Conversation context').textContent).toContain('state: Iowa');
  mounted.rerender(<AskPage {...props} selected="sales" />);
  expect(screen.getByLabelText('Conversation context').textContent).toBe(
    'Using sales · selected table changed',
  );
  expect(screen.getByLabelText('Conversation context').textContent).not.toContain('Iowa');
});

it('uses a precise neutral confirmation for updates and reserves destructive styling for deletion', async () => {
  const events = userEvent.setup(),
    decide = vi.fn();
  const command = {
    command_id: 1,
    sql_operation: 'UPDATE',
    preview: { table: 'customers', affected_rows: 3 },
  };
  const mounted = render(<Confirmation command={command} onDecide={decide} />);
  expect(screen.getByRole('alert').className).toContain('constructive');
  expect(screen.getByText('This will update 3 rows in customers.')).toBeTruthy();
  expect(decide).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Update 3 rows' }));
  expect(decide).toHaveBeenCalledWith(command, false);
  mounted.rerender(
    <Confirmation command={{ ...command, sql_operation: 'DELETE' }} onDecide={decide} />,
  );
  expect(screen.getByRole('alert').className).toContain('destructive');
});
