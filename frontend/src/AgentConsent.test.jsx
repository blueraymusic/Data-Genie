import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from './lib/router';
import AgentConsentPage from './pages/AgentConsentPage';
import {
  captureAgentAuthorization,
  pendingAgentAuthorization,
  clearAgentAuthorization,
} from './lib/agentAuthorization';

vi.mock('./components/AuthShell', () => ({
  AuthShell: ({ title, children }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
const data = {
  client_name: 'Example client',
  callback: 'https://client.example/callback',
  scopes: ['databases:read', 'queries:prepare', 'reports:read', 'reports:write'],
  scope_labels: {
    'databases:read': 'Read databases',
    'queries:prepare': 'Prepare changes',
    'reports:read': 'Read reports',
    'reports:write': 'Write reports',
  },
  workspaces: [
    { workspace_id: 'team', name: 'Studio', role: 'owner' },
    { workspace_id: 'viewer', name: 'Reports only', role: 'viewer' },
  ],
};
beforeEach(() => {
  history.replaceState({}, '', '/connect-agent?flow=' + 'a'.repeat(43));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => data })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState({}, '', '/');
});

it('preserves only a bounded authorization flow across login', () => {
  captureAgentAuthorization('/connect-agent?flow=' + 'a'.repeat(43));
  expect(pendingAgentAuthorization()).toBe('/connect-agent?flow=' + 'a'.repeat(43));
  clearAgentAuthorization();
  captureAgentAuthorization('/connect-agent?flow=https://evil.example');
  expect(pendingAgentAuthorization()).toBe('');
});
it('shows the callback and requires explicit permission before any consent request', async () => {
  const user = userEvent.setup();
  render(
    <Router>
      <AgentConsentPage />
    </Router>,
  );
  await screen.findByText('https://client.example/callback');
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  expect(screen.getByLabelText('Write reports').checked).toBe(false);
  await user.click(screen.getByLabelText('Read databases'));
  await user.click(screen.getByLabelText('Read reports'));
  expect(screen.getByRole('button', { name: 'Allow connection' }).disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText('Workspace'), 'viewer');
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.getByLabelText('Read reports').checked).toBe(true);
});
it('shows server errors without granting permissions or redirecting', async () => {
  render(
    <Router>
      <AgentConsentPage />
    </Router>,
  );
  await screen.findByText('Example client');
  fetch.mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ error: 'This workspace is unavailable.' }),
  });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Allow connection' }));
  await screen.findByText('This workspace is unavailable.');
  expect(location.pathname).toBe('/connect-agent');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Allow connection' }).disabled).toBe(false),
  );
});
