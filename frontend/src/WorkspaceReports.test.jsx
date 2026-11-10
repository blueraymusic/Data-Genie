import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceReports } from './components/WorkspaceReports';
const workspace = { workspace_id: 'team', role: 'member' };
const response = (data) => Promise.resolve({ ok: true, json: async () => data });
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ reports: [] })),
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('lets a member start from a template and save a private draft', async () => {
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={workspace} />);
  await screen.findByText('No reports yet. Start with a blank page or a template.');
  await user.click(screen.getByRole('button', { name: 'New report' }));
  await user.type(screen.getByLabelText('Report title'), 'Weekly review');
  await user.click(screen.getByRole('button', { name: 'Use a template' }));
  expect(screen.getByLabelText('Report', { exact: true }).value).toContain('Key findings');
  expect(screen.queryByRole('checkbox')).toBeNull();
  fetch.mockImplementation((path, options) =>
    response(options?.method === 'POST' ? { report_id: 'r1' } : { reports: [] }),
  );
  await user.click(screen.getByRole('button', { name: 'Save report' }));
  await screen.findByText('Draft saved. Only you and the owner can see it.');
  expect(
    JSON.parse(fetch.mock.calls.find(([, options]) => options?.method === 'POST')[1].body),
  ).toMatchObject({ title: 'Weekly review', published: false });
});
it('generates only after the user supplies notes, and waits for saving', async () => {
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={workspace} />);
  await user.click(screen.getByRole('button', { name: 'New report' }));
  await user.click(screen.getByRole('button', { name: 'Draft with Data Genie AI' }));
  expect(screen.getByRole('button', { name: 'Generate draft' }).disabled).toBe(true);
  await user.type(screen.getByLabelText('What should the report cover?'), 'Orders');
  await user.type(screen.getByLabelText('Source notes or query results'), 'Eight orders.');
  fetch.mockResolvedValue(response({ body: 'There were eight orders.' }));
  await user.click(screen.getByRole('button', { name: 'Generate draft' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Report', { exact: true }).value).toBe('There were eight orders.'),
  );
  const posts = fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe('/api/workspaces/team/reports/generate');
});
it('gives viewers a reading surface without creating or editing controls', async () => {
  fetch.mockResolvedValue(
    response({
      reports: [
        {
          report_id: 'r1',
          title: 'Approved findings',
          body: '<script>safe plain text</script>',
          published: true,
          can_edit: false,
          updated_at: 1,
          first_name: 'Ada',
        },
      ],
    }),
  );
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={{ ...workspace, role: 'viewer' }} />);
  await user.click(await screen.findByRole('button', { name: /Approved findings/ }));
  expect(screen.getByText('<script>safe plain text</script>')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /New report|Edit report/ })).toBeNull();
});
