import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteAccount } from './components/DeleteAccount';
import { Router } from './lib/router';
const remove = vi.hoisted(() => vi.fn());
vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ deleteAccount: remove }) }));
const user = { email: 'ana@example.test', password_enabled: true };
const summary = {
  databases: 2,
  workspaces: [
    {
      workspace_id: 'studio',
      name: 'Studio',
      members: [{ account_id: 2, first_name: 'Jo', last_name: 'Lee', email: 'jo@example.test' }],
    },
  ],
};
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
function setup() {
  render(
    <Router>
      <DeleteAccount user={user} />
    </Router>,
  );
}
beforeEach(() => {
  history.replaceState({}, '', '/account');
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response(summary)),
  );
  remove.mockReset();
  remove.mockResolvedValue({ deleted: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('loads impact only on request and lets the user back out without a deletion', async () => {
  const events = userEvent.setup();
  setup();
  expect(fetch).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Delete account', exact: true }));
  const dialog = await screen.findByRole('dialog');
  await screen.findByText('2 owned databases');
  expect(fetch.mock.calls[0][0]).toBe('/api/auth/deletion');
  expect(within(dialog).getByRole('button', { name: 'Delete account permanently' }).disabled).toBe(
    true,
  );
  await events.click(within(dialog).getByRole('button', { name: 'Keep account' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

it('requires explicit confirmation and submits the chosen workspace transfer with the current password', async () => {
  const events = userEvent.setup();
  setup();
  await events.click(screen.getByRole('button', { name: 'Delete account', exact: true }));
  await screen.findByText('2 owned databases');
  await events.selectOptions(screen.getByLabelText('Ownership of Studio'), '2');
  await events.type(screen.getByLabelText('Your account email'), user.email);
  await events.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  const submit = screen.getByRole('button', { name: 'Delete account permanently' });
  await events.click(submit);
  expect(remove).not.toHaveBeenCalled();
  await events.type(screen.getByLabelText('Current password'), 'fixture-only passphrase');
  await events.click(submit);
  expect(remove).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith({
    email: user.email,
    confirmation: 'DELETE',
    password: 'fixture-only passphrase',
    transfers: { studio: 2 },
  });
  expect(location.pathname + location.search).toBe('/signin?account=deleted');
});

it('retains confirmation choices after a failed deletion and does not replay the request', async () => {
  const events = userEvent.setup();
  remove.mockRejectedValue(new Error('Your current password is incorrect.'));
  setup();
  await events.click(screen.getByRole('button', { name: 'Delete account', exact: true }));
  await screen.findByText('2 owned databases');
  await events.type(screen.getByLabelText('Your account email'), user.email);
  await events.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await events.type(screen.getByLabelText('Current password'), 'wrong password');
  await events.click(screen.getByRole('button', { name: 'Delete account permanently' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Your current password is incorrect.',
  );
  expect(screen.getByLabelText('Type DELETE to confirm').value).toBe('DELETE');
  expect(remove).toHaveBeenCalledOnce();
});
