import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountPage from './pages/AccountPage';
import { Router } from './lib/router';

const auth = vi.hoisted(() => ({}));
const appearance = vi.hoisted(() => ({ theme: 'light', toggle: vi.fn() }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./context/ThemeContext', () => ({ useTheme: () => appearance }));
const session = {
  session_id: 'settings-session',
  database: 'Studio.sqlite3',
  source: 'created',
  ai: { enabled: true },
};
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
function account(current = session) {
  const setMode = vi.fn();
  const view = render(
    <Router>
      <AccountPage workbench={{ session: current }} mode="gemini" setMode={setMode} />
    </Router>,
  );
  return { ...view, setMode };
}
beforeEach(() => {
  history.replaceState({}, '', '/account');
  Object.assign(auth, {
    user: {
      account_id: 1,
      first_name: 'Ana',
      last_name: 'Brooks',
      email: 'ana@example.test',
      created_at: 1794355200,
    },
    changePassword: vi.fn().mockResolvedValue('Password updated.'),
    refresh: vi.fn(),
  });
  appearance.theme = 'light';
  appearance.toggle.mockClear();
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      matches: query.includes('reduced-motion'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((path) =>
      response(
        path === '/api/auth/providers'
          ? { microsoft: { enabled: false } }
          : path === '/api/workspaces'
            ? {
                workspaces: [
                  { workspace_id: 'personal', name: 'Personal workspace', role: 'owner' },
                ],
              }
            : { tokens: [] },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows General and Security together and defers agent requests until expanded', async () => {
  const events = userEvent.setup();
  account();
  const general = screen.getByRole('region', { name: 'General', exact: true });
  expect(within(general).getByText('ana@example.test')).toBeTruthy();
  expect(within(general).getByText('Account created')).toBeTruthy();
  expect(
    within(general).getByText(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(1794355200000)),
    ),
  ).toBeTruthy();
  expect(within(general).getByText('Sign-in methods')).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Change password' })).toBeTruthy();
  expect(
    fetch.mock.calls.some(([path]) => ['/api/agent-tokens', '/api/workspaces'].includes(path)),
  ).toBe(false);
  await events.click(screen.getByText('Agents & API', { exact: true }));
  await screen.findByText('No agent keys yet.');
  expect(screen.getByRole('region', { name: 'Browser agents' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Scripts and apps' })).toBeTruthy();
  const previous = fetch.mock.calls.length;
  await events.click(screen.getByText('Agents & API', { exact: true }));
  expect(fetch.mock.calls).toHaveLength(previous);
  await events.click(screen.getByText('Agents & API', { exact: true }));
  await waitFor(() =>
    expect(fetch.mock.calls.filter(([path]) => path === '/api/agent-tokens')).toHaveLength(2),
  );
});

it('does not toggle an already selected theme and lets the user choose their default view', async () => {
  const events = userEvent.setup();
  const { setMode } = account();
  await events.click(screen.getByRole('button', { name: 'Light', exact: true }));
  expect(appearance.toggle).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Dark', exact: true }));
  expect(appearance.toggle).toHaveBeenCalledOnce();
  await events.click(screen.getByRole('radio', { name: 'SQL', exact: true }));
  expect(setMode).toHaveBeenCalledWith('sql');
  expect(screen.getByRole('link', { name: 'Download SQLite file' }).getAttribute('href')).toBe(
    '/api/download?session_id=settings-session',
  );
});

it('uses SQL when AI is unavailable and offers a database entry point without an active session', () => {
  const view = account({ ...session, ai: { enabled: false } });
  expect(screen.getByRole('radio', { name: 'Data Genie AI' }).disabled).toBe(true);
  expect(screen.getByRole('radio', { name: 'SQL', exact: true }).checked).toBe(true);
  view.unmount();
  account(null);
  expect(screen.getByRole('link', { name: 'Choose a database' }).getAttribute('href')).toBe(
    '/databases',
  );
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Download SQLite file' })).toBeNull();
});

it.each([
  { ...session, access: { role: 'viewer', permissions: { export: true, read: true } } },
  { ...session, access: { role: 'member', permissions: { export: false, read: true } } },
  { ...session, source: 'postgresql', read_only: true },
])('never offers a SQLite export without the right source and permission', (current) => {
  account(current);
  expect(screen.queryByRole('link', { name: 'Download SQLite file' })).toBeNull();
  if (current.source === 'postgresql')
    expect(screen.getByText(/Read-only connection/)).toBeTruthy();
});

it('validates password confirmation before submitting and lets the user reveal the draft', async () => {
  const events = userEvent.setup();
  account();
  const current = screen.getByLabelText('Current password');
  const next = screen.getByLabelText('New password', { exact: true });
  const confirm = screen.getByLabelText('Confirm new password');
  expect(next.minLength).toBe(15);
  expect(next.maxLength).toBe(128);
  await events.type(current, 'old fixture passphrase');
  await events.type(next, 'new fixture passphrase');
  await events.type(confirm, 'different passphrase');
  expect(current.value).toBe('old fixture passphrase');
  await events.click(screen.getByRole('button', { name: 'Show passwords' }));
  expect(next.type).toBe('text');
  await events.click(screen.getByRole('button', { name: 'Hide passwords' }));
  expect(next.type).toBe('password');
  await events.click(screen.getByRole('button', { name: 'Update password', exact: true }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'The new passwords do not match.',
  );
  expect(auth.changePassword).not.toHaveBeenCalled();
  await events.clear(confirm);
  await events.type(confirm, 'new fixture passphrase');
  await events.click(screen.getByRole('button', { name: 'Update password', exact: true }));
  await screen.findByText('Password updated.');
  expect(auth.changePassword).toHaveBeenCalledWith({
    current_password: 'old fixture passphrase',
    new_password: 'new fixture passphrase',
    confirm: 'new fixture passphrase',
  });
  expect(current.value).toBe('');
  expect(next.value).toBe('');
  expect(confirm.value).toBe('');
});
