import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspacesPage from './pages/WorkspacesPage';
import { captureWorkspaceInvitation, readWorkspaceInvitation } from './lib/workspaceInvites';

const all = { read: true, write: true, delete: true, structure: true, export: true };
const team = { workspace_id: 'team', name: 'Operations', personal: false, role: 'owner' };
const personal = { workspace_id: 'personal', name: 'Personal', personal: true, role: 'owner' };
const people = [
  {
    account_id: 1,
    first_name: 'Ada',
    last_name: 'Owner',
    email: 'ada@example.test',
    role: 'owner',
  },
  {
    account_id: 2,
    first_name: 'Lin',
    last_name: 'Member',
    email: 'lin@example.test',
    role: 'member',
  },
  {
    account_id: 3,
    first_name: 'Max',
    last_name: 'Viewer',
    email: 'max@example.test',
    role: 'viewer',
  },
];
const invitation = {
  invitation_id: 'invitation-1',
  workspace_id: 'team',
  workspace_name: 'Operations',
  email: 'guest@example.test',
  role: 'viewer',
  expires_at: 1893456000,
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
function fixture(role = 'owner', invitations = [], configuration = {}) {
  let workspaces = [personal, { ...team, role }];
  let details = {
    workspace: { ...team, role },
    members: configuration.members || people,
    databases: configuration.databases || [
      { database_id: 7, database: 'customers.sqlite3', provider: 'sqlite', permissions: all },
    ],
    grants: configuration.grants || [
      {
        account_id: 2,
        database_id: 7,
        permissions: { read: true, write: false, delete: false, structure: false, export: false },
      },
    ],
    invitations: role === 'owner' ? [invitation] : [],
    email: { enabled: configuration.emailEnabled === true },
  };
  fetch.mockImplementation((path, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (path === '/api/workspaces') {
        const created = { ...team, workspace_id: 'created', name: body.name };
        workspaces = [...workspaces, created];
        details = {
          ...details,
          workspace: created,
          databases: [],
          members: [people[0]],
          invitations: [],
        };
        return response(created);
      }
      if (path.endsWith('/grants'))
        details = {
          ...details,
          grants: [
            body,
            ...details.grants.filter(
              (grant) =>
                grant.account_id !== body.account_id || grant.database_id !== body.database_id,
            ),
          ],
        };
      if (path.endsWith('/members'))
        details = {
          ...details,
          members: details.members.map((person) =>
            person.account_id === body.account_id ? { ...person, role: body.role } : person,
          ),
        };
      if (path.endsWith('/remove'))
        details = {
          ...details,
          members: details.members.filter((person) => person.account_id !== body.account_id),
        };
      if (path.endsWith('/invite'))
        return response({
          ...invitation,
          email: body.email,
          role: body.role,
          token: 'private-invitation-token',
          email_status: configuration.emailStatus || 'not_configured',
          invitation_url: configuration.invitationUrl,
          retry_after: 30,
        });
      if (path.endsWith('/accept')) return response({ ...team, role: 'viewer' });
      return response({ ok: true });
    }
    return response(
      path === '/api/workspaces'
        ? { workspaces, invitations }
        : path === '/api/workspaces/personal'
          ? { workspace: personal, databases: configuration.personalDatabases || [] }
          : details,
    );
  });
  return {
    session: { session_id: 'current', access: { workspace_id: 'team', role, permissions: all } },
    pending: false,
    busy: false,
    workingCommands: new Set(),
    open: vi.fn().mockResolvedValue({ session_id: 'new' }),
    openShared: vi.fn().mockResolvedValue({ session_id: 'shared' }),
  };
}
async function openPeople(events) {
  const navigation = await screen.findByRole('navigation', { name: 'Workspace sections' });
  await events.click(within(navigation).getByRole('button', { name: /^People & access/ }));
}
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lets an owner save explicit nested per-database grants', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={fixture()} />);
  await openPeople(events);
  const read = await screen.findByRole('checkbox', {
    name: 'Read permission for customers.sqlite3',
  });
  expect(read.checked).toBe(true);
  const edit = screen.getByRole('checkbox', { name: 'Edit rows permission for customers.sqlite3' });
  expect(edit.checked).toBe(false);
  await events.click(edit);
  await events.click(screen.getByRole('button', { name: 'Save access' }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([path]) => path.endsWith('/grants'))).toBe(true),
  );
  const [, options] = fetch.mock.calls.find(([path]) => path.endsWith('/grants'));
  expect(JSON.parse(options.body)).toEqual({
    account_id: 2,
    database_id: 7,
    permissions: { read: true, write: true, delete: false, structure: false, export: false },
  });
  expect(await screen.findByText('Database access updated.')).toBeTruthy();
});

