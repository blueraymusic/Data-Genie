import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceMembers } from './components/WorkspaceMembers';

afterEach(cleanup);
const person = (account_id, name, role = 'member') => ({
  account_id,
  first_name: name,
  last_name: '',
  email: `person${account_id}@example.test`,
  role,
});
const members = [
  person(1, 'Owner', 'owner'),
  person(2, 'A very long name '.repeat(8)),
  person(3, 'Another member'),
];
const details = {
  members,
  databases: [{ database_id: 1, database: 'sales.sqlite', provider: 'sqlite' }],
  grants: [],
};
const view = (value = details) => <WorkspaceMembers details={value} onAction={vi.fn()} />;

async function choose(user, id) {
  await user.click(screen.getByRole('combobox', { name: 'Select a person' }));
  await user.click(
    screen.getByRole('option', { name: new RegExp('person' + id + '@example.test') }),
  );
}

it('keeps independent unsaved choices while switching people and uses stable account IDs', async () => {
  const user = userEvent.setup();
  render(view());
  const picker = screen.getByRole('combobox', { name: 'Select a person' });
  expect(picker.textContent).toContain('person2@example.test');
  await user.click(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }));
  await choose(user, '3');
  expect(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }).checked).toBe(
    false,
  );
  await choose(user, '2');
  expect(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }).checked).toBe(
    true,
  );
  await choose(user, '1');
  expect(screen.queryByRole('button', { name: 'Save access' })).toBeNull();
});

it('handles removal, role changes, and rejoining without restoring an old local grant', async () => {
  const user = userEvent.setup();
  const result = render(view());
  await user.click(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }));
  result.rerender(view({ ...details, members: [members[0], members[2]] }));
  expect(screen.getByRole('combobox', { name: 'Select a person' }).textContent).toContain(
    'person3@example.test',
  );
  result.rerender(view());
  await choose(user, '2');
  expect(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }).checked).toBe(
    false,
  );
  result.rerender(
    view({
      ...details,
      members: members.map((member) =>
        member.account_id === 2 ? { ...member, role: 'viewer' } : member,
      ),
    }),
  );
  expect(screen.queryByRole('checkbox', { name: 'Read permission for sales.sqlite' })).toBeNull();
});

it('shows an empty state and disables the picker when there is only one person', () => {
  const result = render(view({ ...details, members: [] }));
  expect(screen.queryByRole('combobox', { name: 'Select a person' })).toBeNull();
  result.rerender(view({ ...details, members: [members[0]] }));
  expect(screen.getByRole('combobox', { name: 'Select a person' }).disabled).toBe(true);
  expect(screen.getByText('Full workspace access')).toBeTruthy();
});

it('shows avatars, searches without changing selection, and supports keyboard dismissal', async () => {
  const user = userEvent.setup();
  const photo = 'data:image/jpeg;base64,fixture';
  const { container } = render(
    view({ ...details, members: members.map((member) => ({ ...member, profile_photo: photo })) }),
  );
  const picker = screen.getByRole('combobox', { name: 'Select a person' });
  expect(container.querySelector('.person-picker-trigger img').getAttribute('src')).toBe(photo);
  await user.click(picker);
  const search = screen.getByRole('searchbox', { name: 'Find a person' });
  await user.type(search, 'missing');
  expect(screen.getByRole('status').textContent).toContain('No matching people');
  expect(picker.textContent).toContain('person2@example.test');
  await user.clear(search);
  await user.type(search, 'person3@');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(picker.textContent).toContain('person3@example.test');
  expect(picker.getAttribute('aria-expanded')).toBe('false');
  await user.click(picker);
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(picker);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('pages large teams and keeps selection drafts when the chooser replaces settings', async () => {
  const user = userEvent.setup();
  const people = Array.from({ length: 20 }, (_, i) => person(i + 1, `Teammate ${i + 1}`));
  const { rerender } = render(view({ ...details, members: people }));
  await user.click(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }));
  await user.click(screen.getByRole('combobox', { name: 'Select a person' }));
  expect(screen.getAllByRole('option')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'Save access' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next people' }));
  expect(screen.getByRole('option', { name: /person5@example.test/ })).toBeTruthy();
  rerender(view({ ...details, members: people.slice(0, 4) }));
  expect(screen.getAllByRole('option')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'Next people' })).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('checkbox', { name: 'Read permission for sales.sqlite' }).checked).toBe(
    true,
  );
});
