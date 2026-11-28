import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { useWorkbench } from './hooks/useWorkbench';
import { databaseAccess, canConfirmCommand } from './lib/access';
import { ResultTable } from './components/ResultTable';
import { readWorkspaceInvitation } from './lib/workspaceInvites';

const user = { account_id: 1, first_name: 'Team', last_name: 'Member', email: 'team@example.test' };
const all = { read: true, write: true, delete: true, structure: true, export: true };
const session = {
  ...user,
  session_id: 'current',
  tables: ['customers'],
  table_details: [],
  database: 'customers.sqlite3',
  source: 'created',
  ai: { enabled: true },
  access: { workspace_id: 'team', workspace_name: 'Operations', role: 'member', permissions: all },
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({}, '', '/workspaces');
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

it('applies individual grants, viewer restrictions, and a read-only connection ceiling', () => {
  const limited = {
    ...session,
    access: {
      ...session.access,
      permissions: { read: true, write: true, delete: false, structure: false, export: false },
    },
  };
  expect(
    canConfirmCommand(limited, { sql: "UPDATE customers SET name = 'Lin'", operation: 'write' }),
  ).toBe(true);
  expect(canConfirmCommand(limited, { sql: 'DELETE FROM customers', operation: 'DELETE' })).toBe(
    false,
  );
  expect(
    canConfirmCommand(limited, {
      sql: 'INSERT OR REPLACE INTO customers VALUES (1)',
      operation: 'INSERT',
    }),
  ).toBe(false);
  expect(
    canConfirmCommand(limited, { sql: 'ALTER TABLE customers ADD city TEXT', operation: 'ALTER' }),
  ).toBe(false);
  expect(databaseAccess({ ...session, read_only: true }).permissions).toEqual({
    read: true,
    write: false,
    delete: false,
    structure: false,
    export: true,
  });
  expect(
    databaseAccess({ ...session, access: { ...session.access, role: 'viewer' } }).canRead,
  ).toBe(false);
  expect(databaseAccess({}).permissions).toEqual(all);
});

it('hides provided copy/download actions without export permission while preserving readable rows', () => {
  render(<ResultTable rows={[{ customer: 'Lin' }]} canExport={false} />);
  expect(screen.getByText('Lin')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy results' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
});

it('preserves the chosen workspace when creating a database from an active session', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  fetch.mockImplementation((path, options = {}) =>
    response(
      path === '/api/status'
        ? session
        : options.method === 'POST'
          ? { ...session, session_id: 'new' }
          : { requests: [] },
    ),
  );
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () =>
    result.current.open({
      database_mode: 'create',
      database_name: 'shared.sqlite3',
      workspace_id: 'another-team',
      starter: false,
    }),
  );
  const [path, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(path).toBe('/api/sessions');
  expect(JSON.parse(options.body).workspace_id).toBe('another-team');
  expect(result.current.session.session_id).toBe('new');
});

it('opens a shared database and refuses to switch while an earlier command is pending', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  fetch.mockImplementation((path) =>
    response(
      path === '/api/status'
        ? session
        : {
            requests: [
              {
                request_id: 1,
                text: 'Change customers',
                commands: [{ command_id: 1, status: 'pending', requires_confirmation: true }],
              },
            ],
          },
    ),
  );
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.pending).toBe(true));
  await expect(result.current.openShared('other-team', 5)).rejects.toThrow('Confirm or decline');
  expect(fetch.mock.calls.some(([path]) => path.includes('/open'))).toBe(false);
});

it('clears previously loaded database data when a focus check reports revoked access', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  let revoked = false;
  fetch.mockImplementation((path) =>
    path === '/api/status'
      ? response(revoked ? { error: 'Database access was revoked.' } : session, revoked ? 403 : 200)
      : response({ requests: [{ request_id: 1, text: 'Private request', commands: [] }] }),
  );
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.feed).toHaveLength(1));
  revoked = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(result.current.session).toBeNull());
  expect(result.current.feed).toHaveLength(0);
  expect(sessionStorage.getItem('data-genie-session')).toBeNull();
});

it('does not fetch or render database history or SQL for a viewer session', async () => {
  history.replaceState({}, '', '/app?view=sql');
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  const workspace = { workspace_id: 'team', name: 'Operations', role: 'viewer', personal: false };
  fetch.mockImplementation((path) =>
    response(
      path === '/api/auth/session'
        ? { user, csrf_token: 'token' }
        : path === '/api/status'
          ? { ...session, access: { ...session.access, role: 'viewer' } }
          : path === '/api/workspaces'
            ? { workspaces: [workspace], invitations: [] }
            : { workspace, databases: [] },
    ),
  );
  render(<App />);
  expect(await screen.findByText('No reports have been shared yet.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Run SQL.' })).toBeNull();
  expect(fetch.mock.calls.some(([path]) => path.startsWith('/api/history'))).toBe(false);
});

it('keeps an invitation through login, removes its token from the URL, and waits for explicit acceptance', async () => {
  history.replaceState({}, '', '/workspaces?invite=invitation-2&token=private-token');
  const events = userEvent.setup(),
    workspace = { workspace_id: 'personal', name: 'Personal', role: 'owner', personal: true };
  fetch.mockImplementation((path) =>
    response(
      path === '/api/auth/session'
        ? { user: null }
        : path === '/api/auth/login'
          ? { user, csrf_token: 'token' }
          : path === '/api/workspaces'
            ? {
                workspaces: [workspace],
                invitations: [
                  {
                    invitation_id: 'invitation-2',
                    workspace_id: 'team',
                    workspace_name: 'Operations',
                    role: 'member',
                    expires_at: '2030-01-01',
                  },
                ],
              }
            : { workspace, members: [], databases: [] },
    ),
  );
  render(<App />);
  await events.type(await screen.findByRole('textbox', { name: 'Email' }), user.email);
  expect(location.search).toBe('');
  expect(readWorkspaceInvitation()?.token).toBe('private-token');
  await events.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase');
  await events.click(screen.getByRole('button', { name: 'Log in', exact: true }));
  expect(await screen.findByRole('button', { name: 'Join workspace' })).toBeTruthy();
  expect(location.pathname).toBe('/workspaces');
  expect(screen.getByLabelText('Invitation link or code').value).toBe('private-token');
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/accept'))).toBe(false);
});