it('changes member roles and removes people without offering changes to the owner', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={fixture()} />);
  await openPeople(events);
  await events.selectOptions(
    await screen.findByRole('combobox', { name: 'Role for lin@example.test' }),
    'viewer',
  );
  const save = screen
    .getAllByRole('button', { name: 'Save role' })
    .find((button) => !button.disabled);
  await events.click(save);
  expect(await screen.findByText('Member role updated.')).toBeTruthy();
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/members'))[1].body)).toEqual({
    account_id: 2,
    role: 'viewer',
  });
  await events.click(screen.getByRole('button', { name: /Ada Owner.*ada@example.test.*owner/ }));
  expect(screen.queryByRole('combobox', { name: 'Role for ada@example.test' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove from workspace' })).toBeNull();
  expect(screen.getByText('Full workspace access')).toBeTruthy();
  await events.click(screen.getByRole('button', { name: /Lin Member.*lin@example.test.*viewer/ }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Remove from workspace' }).disabled).toBe(false),
  );
  await events.click(screen.getByRole('button', { name: 'Remove from workspace' }));
  expect(await screen.findByText('Member removed from this workspace.')).toBeTruthy();
});

it('keeps owner controls out of a member workspace and opens only readable databases', async () => {
  const events = userEvent.setup(),
    workbench = fixture('member'),
    onOpened = vi.fn();
  render(<WorkspacesPage {...{ workbench, onOpened }} />);
  await screen.findByRole('heading', { name: 'Databases', exact: true });
  expect(screen.queryByRole('heading', { name: 'People' })).toBeNull();
  expect(screen.queryByText('Add a database')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create invitation' })).toBeNull();
  await events.click(screen.getByRole('button', { name: 'Open database' }));
  expect(workbench.openShared).toHaveBeenCalledExactlyOnceWith('team', 7);
  expect(onOpened).toHaveBeenCalledWith({ session_id: 'shared' });
});

it('shows viewers only the future-report state without database details or access controls', async () => {
  render(<WorkspacesPage workbench={fixture('viewer')} />);
  expect(
    await screen.findByText(
      'Reports shared with you will appear here. Report sharing is coming later.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('customers.sqlite3')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open database' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Database access' })).toBeNull();
  expect(screen.queryByText('Add a database')).toBeNull();
});

it('guards workspace changes while a database command awaits confirmation', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={{ ...fixture(), pending: true }} />);
  await screen.findByRole('heading', { name: 'Databases', exact: true });
  expect(screen.getByRole('button', { name: /Personal.*Only you/ }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'New workspace' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Open database' }).disabled).toBe(true);
  await openPeople(events);
  expect(screen.getByRole('button', { name: 'Invite a teammate' }).disabled).toBe(true);
  expect(screen.getByText(/before switching workspaces/)).toBeTruthy();
});

it('creates a private invitation link for the owner to send and lets them revoke it', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={fixture()} />);
  await openPeople(events);
  await events.click(screen.getByRole('button', { name: 'Invite a teammate' }));
  await events.type(
    await screen.findByRole('textbox', { name: 'Email', exact: true }),
    'new@example.test',
  );
  await events.click(screen.getByRole('button', { name: 'Create invitation link' }));
  const link = await screen.findByRole('textbox', {
    name: 'Private invitation link for new@example.test',
  });
  expect(new URL(link.value).searchParams.get('token')).toBe('private-invitation-token');
  expect(new URL(link.value).pathname).toBe('/workspaces');
  expect(
    screen.getByText('Email is not configured. Copy the private invitation link to share it.'),
  ).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Revoke invitation' }).disabled).toBe(false),
  );
  await events.click(screen.getByRole('button', { name: 'Revoke invitation' }));
  expect(
    JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/invitations/revoke'))[1].body),
  ).toEqual({ invitation_id: invitation.invitation_id });
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: 'Private invitation link for new@example.test' }),
    ).toBeNull(),
  );
  expect(screen.queryByRole('button', { name: 'Copy invitation link' })).toBeNull();
});

