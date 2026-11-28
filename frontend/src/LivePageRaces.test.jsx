import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryPage from './pages/HistoryPage';
import StructurePage from './pages/StructurePage';
import { Router } from './lib/router';

const session = { session_id: 'race-session', tables: ['sales'] };
const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const workbench = (overrides = {}) => ({
  session,
  feed: [],
  busy: false,
  pending: false,
  workingCommands: new Set(),
  decide: vi.fn(),
  submit: vi.fn(),
  ...overrides,
});
const saved = (status) => ({
  request_id: 1,
  text: 'Update sales',
  status,
  submitted_at: '2026-01-01T00:00:00Z',
  commands: [
    {
      command_id: 1,
      status,
      sql: 'UPDATE sales SET amount=15',
      requires_confirmation: status === 'pending',
    },
  ],
});
const history = (status) => ({ requests: [saved(status)], total: 1, has_more: false });
const table = (column) => ({
  name: 'sales',
  row_count: 1,
  columns: [{ name: column, type: 'INTEGER' }],
});

beforeEach(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('aborts old history snapshots when a confirmation starts and retains the confirmed result', async () => {
  let reads = 0,
    finishOld,
    oldSignal;
  fetch.mockImplementation((url, options) => {
    if (url === '/api/sessions') return response({ sessions: [session] });
    if (++reads === 2)
      return new Promise((resolve) => {
        oldSignal = options.signal;
        finishOld = () => resolve(response(history('pending')));
      });
    return response(history(reads > 2 ? 'executed' : 'pending'));
  });
  const view = render(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  await screen.findByText(/UPDATE · pending/);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  view.rerender(
    <HistoryPage workbench={workbench({ workingCommands: new Set([1]) })} onReuse={vi.fn()} />,
  );
  expect(oldSignal.aborted).toBe(true);
  view.rerender(<HistoryPage workbench={workbench()} onReuse={vi.fn()} />);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await screen.findByText(/UPDATE · executed/);
  await act(async () => {
    finishOld();
  });
  expect(screen.queryByText(/UPDATE · pending/)).toBeNull();
  expect(screen.getByText(/UPDATE · executed/)).toBeTruthy();
});

it('aborts an old schema snapshot when a newer explicit structure refresh starts', async () => {
  let reads = 0,
    finishOld,
    oldSignal;
  fetch.mockImplementation((url, options) => {
    if (++reads === 2)
      return new Promise((resolve) => {
        oldSignal = options.signal;
        finishOld = () => resolve(response({ tables: [table('old_column')] }));
      });
    return response({ tables: [table(reads > 2 ? 'new_column' : 'old_column')] });
  });
  render(
    <Router>
      <StructurePage workbench={workbench()} />
    </Router>,
  );
  await screen.findByText('old_column');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh structure' }));
  expect(oldSignal.aborted).toBe(true);
  await screen.findByText('new_column');
  await act(async () => {
    finishOld();
  });
  expect(screen.queryByText('old_column')).toBeNull();
  expect(screen.getByText('new_column')).toBeTruthy();
});
