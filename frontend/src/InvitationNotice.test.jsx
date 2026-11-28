import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { InvitationNotice } from './components/InvitationNotice';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { Router } from './lib/router';
import { ThemeProvider } from './context/ThemeContext';

beforeEach(() => {
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows account invitations after login and clears the notice after acceptance', async () => {
  let invitations = [{ invitation_id: 'one' }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ invitations }),
    })),
  );
  render(
    <Router>
      <InvitationNotice />
    </Router>,
  );
  expect(
    (await screen.findByRole('link', { name: 'Review invitation →' })).getAttribute('href'),
  ).toBe('/workspaces');
  invitations = [];
  act(() => window.dispatchEvent(new Event('dg-workspaces-changed')));
  await waitFor(() => expect(screen.queryByLabelText('Workspace invitations')).toBeNull());
});

it('marks the current page without showing a connection dot beside Workspace', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ invitations: [] }) })),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const identity = { first_name: 'A', last_name: 'User' };
  render(
    <Router>
      <ThemeProvider>
        <WorkspaceHeader
          session={{ ...identity, started_at: new Date().toISOString() }}
          identity={identity}
          view="history"
        />
      </ThemeProvider>
    </Router>,
  );
  expect(
    screen.getByRole('button', { name: 'History', exact: true }).getAttribute('aria-current'),
  ).toBe('page');
  expect(
    screen.getByRole('button', { name: 'Workspace', exact: true }).getAttribute('aria-current'),
  ).toBeNull();
  expect(screen.queryByLabelText('Open session')).toBeNull();
});
