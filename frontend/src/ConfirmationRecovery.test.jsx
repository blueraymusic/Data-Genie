import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkbench } from './hooks/useWorkbench';

const session = { session_id: 'schema-session', tables: ['customers'], conversation_after: 0 };
const command = {
  command_id: 14,
  status: 'pending',
  sql_operation: 'ALTER',
  sql: 'ALTER TABLE customers DROP COLUMN id',
  confirmation_token: 'test-token',
  requires_confirmation: true,
};
const request = {
  request_id: 6,
  text: command.sql,
  submitted_at: new Date().toISOString(),
  status: 'pending',
  commands: [command],
};
const response = (body, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
  });

function Harness() {
  const workbench = useWorkbench({ account_id: 2 });
  if (workbench.loading) return <p>Loading</p>;
  return (
    <>
      <p role="status">{workbench.pending ? 'Change pending' : 'Ready'}</p>
      <p>{workbench.message}</p>
      {workbench.feed.map((item) => (
        <p key={item.request_id}>{item.commands[0]?.status}</p>
      ))}
      <button
        disabled={!workbench.pending || workbench.workingCommands.size > 0}
        onClick={() => workbench.decide(workbench.feed[0].commands[0])}
      >
        Confirm change
      </button>
      <button
        disabled={workbench.pending || workbench.workingCommands.size > 0}
        onClick={() => workbench.submit('SELECT * FROM customers', true)}
      >
        Read rows
      </button>
    </>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: session.session_id }));
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('reconciles a failed schema confirmation from History and unlocks further queries', async () => {
  let confirmed = false;
  fetch.mockImplementation((path) => {
    if (path === '/api/status') return response(session);
    if (path.startsWith('/api/history'))
      return response({
        requests: [
          {
            ...request,
            status: confirmed ? 'rejected' : 'pending',
            commands: [{ ...command, status: confirmed ? 'failed' : 'pending' }],
          },
        ],
      });
    if (path === '/api/commands/confirm') {
      confirmed = true;
      return response({ error: 'A foreign key depends on this column.' }, 400);
    }
    return response({
      request_id: 7,
      sql: 'SELECT * FROM customers',
      status: 'executed',
      rows: [],
    });
  });
  const events = userEvent.setup();
  render(<Harness />);
  await screen.findByText('Change pending');
  await events.click(screen.getByRole('button', { name: 'Confirm change' }));
  await screen.findByText('failed');
  expect(screen.getByRole('status').textContent).toBe('Ready');
  expect(screen.getByText('A foreign key depends on this column.')).toBeTruthy();
  await events.click(screen.getByRole('button', { name: 'Read rows' }));
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/query')).toBe(true));
  expect(fetch.mock.calls.filter(([path]) => path === '/api/commands/confirm')).toHaveLength(1);
});

it.each([true, false])(
  'keeps pending when confirmation is uncertain (history unavailable: %s)',
  async (unavailable) => {
    let attempted = false;
    fetch.mockImplementation((path) => {
      if (path === '/api/status') return response(session);
      if (path.startsWith('/api/history')) {
        if (attempted && unavailable) return Promise.reject(new TypeError('Connection lost'));
        return response({ requests: [request] });
      }
      if (path === '/api/commands/confirm') {
        attempted = true;
        return Promise.reject(new TypeError('Connection lost'));
      }
      throw new Error('Unexpected request');
    });
    const events = userEvent.setup();
    render(<Harness />);
    await screen.findByText('Change pending');
    await events.click(screen.getByRole('button', { name: 'Confirm change' }));
    await screen.findByText(/Could not reach Data Genie/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm change' }).disabled).toBe(false),
    );
    expect(screen.getByRole('status').textContent).toBe('Change pending');
    expect(screen.getByRole('button', { name: 'Read rows' }).disabled).toBe(true);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  },
);
