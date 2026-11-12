import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentAccess } from './components/AgentAccess';
import HistoryPage from './pages/HistoryPage';
import { Router } from './lib/router';

const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const workspace = { workspace_id: 'team', name: 'Studio', role: 'owner' };
const token = {
  token_id: 'key',
  name: 'Research',
  workspace_id: 'team',
  scopes: ['reports:read'],
  expires_at: 2100000000,
};
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn((path) =>
      response(path === '/api/workspaces' ? { workspaces: [workspace] } : { tokens: [token] }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState({}, '', '/');
});

it('creates an expiring workspace key, shows it once, and clears it on Done', async () => {
  const user = userEvent.setup();
  render(<AgentAccess passwordEnabled />);
  await user.click(await screen.findByRole('button', { name: 'New agent key' }));
  await user.type(screen.getByLabelText('Key name'), 'Design agent');
  await user.type(screen.getByLabelText('Confirm your password'), 'fixture-only password');
  fetch.mockResolvedValue(
    response({ ...token, token_id: 'new-key', name: 'Design agent', token: 'dg_fixture_secret' }),
  );
  await user.click(screen.getByRole('button', { name: 'Create key' }));
  expect(await screen.findByLabelText('Agent key')).toHaveProperty('value', 'dg_fixture_secret');
  const request = fetch.mock.calls.find(
    ([path, options]) => path === '/api/agent-tokens' && options?.method === 'POST',
  );
  expect(JSON.parse(request[1].body)).toMatchObject({
    workspace_id: 'team',
    days: 30,
    scopes: ['databases:read', 'reports:read'],
  });
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByDisplayValue('dg_fixture_secret')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'New agent key' }));
  expect(screen.queryByLabelText('Agent key')).toBeNull();
});

it('limits viewer creation to report reading and revokes without touching other keys', async () => {
  fetch.mockImplementation((path) =>
    response(
      path === '/api/workspaces'
        ? { workspaces: [{ ...workspace, role: 'viewer' }] }
        : { tokens: [token] },
    ),
  );
  const user = userEvent.setup();
  render(<AgentAccess passwordEnabled />);
  await user.click(await screen.findByRole('button', { name: 'New agent key' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
  expect(within(dialog).getByLabelText('Read reports')).toBeTruthy();
  await user.click(within(dialog).getByLabelText('Read reports'));
  expect(within(dialog).getByRole('button', { name: 'Create key' }).disabled).toBe(true);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Revoke Research' }));
  await screen.findByText('Research revoked. It can no longer make requests.');
  expect(screen.queryByRole('button', { name: 'Revoke Research' })).toBeNull();
  expect(fetch.mock.calls.find(([path]) => path === '/api/agent-tokens/revoke')).toBeTruthy();
});

it('can retry loading agent connections after a temporary error', async () => {
  fetch.mockRejectedValue(new Error('Temporary connection problem'));
  const user = userEvent.setup();
  render(<AgentAccess passwordEnabled />);
  await screen.findByRole('alert');
  fetch.mockImplementation((path) =>
    response(path === '/api/workspaces' ? { workspaces: [workspace] } : { tokens: [] }),
  );
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No agent keys yet.');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'New agent key' }).disabled).toBe(false);
});

it('opens an agent review link as saved history, then explicitly resumes the right session', async () => {
  history.replaceState({}, '', '/history?agent_session=agent-session');
  fetch.mockImplementation((path) =>
    response(
      path === '/api/sessions'
        ? {
            sessions: [
              {
                session_id: 'agent-session',
                database: 'Studio.sqlite3',
                started_at: '2026-11-11T12:00:00Z',
              },
            ],
          }
        : { requests: [], total: 0, has_more: false },
    ),
  );
  const open = vi.fn().mockResolvedValue({});
  render(
    <Router>
      <HistoryPage workbench={{ session: null, open, workingCommands: new Set() }} />
    </Router>,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Review in workspace' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith({}, 'agent-session'));
  expect(location.pathname).toBe('/app');
});