it('explains an unavailable private invitation and displays invitation expiry from server seconds', async () => {
  const events = userEvent.setup();
  captureWorkspaceInvitation('/workspaces?invite=other-invitation&token=private-code');
  render(<WorkspacesPage workbench={fixture()} />);
  expect(
    await screen.findByText(/This invitation is not available for your signed-in email/),
  ).toBeTruthy();
  await openPeople(events);
  expect(
    await screen.findByText(
      `viewer · Expires ${new Date(invitation.expires_at * 1000).toLocaleString()}`,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Join workspace' })).toBeNull();
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/accept'))).toBe(false);
});

it('requires the recipient to explicitly join with the private invitation token', async () => {
  const events = userEvent.setup();
  captureWorkspaceInvitation('/workspaces?invite=invitation-1&token=recipient-private-token');
  render(<WorkspacesPage workbench={fixture('member', [invitation])} />);
  const join = await screen.findByRole('button', { name: 'Join workspace' });
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/accept'))).toBe(false);
  expect(screen.getByLabelText('Invitation link or code').value).toBe('recipient-private-token');
  await events.click(join);
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/accept'))[1].body)).toEqual({
    invitation_id: 'invitation-1',
    token: 'recipient-private-token',
  });
  await waitFor(() => expect(readWorkspaceInvitation()).toBeNull());
});

