import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useWorkbench } from './hooks/useWorkbench';
import { useWorkspaces } from './hooks/useWorkspaces';

const user = { account_id: 1 };
const permissions = { read: true, write: true, delete: true, structure: true, export: true };
const personal = { workspace_id: 'personal', name: 'Personal', personal: true, role: 'owner' };
const team = { workspace_id: 'team', name: 'Operations', personal: false, role: 'owner' };
const session = {
  session_id: 'current',
  database: 'team.sqlite3',
  tables: [],
  access: { workspace_id: 'team', role: 'owner', permissions },
};
const response = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('adds a database to the active owner workspace when the form has no explicit destination', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  fetch.mockImplementation(async (path, options) =>
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
  await act(async () => result.current.open({ database_mode: 'create', database_name: 'orders' }));
  const [path, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(path).toBe('/api/sessions');
  expect(JSON.parse(options.body).workspace_id).toBe('team');
});

it('uses personal ownership for new databases when the active team session belongs to a member', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  fetch.mockImplementation(async (path, options) =>
    response(
      path === '/api/status'
        ? { ...session, access: { ...session.access, role: 'member' } }
        : options.method === 'POST'
          ? { ...session, session_id: 'personal-new' }
          : { requests: [] },
    ),
  );
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () =>
    result.current.open({ database_mode: 'create', database_name: 'my-notes' }),
  );
  const [path, options] = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(path).toBe('/api/sessions');
  expect(JSON.parse(options.body).workspace_id).toBeUndefined();
});

it('forgets an ended saved session during restoration', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'ended' }));
  fetch.mockResolvedValue(response({ session_required: true, tables: [] }));
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.session).toBeNull();
  expect(sessionStorage.getItem('data-genie-session')).toBeNull();
  expect(result.current.message).toMatch(/Choose a database/);
});

it('clears an externally ended active session and its displayed requests on focus', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  let ended = false;
  fetch.mockImplementation(async (path) =>
    path === '/api/status'
      ? response(
          ended
            ? { error: 'This session has ended. Start a new session.', code: 'session_unavailable' }
            : session,
          ended ? 400 : 200,
        )
      : response({ requests: [{ request_id: 1, text: 'Saved team request', commands: [] }] }),
  );
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.feed).toHaveLength(1));
  ended = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(result.current.session).toBeNull());
  expect(result.current.feed).toEqual([]);
  expect(sessionStorage.getItem('data-genie-session')).toBeNull();
  expect(result.current.message).toMatch(/Choose a database/);
});

it('ignores an old focus check that completes after a different shared database opens', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  const oldStatus = deferred();
  let statusCalls = 0;
  fetch.mockImplementation(async (path) => {
    if (path === '/api/status') return ++statusCalls === 1 ? response(session) : oldStatus.promise;
    if (path.endsWith('/open')) return response({ ...session, session_id: 'next' });
    return response({ requests: [] });
  });
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => result.current.openShared('team', 9));
  await act(async () =>
    oldStatus.resolve(response({ error: 'Database access was revoked.' }, 403)),
  );
  expect(result.current.session.session_id).toBe('next');
  expect(JSON.parse(sessionStorage.getItem('data-genie-session')).session_id).toBe('next');
  expect(result.current.message).toBe('');
});

it('keeps the newest focus result when an older access check finishes out of order', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
  const oldStatus = deferred();
  let statusCalls = 0;
  fetch.mockImplementation(async (path) => {
    if (path !== '/api/status') return response({ requests: [] });
    statusCalls++;
    if (statusCalls === 2) return oldStatus.promise;
    return response({ ...session, tables: statusCalls > 2 ? ['new_table'] : [] });
  });
  const { result } = renderHook(() => useWorkbench(user));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(result.current.session.tables).toEqual(['new_table']);
  await act(async () =>
    oldStatus.resolve(response({ error: 'Database access was revoked.' }, 403)),
  );
  expect(result.current.session.tables).toEqual(['new_table']);
  expect(result.current.message).toBe('');
});

it('keeps the current workspace details mounted while refreshing a saved access change', async () => {
  const refreshDetails = deferred();
  const details = { workspace: team, members: [], databases: [] };
  let detailCalls = 0;
  fetch.mockImplementation(async (path, options) => {
    if (options.method === 'POST') return response({ ok: true });
    if (path === '/api/workspaces')
      return response({ workspaces: [personal, team], invitations: [] });
    return ++detailCalls === 1 ? response(details) : refreshDetails.promise;
  });
  const { result } = renderHook(() => useWorkspaces('team'));
  await waitFor(() => expect(result.current.details).toEqual(details));
  await act(async () => result.current.act('/api/workspaces/team/grants', {}, 'Access saved.'));
  await waitFor(() => expect(detailCalls).toBe(2));
  expect(result.current.details).toEqual(details);
  expect(result.current.detailsLoading).toBe(false);
  await act(async () => refreshDetails.resolve(response({ ...details, grants: [] })));
  expect(result.current.selected).toBe('team');
  expect(result.current.details.grants).toEqual([]);
});

it('does not show a previously selected workspace when its slower details response arrives last', async () => {
  const oldDetails = deferred();
  fetch.mockImplementation(async (path) => {
    if (path === '/api/workspaces') return response({ workspaces: [personal, team] });
    if (path.endsWith('/team')) return oldDetails.promise;
    return response({ workspace: personal, databases: [] });
  });
  const { result } = renderHook(() => useWorkspaces('team'));
  await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
  await act(async () => result.current.select('personal'));
  await waitFor(() => expect(result.current.details?.workspace.workspace_id).toBe('personal'));
  await act(async () => oldDetails.resolve(response({ workspace: team, members: [] })));
  expect(result.current.selected).toBe('personal');
  expect(result.current.details.workspace.workspace_id).toBe('personal');
});
