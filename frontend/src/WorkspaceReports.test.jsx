import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceReports } from './components/WorkspaceReports';
const workspace = { workspace_id: 'team', role: 'member' };
const response = (data) => Promise.resolve({ ok: true, json: async () => data });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('[autofocus]')?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ reports: [] })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  expect(screen.getByRole('dialog', { name: 'Approved findings' })).toBeTruthy();
  expect(
    within(screen.getByRole('dialog')).getByText('<script>safe plain text</script>'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /New report|Edit report/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete report', exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: 'Download PDF', exact: true })).toBeTruthy();
});

it('opens a full-screen dialog and protects unsaved writing on close and Escape', async () => {
  const user = userEvent.setup();
  const previousOverflow = document.body.style.overflow;
  render(<WorkspaceReports workspace={workspace} />);
  await user.click(screen.getByRole('button', { name: 'New report' }));
  const dialog = screen.getByRole('dialog', { name: 'New report' });
  expect(dialog.classList.contains('report-overlay')).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(screen.getByLabelText('Report title'));
  const input = screen.getByLabelText('Report', { exact: true });
  await user.type(input, 'Keep this evidence.');
  await user.click(screen.getByRole('button', { name: 'Close report' }));
  expect(screen.getByRole('alert', { name: 'Unsaved report changes' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(input.value).toBe('Keep this evidence.');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close report' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe(previousOverflow);
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('keeps the editor open during a save and preserves text when the save fails', async () => {
  const user = userEvent.setup();
  let finish;
  fetch.mockImplementation((path, options) =>
    options?.method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : response({ reports: [] }),
  );
  render(<WorkspaceReports workspace={workspace} />);
  await user.click(screen.getByRole('button', { name: 'New report' }));
  await user.type(screen.getByLabelText('Report title'), 'Weekly review');
  await user.type(screen.getByLabelText('Report', { exact: true }), 'Verified notes.');
  await user.click(screen.getByRole('button', { name: 'Save report' }));
  expect(screen.getByRole('button', { name: 'Close report' }).disabled).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  finish({ ok: false, status: 503, json: async () => ({ error: 'Save unavailable. Try again.' }) });
  await screen.findByText('Save unavailable. Try again.');
  expect(screen.getByLabelText('Report', { exact: true }).value).toBe('Verified notes.');
  expect(screen.getByRole('button', { name: 'Close report' }).disabled).toBe(false);
});

it('previews the current writing without saving or losing the draft', async () => {
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={workspace} />);
  await user.click(screen.getByRole('button', { name: 'New report' }));
  await user.type(screen.getByLabelText('Report title'), 'A clear finding');
  await user.type(
    screen.getByLabelText('Report', { exact: true }),
    'Evidence stays with the story.',
  );
  await user.click(screen.getByRole('button', { name: 'Preview', exact: true }));
  expect(screen.getByRole('article', { name: 'Report preview' }).textContent).toContain(
    'Evidence stays with the story.',
  );
  expect(screen.getByText('5 words')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Preview', exact: true }).getAttribute('aria-pressed'),
  ).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Write', exact: true }));
  expect(screen.getByLabelText('Report', { exact: true }).value).toBe(
    'Evidence stays with the story.',
  );
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('requires explicit confirmation before an author deletes a saved report', async () => {
  const report = {
    report_id: 'own-report',
    title: 'My findings',
    body: 'Evidence.',
    version: 3,
    updated_at: 1,
    can_delete: true,
    can_edit: true,
  };
  fetch.mockImplementation((path, options) =>
    response(options?.method === 'POST' ? { deleted: true } : { reports: [report] }),
  );
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={workspace} />);
  await user.click(await screen.findByRole('button', { name: 'Open report: My findings' }));
  await user.click(screen.getByRole('button', { name: 'Delete report', exact: true }));
  expect(screen.getByRole('alert', { name: 'Delete this report?' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep report' }));
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fetch.mockImplementation((path, options) =>
    response(options?.method === 'POST' ? { deleted: true } : { reports: [] }),
  );
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByText('Report deleted.');
  expect(screen.queryByRole('dialog')).toBeNull();
  const post = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(post[0]).toBe('/api/workspaces/team/reports/own-report/delete');
  expect(JSON.parse(post[1].body)).toEqual({ version: 3 });
});

it('downloads a shared report PDF for a viewer without granting editing or deletion', async () => {
  const report = {
    report_id: 'shared',
    title: 'Team findings',
    body: 'Approved evidence.',
    published: true,
    updated_at: 1,
    can_delete: false,
    can_edit: false,
  };
  const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const createURL = vi.fn(() => 'blob:report-test'),
    revokeURL = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createURL;
      static revokeObjectURL = revokeURL;
    },
  );
  const files = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    files.push(this.download);
  });
  fetch.mockImplementation((path) =>
    path.endsWith('/pdf')
      ? Promise.resolve({ ok: true, blob: async () => pdf })
      : response({ reports: [report] }),
  );
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={{ ...workspace, role: 'viewer' }} />);
  await user.click(await screen.findByRole('button', { name: 'Open report: Team findings' }));
  await user.click(screen.getByRole('button', { name: 'Download PDF', exact: true }));
  await screen.findByText('PDF download started.');
  expect(createURL).toHaveBeenCalledWith(pdf);
  expect(files).toEqual(['Team-findings.pdf']);
  expect(screen.queryByRole('button', { name: /Edit report|Delete report/ })).toBeNull();
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('shows a PDF access failure without downloading an error response', async () => {
  const report = {
    report_id: 'shared',
    title: 'Team findings',
    body: 'Approved evidence.',
    published: true,
    updated_at: 1,
  };
  fetch.mockImplementation((path) =>
    path.endsWith('/pdf')
      ? Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ error: 'This report is no longer available.' }),
        })
      : response({ reports: [report] }),
  );
  const user = userEvent.setup();
  render(<WorkspaceReports workspace={{ ...workspace, role: 'viewer' }} />);
  await user.click(await screen.findByRole('button', { name: 'Open report: Team findings' }));
  await user.click(screen.getByRole('button', { name: 'Download PDF', exact: true }));
  await screen.findByText('This report is no longer available.');
  expect(screen.getByRole('button', { name: 'Download PDF', exact: true }).disabled).toBe(false);
});
