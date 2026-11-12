import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceOwnership } from './components/WorkspaceOwnership';
import { OwnershipRequests } from './components/OwnershipRequests';
const user = { account_id: 1, password_enabled: true };
vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ user }) }));
const workspace = {
  workspace_id: 'studio',
  name: 'Design studio',
  owner_account_id: 1,
  role: 'owner',
};
const members = [
  { account_id: 1, first_name: 'Ana', last_name: 'Brooks', email: 'ana@example.test' },
  { account_id: 2, first_name: 'Jo', last_name: 'Lee', email: 'jo@example.test' },
];
const request = {
  transfer_id: 'request-1',
  workspace_id: 'studio',
  workspace_name: 'Design studio',
  sender_account_id: 1,
  recipient_account_id: 2,
  sender: members[0],
  recipient: members[1],
  status: 'pending',
  expires_at: 2100000000,
};
const review = {
  ...request,
  databases: 2,
  postgres_connections: 1,
  members: 3,
  review_version: 'review-v1',
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response(request)),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sends a request without transferring immediately or deleting the account', async () => {
  const events = userEvent.setup(),
    changed = vi.fn();
  render(<WorkspaceOwnership workspace={workspace} members={members} onChanged={changed} />);
  expect(fetch).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Transfer ownership', exact: true }));
  await events.selectOptions(screen.getByLabelText('Recipient'), '2');
  await events.type(screen.getByLabelText('Type the workspace name'), workspace.name);
  await events.type(screen.getByLabelText('Current password'), 'fixture-only passphrase');
  await events.click(screen.getByRole('button', { name: 'Send ownership request' }));
  await screen.findByText('Ownership request sent. The recipient can review it in Teams.');
  const [path, options] = fetch.mock.calls[0];
  expect(path).toBe('/api/workspaces/studio/ownership-transfer');
  expect(JSON.parse(options.body)).toEqual({
    recipient_account_id: 2,
    name: workspace.name,
    password: 'fixture-only passphrase',
  });
  expect(changed).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.some(([path]) => path === '/api/auth/delete')).toBe(false);
});

it('lets the owner cancel a pending request', async () => {
  const changed = vi.fn();
  fetch.mockResolvedValue(response({ status: 'cancelled' }));
  render(
    <WorkspaceOwnership
      workspace={{ ...workspace, ownership_transfer: request }}
      members={members}
      onChanged={changed}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Transfer ownership', exact: true })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel transfer request' }));
  expect(fetch.mock.calls[0][0]).toBe('/api/ownership-transfers/request-1/cancel');
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it('does not expose owner controls or make requests for a member', () => {
  render(<WorkspaceOwnership workspace={{ ...workspace, role: 'member' }} members={members} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('offers an invitation step if no other members have joined', async () => {
  const invite = vi.fn();
  render(<WorkspaceOwnership workspace={workspace} members={[members[0]]} onInvite={invite} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Transfer ownership', exact: true }));
  await userEvent.setup().click(screen.getByRole('button', { name: 'People & access' }));
  expect(invite).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

async function openInbox(events, complete) {
  render(<OwnershipRequests requests={[request]} onComplete={complete} />);
  expect(fetch).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Review request' }));
  await screen.findByText('2 databases · 3 members');
}
it('loads a fresh review and requires the recipient password before acceptance', async () => {
  const events = userEvent.setup(),
    complete = vi.fn();
  fetch.mockImplementation((path) =>
    response(path.endsWith('/accept') ? { status: 'accepted', workspace_id: 'studio' } : review),
  );
  await openInbox(events, complete);
  await events.click(screen.getByRole('button', { name: 'Accept ownership' }));
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
  await events.type(screen.getByLabelText('Confirm your password'), 'fixture-only passphrase');
  await events.click(screen.getByRole('button', { name: 'Accept ownership' }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith({ status: 'accepted', workspace_id: 'studio' }),
  );
  const [, options] = fetch.mock.calls.find(([path]) => path.endsWith('/accept'));
  expect(JSON.parse(options.body)).toEqual({
    password: 'fixture-only passphrase',
    review_version: 'review-v1',
  });
});

it('allows decline without a password and never submits an acceptance', async () => {
  const events = userEvent.setup(),
    complete = vi.fn();
  fetch.mockImplementation((path) =>
    response(path.endsWith('/decline') ? { status: 'declined', workspace_id: 'studio' } : review),
  );
  await openInbox(events, complete);
  await events.click(screen.getByRole('button', { name: 'Decline request' }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith({ status: 'declined', workspace_id: 'studio' }),
  );
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/accept'))).toBe(false);
});

it('requires a refreshed review after the workspace changes', async () => {
  const events = userEvent.setup(),
    complete = vi.fn();
  let version = 'review-v1';
  fetch.mockImplementation((path) =>
    path.endsWith('/accept')
      ? response({ error: 'The workspace changed. Refresh the review.' }, 400)
      : response({ ...review, review_version: version }),
  );
  await openInbox(events, complete);
  await events.type(screen.getByLabelText('Confirm your password'), 'fixture-only passphrase');
  await events.click(screen.getByRole('button', { name: 'Accept ownership' }));
  await screen.findByRole('alert');
  expect(complete).not.toHaveBeenCalled();
  version = 'review-v2';
  await events.click(screen.getByRole('button', { name: 'Refresh review' }));
  const password = await screen.findByLabelText('Confirm your password');
  expect(password.value).toBe('');
});
