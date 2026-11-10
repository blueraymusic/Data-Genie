import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as baseRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StructurePage from './pages/StructurePage';
import { useWorkbench } from './hooks/useWorkbench';
import { schemaStatement } from './lib/schemaSql';
import { Router } from './lib/router';
const render = (ui) => baseRender(ui, { wrapper: Router });

const table = {
  name: 'order "lines"',
  row_count: 2,
  columns: [
    { name: 'id', type: 'INTEGER', primary_key: true },
    { name: 'item "name"', type: 'TEXT' },
  ],
};
const baseSession = {
  session_id: 'schema-session',
  source: 'demo',
  tables: [table.name],
  table_details: [table],
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const baseWorkbench = (overrides = {}) => ({
  session: baseSession,
  feed: [],
  busy: false,
  pending: false,
  workingCommands: new Set(),
  submit: vi.fn(),
  decide: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  window.scrollTo = vi.fn();
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ tables: [table] })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('manual structure controls', () => {
  it('hides and restores cached samples, refreshes explicitly, and invalidates them after a structure refresh', async () => {
    let samples = 0;
    fetch.mockImplementation((path) =>
      response(
        path === '/api/schema'
          ? { tables: [{ ...table }] }
          : { rows: [{ item: 'sample-' + ++samples }] },
      ),
    );
    const events = userEvent.setup();
    render(<StructurePage workbench={baseWorkbench()} />);
    await events.click(await screen.findByRole('button', { name: 'Sample rows' }));
    expect(await screen.findByText('sample-1')).toBeTruthy();
    const hide = screen.getByRole('button', { name: 'Hide sample rows' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    await events.click(hide);
    expect(screen.queryByText('sample-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh sample rows' })).toBeNull();
    await events.click(screen.getByRole('button', { name: 'Sample rows' }));
    expect(screen.getByText('sample-1')).toBeTruthy();
    expect(samples).toBe(1);
    await events.click(screen.getByRole('button', { name: 'Refresh sample rows' }));
    expect(await screen.findByText('sample-2')).toBeTruthy();
    expect(screen.queryByText('sample-1')).toBeNull();
    await events.click(screen.getByRole('button', { name: 'Refresh structure' }));
    await screen.findByRole('button', { name: 'Sample rows' });
    expect(screen.queryByText('sample-2')).toBeNull();
    await events.click(screen.getByRole('button', { name: 'Sample rows' }));
    expect(await screen.findByText('sample-3')).toBeTruthy();
  });

  it('keeps readable sample rows while hiding copy and download without export permission', async () => {
    fetch.mockImplementation((path) =>
      response(path === '/api/schema' ? { tables: [table] } : { rows: [{ item: 'Readable row' }] }),
    );
    const events = userEvent.setup();
    const session = {
      ...baseSession,
      access: { role: 'member', permissions: { read: true, export: false } },
    };
    render(<StructurePage workbench={baseWorkbench({ session })} />);
    await events.click(await screen.findByRole('button', { name: 'Sample rows' }));
    expect(await screen.findByText('Readable row')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy results' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create table', exact: true }).disabled).toBe(true);
  });

  it('discards an in-flight sample after read access changes', async () => {
    let finishSample;
    fetch.mockImplementation((path) =>
      path === '/api/schema'
        ? response({ tables: [table] })
        : new Promise((resolve) => {
            finishSample = resolve;
          }),
    );
    const events = userEvent.setup();
    const session = { ...baseSession, access: { role: 'member', permissions: { read: true } } };
    const { rerender } = render(<StructurePage workbench={baseWorkbench({ session })} />);
    await events.click(await screen.findByRole('button', { name: 'Sample rows' }));
    rerender(
      <StructurePage
        workbench={baseWorkbench({
          session: { ...session, access: { ...session.access, permissions: { read: false } } },
        })}
      />,
    );
    finishSample(await response({ rows: [{ item: 'Old private sample' }] }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sample rows' }).disabled).toBe(true),
    );
    expect(screen.queryByText('Old private sample')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh sample rows' })).toBeNull();
  });

  it.each([
    ['sqlite', 'INTEGER PRIMARY KEY'],
    ['postgresql', 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'],
  ])('prepares a quoted new table with a %s generated key', async (dialect, key) => {
    const events = userEvent.setup();
    const workbench = baseWorkbench({ session: { ...baseSession, dialect } });
    render(<StructurePage workbench={workbench} />);
    await screen.findByRole('button', { name: `Rename table ${table.name}` });
    await events.click(screen.getByRole('button', { name: 'Create table', exact: true }));
    await events.type(screen.getByRole('textbox', { name: /table name/i }), 'client "notes"');
    await events.click(screen.getByRole('button', { name: 'Review change' }));
    expect(workbench.submit).toHaveBeenCalledExactlyOnceWith(
      `CREATE TABLE "client ""notes""" ("id" ${key})`,
      true,
    );
    expect(workbench.decide).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    [
      'rename-table',
      `Rename table ${table.name}`,
      /new table name/i,
      'new "orders"',
      'ALTER TABLE "order ""lines""" RENAME TO "new ""orders"""',
    ],
    [
      'rename-column',
      `Rename column item "name" in ${table.name}`,
      /new column name/i,
      'display "name"',
      'ALTER TABLE "order ""lines""" RENAME COLUMN "item ""name""" TO "display ""name"""',
    ],
    ['delete-table', `Delete table ${table.name}`, null, null, 'DROP TABLE "order ""lines"""'],
    [
      'delete-column',
      `Delete column item "name" from ${table.name}`,
      null,
      null,
      'ALTER TABLE "order ""lines""" DROP COLUMN "item ""name"""',
    ],
  ])('stages %s for review without executing it', async (action, button, label, name, sql) => {
    const events = userEvent.setup();
    const workbench = baseWorkbench();
    render(<StructurePage workbench={workbench} />);
    await events.click(await screen.findByRole('button', { name: button, exact: true }));
    const dialog = screen.getByRole('dialog');
    if (label) {
      await events.clear(within(dialog).getByRole('textbox', { name: label }));
      await events.type(within(dialog).getByRole('textbox', { name: label }), name);
    }
    await events.click(
      within(dialog).getByRole('button', {
        name: action.startsWith('delete-') ? 'Review deletion' : 'Review change',
      }),
    );
    expect(workbench.submit).toHaveBeenCalledExactlyOnceWith(sql, true);
    expect(workbench.decide).not.toHaveBeenCalled();
  });

  it.each([
    ['sqlite', 'BLOB', 'JSONB'],
    ['postgresql', 'JSONB', 'BLOB'],
  ])('offers %s column types and stages a nullable column', async (dialect, type, unavailable) => {
    const events = userEvent.setup();
    const workbench = baseWorkbench({ session: { ...baseSession, dialect } });
    render(<StructurePage workbench={workbench} />);
    await events.click(await screen.findByRole('button', { name: `Add column to ${table.name}` }));
    await events.type(screen.getByRole('textbox', { name: /column name/i }), 'extra "data"');
    expect(screen.queryByRole('option', { name: unavailable, exact: true })).toBeNull();
    await events.selectOptions(screen.getByRole('combobox', { name: 'Column type' }), type);
    await events.click(screen.getByRole('button', { name: 'Review change' }));
    expect(workbench.submit).toHaveBeenCalledExactlyOnceWith(
      `ALTER TABLE "order ""lines""" ADD COLUMN "extra ""data""" ${type}`,
      true,
    );
  });

  it('preserves the draft and explains duplicate names before sending anything', async () => {
    const events = userEvent.setup();
    const workbench = baseWorkbench();
    render(<StructurePage workbench={workbench} />);
    await events.click(await screen.findByRole('button', { name: `Add column to ${table.name}` }));
    await events.type(screen.getByRole('textbox', { name: /column name/i }), 'ID');
    await events.click(screen.getByRole('button', { name: 'Review change' }));
    expect(screen.getByRole('alert').textContent).toMatch(/column with this name already exists/i);
    expect(screen.getByRole('textbox', { name: /column name/i }).value).toBe('ID');
    expect(workbench.submit).not.toHaveBeenCalled();
    await events.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(workbench.submit).not.toHaveBeenCalled();
  });

  it.each([
    { busy: true },
    { pending: true },
    { workingCommands: new Set([11]) },
    { session: { ...baseSession, source: 'postgresql', read_only: true } },
  ])('blocks editing while busy, pending, confirming, or read-only: %j', async (overrides) => {
    render(<StructurePage workbench={baseWorkbench(overrides)} />);
    const add = await screen.findByRole('button', { name: `Add column to ${table.name}` });
    expect(add.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Create table', exact: true }).disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: `Rename column item "name" in ${table.name}` }).disabled,
    ).toBe(true);
  });

  it('keeps the SQLite primary key and the last column from being deleted', async () => {
    fetch.mockImplementation(() =>
      response({ tables: [{ ...table, columns: [table.columns[0]] }] }),
    );
    render(<StructurePage workbench={baseWorkbench()} />);
    expect(
      (await screen.findByRole('button', { name: `Delete column id from ${table.name}` })).disabled,
    ).toBe(true);
  });

  it('rejects unsafe type input and PostgreSQL names that would be silently truncated', () => {
    expect(() =>
      schemaStatement({
        action: 'add-column',
        name: 'new',
        type: 'TEXT; DROP TABLE x',
        table,
        tables: [table],
        session: baseSession,
      }),
    ).toThrow('Choose an available column type.');
    expect(() =>
      schemaStatement({
        action: 'create-table',
        name: 'é'.repeat(32),
        tables: [table],
        session: { ...baseSession, dialect: 'postgresql' },
      }),
    ).toThrow(/63 bytes/);
    expect(() =>
      schemaStatement({
        action: 'rename-table',
        name: table.name.toUpperCase(),
        table,
        tables: [table],
        session: baseSession,
      }),
    ).toThrow(/already exists/);
  });
});

function LiveStructure() {
  const workbench = useWorkbench({ account_id: 1 });
  return workbench.session ? <StructurePage workbench={workbench} /> : <p>Restoring…</p>;
}

function liveFixture() {
  let current = structuredClone(table);
  const sql = 'ALTER TABLE "order ""lines""" ADD COLUMN "phone" TEXT';
  const command = {
    command_id: 12,
    confirmation_token: 'schema-token',
    sql,
    operation: 'ALTER',
    requires_confirmation: true,
    preview: { table: table.name },
  };
  sessionStorage.setItem(
    'data-genie-session',
    JSON.stringify({ session_id: baseSession.session_id }),
  );
  fetch.mockImplementation((path) => {
    if (path === '/api/status') return response({ ...baseSession, table_details: [current] });
    if (path.startsWith('/api/history')) return response({ requests: [] });
    if (path === '/api/schema') return response({ tables: [current] });
    if (path === '/api/query') return response({ request_id: 3, commands: [command] });
    if (path === '/api/commands/confirm') {
      current = { ...current, columns: [...current.columns, { name: 'phone', type: 'TEXT' }] };
      return response({ status: 'executed', changes: 0, message: 'Table changed.' });
    }
    if (path === '/api/commands/decline') return response({ status: 'declined' });
    throw new Error('Unexpected request ' + path);
  });
  return { sql, command };
}

describe('Structure confirmation flow', () => {
  it('keeps completed changes compact until details are requested', async () => {
    const events = userEvent.setup();
    const feed = Array.from({ length: 100 }, (_, index) => ({
      request_id: index + 1,
      text: `CREATE TABLE saved_${index} (id INTEGER)`,
      status: 'executed',
      submitted_at: new Date().toISOString(),
      commands: [
        {
          command_id: index + 1,
          sql: `CREATE TABLE saved_${index} (id INTEGER)`,
          operation: 'CREATE',
          status: 'executed',
          changes: 0,
        },
      ],
    }));
    render(<StructurePage workbench={baseWorkbench({ feed })} />);
    await screen.findByRole('button', { name: `Add column to ${table.name}` });
    expect(screen.queryByRole('code')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Structure change review' })).toBeNull();
    await events.click(screen.getByText('Last structure change · executed · View details'));
    expect((await screen.findAllByRole('code')).map((node) => node.textContent)).toEqual([
      'CREATE TABLE saved_99 (id INTEGER)',
    ]);
    expect(
      screen.getByRole('link', { name: 'All saved changes in History' }).getAttribute('href'),
    ).toBe('/history');
  });

  it('jumps directly to a selected table without losing keyboard context', async () => {
    const events = userEvent.setup();
    const second = { ...table, name: 'customers' };
    fetch.mockImplementation(() => response({ tables: [table, second] }));
    render(<StructurePage workbench={baseWorkbench()} />);
    const picker = await screen.findByRole('combobox', { name: 'Jump to table' });
    await waitFor(() => expect(picker.disabled).toBe(false));
    await events.selectOptions(picker, 'customers');
    expect(document.activeElement.textContent).toContain('customers');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it.each([false, true])(
    'reviews locally and refreshes structure after decline=%s',
    async (decline) => {
      const events = userEvent.setup();
      const { sql } = liveFixture();
      render(<LiveStructure />);
      await events.click(
        await screen.findByRole('button', { name: `Add column to ${table.name}` }),
      );
      await events.type(screen.getByRole('textbox', { name: /column name/i }), 'phone');
      await events.click(screen.getByRole('button', { name: 'Review change' }));
      const review = await screen.findByRole('region', { name: 'Structure change review' });
      expect(within(review).getByRole('code').textContent).toBe(sql);
      const query = fetch.mock.calls.find(([path]) => path === '/api/query');
      expect(JSON.parse(query[1].body)).toEqual({ sql });
      expect(fetch.mock.calls.some(([path]) => path === '/api/commands/confirm')).toBe(false);
      expect(screen.getByRole('button', { name: 'Create table', exact: true }).disabled).toBe(true);
      const reads = fetch.mock.calls.filter(([path]) => path === '/api/schema').length;
      await events.click(
        within(review).getByRole('button', {
          name: decline ? 'Don’t run' : `Change table ${table.name}`,
        }),
      );
      await waitFor(() =>
        expect(fetch.mock.calls.filter(([path]) => path === '/api/schema').length).toBeGreaterThan(
          reads,
        ),
      );
      if (decline) {
        await events.click(screen.getByText('Last structure change · declined · View details'));
        await screen.findByText('Not run. You declined this.');
        expect(
          screen.queryByRole('button', { name: `Rename column phone in ${table.name}` }),
        ).toBeNull();
      } else {
        await screen.findByRole('button', { name: `Rename column phone in ${table.name}` });
      }
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Create table', exact: true }).disabled).toBe(
          false,
        ),
      );
    },
  );

  it('shows a pending change prepared elsewhere with its local confirm and decline controls', async () => {
    const command = {
      command_id: 4,
      sql: 'DELETE FROM "orders"',
      operation: 'DELETE',
      status: 'pending',
      requires_confirmation: true,
      preview: { table: 'orders', affected_rows: 2 },
    };
    const decide = vi.fn();
    render(
      <StructurePage
        workbench={baseWorkbench({
          pending: true,
          decide,
          feed: [
            {
              request_id: 1,
              text: 'Delete orders',
              status: 'pending',
              submitted_at: new Date().toISOString(),
              commands: [command],
            },
          ],
        })}
      />,
    );
    const review = screen.getByRole('region', { name: 'Structure change review' });
    await userEvent.setup().click(within(review).getByRole('button', { name: 'Don’t run' }));
    expect(decide).toHaveBeenCalledExactlyOnceWith(command, true);
  });
});
