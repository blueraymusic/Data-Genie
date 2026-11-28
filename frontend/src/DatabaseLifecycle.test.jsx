import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseActions } from './components/DatabaseActions';

const database = { database_id: 42, database: 'Sales.sqlite3', provider: 'sqlite' };
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((path) =>
      response(
        path === '/api/workspaces'
          ? {
              workspaces: [
                { workspace_id: 'personal', name: 'Personal', role: 'owner' },
                { workspace_id: 'team', name: 'Team', role: 'owner' },
                { workspace_id: 'other', name: 'Other team', role: 'member' },
              ],
            }
          : { removed: true },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('downloads the selected database in each format and only offers owned destinations', async () => {
  const events = userEvent.setup();
  const refresh = vi.fn(),
    onChanged = vi.fn();
  render(
    <DatabaseActions
      database={database}
      workspaceId="personal"
      owner
      canExport
      workbench={{ session: database, refresh }}
      onChanged={onChanged}
    />,
  );
  await events.click(screen.getByLabelText('Manage Sales.sqlite3'));
  expect(screen.getByRole('link', { name: 'SQLite file' }).getAttribute('href')).toBe(
    '/api/databases/42/download?format=sqlite',
  );
  expect(screen.getByRole('link', { name: 'CSV folder (.zip)' }).getAttribute('href')).toBe(
    '/api/databases/42/download?format=csv',
  );
  expect(screen.getByRole('link', { name: 'SQL dump' }).getAttribute('href')).toBe(
    '/api/databases/42/download?format=sql',
  );
  const destination = await screen.findByRole('combobox', { name: 'Move to workspace' });
  expect(within(destination).queryByRole('option', { name: 'Other team' })).toBeNull();
  await events.selectOptions(destination, 'team');
  await events.click(screen.getByRole('button', { name: 'Move database' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(
    fetch.mock.calls.some(
      ([path, options]) =>
        path === '/api/workspaces/team/attach' && JSON.parse(options.body).database_id === 42,
    ),
  ).toBe(true);
  expect(onChanged).toHaveBeenCalledOnce();
});

it('requires the exact database name and refreshes a removed active database', async () => {
  const events = userEvent.setup(),
    refresh = vi.fn();
  render(
    <DatabaseActions
      database={database}
      workspaceId="personal"
      owner
      canExport
      workbench={{ session: database, refresh }}
    />,
  );
  await events.click(screen.getByLabelText('Manage Sales.sqlite3'));
  await events.click(screen.getByRole('button', { name: 'Remove database' }));
  const dialog = screen.getByRole('dialog');
  const remove = within(dialog).getByRole('button', { name: 'Remove database' });
  expect(remove.disabled).toBe(true);
  const input = within(dialog).getByRole('textbox');
  await events.type(input, 'sales.sqlite3');
  expect(remove.disabled).toBe(true);
  await events.clear(input);
  await events.type(input, 'Sales.sqlite3');
  await events.click(remove);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(
    fetch.mock.calls.some(
      ([path, options]) =>
        path === '/api/databases/42/delete' && JSON.parse(options.body).name === 'Sales.sqlite3',
    ),
  ).toBe(true);
});

it('offers only export controls to a member with download permission', async () => {
  const events = userEvent.setup();
  render(
    <DatabaseActions
      database={database}
      workspaceId="team"
      owner={false}
      canExport
      workbench={{}}
    />,
  );
  await events.click(screen.getByLabelText('Manage Sales.sqlite3'));
  expect(screen.getByRole('link', { name: 'SQLite file' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remove database' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Move to workspace' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('uses one popup for management and removal, then restores keyboard focus on close', async () => {
  const events = userEvent.setup();
  render(
    <DatabaseActions database={database} workspaceId="personal" owner canExport workbench={{}} />,
  );
  const manage = screen.getByRole('button', { name: 'Manage Sales.sqlite3' });
  await events.click(manage);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(document.body.style.overflow).toBe('hidden');
  await events.click(screen.getByRole('button', { name: 'Remove database' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  await events.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove database' })),
  );
  await events.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(manage);
  expect(document.body.style.overflow).not.toBe('hidden');
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