it('keeps creation out of the workspace until requested and selects the new workspace', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={fixture()} />);
  await screen.findByRole('heading', { name: 'Databases', exact: true });
  expect(screen.queryByRole('textbox', { name: 'New workspace name' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  await events.click(screen.getByRole('button', { name: 'New workspace' }));
  const dialog = screen.getByRole('dialog', { name: 'Create a workspace' });
  const name = within(dialog).getByRole('textbox', { name: 'New workspace name' });
  expect(document.activeElement).toBe(name);
  await events.type(name, '  Care team  ');
  await events.click(within(dialog).getByRole('button', { name: 'Create workspace' }));
  expect(await screen.findByRole('heading', { name: 'Care team' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    JSON.parse(
      fetch.mock.calls.find(
        ([path, options]) => path === '/api/workspaces' && options.method === 'POST',
      )[1].body,
    ),
  ).toEqual({ name: 'Care team' });
  expect(screen.getByRole('button', { name: /^Care team/ }).getAttribute('aria-current')).toBe(
    'page',
  );
});

it('opens database setup on request and creates into the selected workspace', async () => {
  const events = userEvent.setup(),
    workbench = fixture(),
    onOpened = vi.fn();
  render(<WorkspacesPage {...{ workbench, onOpened }} />);
  await screen.findByRole('heading', { name: 'Databases', exact: true });
  expect(screen.queryByRole('textbox', { name: 'Database name' })).toBeNull();
  await events.click(screen.getByRole('button', { name: 'Add a database' }));
  const dialog = screen.getByRole('dialog', { name: 'Add to Operations' });
  await events.clear(within(dialog).getByRole('textbox', { name: 'Database name' }));
  await events.type(within(dialog).getByRole('textbox', { name: 'Database name' }), 'team.sqlite');
  await events.click(within(dialog).getByRole('button', { name: 'Create database' }));
  await waitFor(() =>
    expect(workbench.open).toHaveBeenCalledExactlyOnceWith({
      database_mode: 'create',
      database_name: 'team.sqlite',
      starter: false,
      workspace_id: 'team',
    }),
  );
  expect(onOpened).toHaveBeenCalledWith({ session_id: 'new' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('moves an existing personal database only after an explicit choice', async () => {
  const events = userEvent.setup();
  render(
    <WorkspacesPage
      workbench={fixture('owner', [], {
        personalDatabases: [{ database_id: 11, database: 'personal.sqlite' }],
      })}
    />,
  );
  await events.click(await screen.findByRole('button', { name: 'Add a database' }));
  const dialog = screen.getByRole('dialog');
  expect(fetch.mock.calls.some(([path]) => path.endsWith('/attach'))).toBe(false);
  await events.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Move one of your personal databases' }),
    '11',
  );
  await events.click(within(dialog).getByRole('button', { name: 'Move to workspace' }));
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/attach'))[1].body)).toEqual({
    database_id: 11,
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('returns to the current database without starting another session', async () => {
  const events = userEvent.setup(),
    workbench = fixture(),
    onOpened = vi.fn();
  workbench.session.database_id = 7;
  render(<WorkspacesPage {...{ workbench, onOpened }} />);
  await events.click(await screen.findByRole('button', { name: 'Continue working' }));
  expect(screen.getByText('Current')).toBeTruthy();
  expect(workbench.openShared).not.toHaveBeenCalled();
  expect(onOpened).toHaveBeenCalledExactlyOnceWith(workbench.session);
});

it('revokes all database capabilities when read access is removed', async () => {
  const events = userEvent.setup();
  render(<WorkspacesPage workbench={fixture()} />);
  await openPeople(events);
  for (const name of ['Edit rows', 'Delete rows', 'Change tables', 'Export']) {
    await events.click(
      screen.getByRole('checkbox', { name: name + ' permission for customers.sqlite3' }),
    );
  }
  await events.click(
    screen.getByRole('checkbox', { name: 'Read permission for customers.sqlite3' }),
  );
  for (const name of ['Edit rows', 'Delete rows', 'Change tables', 'Export']) {
    const checkbox = screen.getByRole('checkbox', {
      name: name + ' permission for customers.sqlite3',
    });
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
  }
  await events.click(screen.getByRole('button', { name: 'Save access' }));
  expect(
    JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/grants'))[1].body).permissions,
  ).toEqual({ read: false, write: false, delete: false, structure: false, export: false });
});

it('preserves another database draft while a grant saves and the selected person stays open', async () => {
  const events = userEvent.setup();
  const databases = [7, 8].map((database_id) => ({
    database_id,
    database: `database-${database_id}`,
    provider: 'sqlite',
    permissions: all,
  }));
  const grants = databases.map((database) => ({
    account_id: 2,
    database_id: database.database_id,
    permissions: { read: true, write: false, delete: false, structure: false, export: false },
  }));
  render(<WorkspacesPage workbench={fixture('owner', [], { databases, grants })} />);
  await openPeople(events);
  await events.click(screen.getByRole('checkbox', { name: 'Edit rows permission for database-7' }));
  await events.click(screen.getByRole('checkbox', { name: 'Export permission for database-8' }));
  await events.click(
    within(screen.getByRole('region', { name: 'Access to database-7' })).getByRole('button', {
      name: 'Save access',
    }),
  );
  await screen.findByText('Database access updated.');
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Access to database-7' })).getByRole('button', {
        name: 'Save access',
      }).disabled,
    ).toBe(true),
  );
  expect(screen.getByRole('region', { name: 'Access for lin@example.test' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Export permission for database-8' }).checked).toBe(
    true,
  );
  expect(
    within(screen.getByRole('region', { name: 'Access to database-8' })).getByRole('button', {
      name: 'Save access',
    }).disabled,
  ).toBe(false);
});

it('sends email invitations with the canonical URL and guards resend cooldown', async () => {
  const events = userEvent.setup();
  const canonical =
    'https://app.example.test/workspaces?invite=invitation-1&token=private-invitation-token';
  render(
    <WorkspacesPage
      workbench={fixture('owner', [], {
        emailEnabled: true,
        emailStatus: 'sent',
        invitationUrl: canonical,
      })}
    />,
  );
  await openPeople(events);
  await events.click(screen.getByRole('button', { name: 'Invite a teammate' }));
  await events.type(
    screen.getByRole('textbox', { name: 'Email', exact: true }),
    'guest@example.test',
  );
  await events.click(screen.getByRole('button', { name: 'Send invitation' }));
  const link = await screen.findByRole('textbox', {
    name: 'Private invitation link for guest@example.test',
  });
  expect(link.value).toBe(canonical);
  expect(
    screen.getByText('Invitation email sent. You can also share its private link.'),
  ).toBeTruthy();
  expect(screen.getByText(/delivery is not yet confirmed/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Resend in \d+s/ }).disabled).toBe(true);
  expect(fetch.mock.calls.filter(([path]) => path.endsWith('/invite'))).toHaveLength(1);
});

it('resends an invitation explicitly and keeps a private link when email fails', async () => {
  const events = userEvent.setup();
  render(
    <WorkspacesPage
      workbench={fixture('owner', [], { emailEnabled: true, emailStatus: 'failed' })}
    />,
  );
  await openPeople(events);
  await events.click(screen.getByRole('button', { name: 'Resend email' }));
  expect(JSON.parse(fetch.mock.calls.find(([path]) => path.endsWith('/invite'))[1].body)).toEqual({
    email: 'guest@example.test',
    role: 'viewer',
  });
  expect(
    await screen.findByRole('textbox', { name: 'Private invitation link for guest@example.test' }),
  ).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(
    'Email could not be sent. Copy the private invitation link',
  );
  expect(
    screen.queryByText('Invitation email sent. You can also share its private link.'),
  ).toBeNull();
});
