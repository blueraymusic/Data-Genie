import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const user = { account_id: 1, first_name: 'Test', last_name: 'Owner', email: 'owner@example.test' };
const personal = {
  workspace_id: 'personal',
  name: 'Personal workspace',
  personal: true,
  role: 'owner',
};
const previous = {
  workspace_id: 'previous',
  name: 'Previous team',
  personal: false,
  role: 'owner',
};
const session = {
  ...user,
  session_id: 'existing-session',
  database_id: 9,
  database: 'existing.sqlite3',
  started_at: new Date().toISOString(),
  tables: [],
  table_details: [],
  ai: { enabled: true },
  access: {
    workspace_id: previous.workspace_id,
    workspace_name: previous.name,
    role: 'owner',
    permissions: { read: true, write: true, delete: true, structure: true, export: true },
  },
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
function fixture(activeSession = false, fail = false) {
  let created;
  if (activeSession)
    sessionStorage.setItem(
      'data-genie-session',
      JSON.stringify({ session_id: session.session_id }),
    );
  fetch.mockImplementation((path, options = {}) => {
    if (path === '/api/auth/session') return response({ user, csrf_token: 'fixture' });
    if (path === '/api/status') return response(session);
    if (path === '/api/sessions') return response({ sessions: activeSession ? [session] : [] });
    if (path.startsWith('/api/history')) return response({ requests: [] });
    if (path === '/api/workspaces' && options.method === 'POST') {
      if (fail) return response({ error: 'Workspace could not be created. Try again.' }, 503);
      created = {
        workspace_id: 'new-team',
        name: JSON.parse(options.body).name,
        personal: false,
        role: 'owner',
      };
      return response(created, 201);
    }
    if (path === '/api/workspaces')
      return response({
        workspaces: [personal, previous, ...(created ? [created] : [])],
        invitations: [],
      });
    if (path.startsWith('/api/workspaces/')) {
      const workspace = [personal, previous, created].find(
        (item) => item && path.endsWith('/' + item.workspace_id),
      );
      return response({
        workspace,
        databases: [],
        members: [{ ...user, role: 'owner' }],
        grants: [],
        invitations: [],
      });
    }
    return response({});
  });
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, '', '/databases');
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

it.each([false, true])(
  'creates a team from Databases and selects it without replacing the current session (active: %s)',
  async (activeSession) => {
    fixture(activeSession);
    const events = userEvent.setup();
    render(<App />);
    await events.click(
      await screen.findByRole('button', { name: 'Create team workspace', exact: true }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create a workspace' });
    const name = within(dialog).getByRole('textbox', { name: 'New workspace name' });
    expect(document.activeElement).toBe(name);
    expect(location.pathname).toBe('/databases');
    expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    await events.type(name, '  Studio team  ');
    await events.click(within(dialog).getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('heading', { name: 'Studio team' })).toBeTruthy();
    expect(location.search).toBe('?workspace=new-team');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      fetch.mock.calls.filter(
        ([path, options]) => path === '/api/workspaces' && options.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.some(
        ([path, options]) => path.startsWith('/api/sessions') && options.method === 'POST',
      ),
    ).toBe(false);
    expect(
      JSON.parse(sessionStorage.getItem('data-genie-session') || 'null')?.session_id || null,
    ).toBe(activeSession ? session.session_id : null);
  },
);

it('keeps failed creation and cancel on the database chooser', async () => {
  fixture(false, true);
  const events = userEvent.setup();
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'Create team workspace', exact: true });
  await events.click(trigger);
  const dialog = screen.getByRole('dialog');
  await events.type(within(dialog).getByRole('textbox'), 'Studio team');
  await events.click(within(dialog).getByRole('button', { name: 'Create workspace' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByRole('textbox').value).toBe('Studio team');
  await events.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(location.pathname).toBe('/databases');
});
