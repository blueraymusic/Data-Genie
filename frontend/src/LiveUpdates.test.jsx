import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useLiveRefresh } from './hooks/useLiveRefresh';
import { normalizeRequest, useWorkbench } from './hooks/useWorkbench';
import { ResultOutput, Translation } from './components/CommandResult';

const response = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const session = { session_id: 'live', tables: ['sales'], conversation_after: 0 };
const savedRequest = (status) => ({
  request_id: 1,
  text: 'SELECT amount FROM sales',
  status,
  submitted_at: '2026-01-01T00:00:00Z',
  commands: [
    {
      command_id: 1,
      status,
      sql: 'SELECT amount FROM sales',
      ...(status === 'executed' ? { result: { payload: { rows: [{ amount: 15 }] } } } : {}),
    },
  ],
});

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('polls visible screens and waits for a slow request before starting another', async () => {
  vi.useFakeTimers();
  let finish;
  const update = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { unmount } = renderHook(() => useLiveRefresh(update));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(update).toHaveBeenCalledTimes(1);
  const signal = update.mock.calls[0][0];
  expect(signal.aborted).toBe(false);
  await act(async () => {
    finish();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(update).toHaveBeenCalledTimes(2);
  unmount();
  expect(update.mock.calls[1][0].aborted).toBe(true);
});

it('refreshes a saved command outcome on focus without replaying any SQL', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  let completed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      response(
        url === '/api/status'
          ? session
          : {
              requests: [savedRequest(completed ? 'executed' : 'running')],
            },
      ),
    ),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.feed[0].commands[0].status).toBe('running');
  completed = true;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(result.current.feed[0].commands[0].status).toBe('executed'));
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

it('reuses loaded history while its metadata revision is unchanged and reloads completed results', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  let revision = 'pending-state',
    completed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      response(
        url === '/api/status'
          ? { ...session, history_revision: revision }
          : { requests: [savedRequest(completed ? 'executed' : 'running')] },
      ),
    ),
  );
  const histories = () => fetch.mock.calls.filter(([url]) => url.startsWith('/api/history')).length;
  const statuses = () => fetch.mock.calls.filter(([url]) => url === '/api/status').length;
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(histories()).toBe(1);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(statuses()).toBe(2));
  expect(histories()).toBe(1);
  revision = 'executed-state';
  completed = true;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(result.current.feed[0].commands[0].status).toBe('executed'));
  expect(histories()).toBe(2);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(statuses()).toBe(4));
  expect(histories()).toBe(2);
});

it('does not mark a changed revision seen if local activity superseded its history response', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  let revision = 'initial',
    reads = 0,
    finishOld;
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options) => {
      if (url === '/api/status') return response({ ...session, history_revision: revision });
      if (options.method === 'POST')
        return response({
          request_id: 2,
          status: 'executed',
          sql: 'SELECT 1',
          rows: [{ amount: 20 }],
        });
      if (++reads === 2)
        return new Promise((resolve) => {
          finishOld = () => resolve(response({ requests: [savedRequest('running')] }));
        });
      return response({ requests: [savedRequest(reads > 2 ? 'executed' : 'running')] });
    }),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  revision = 'changed';
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  await act(async () => {
    await result.current.submit('SELECT 1', true);
    finishOld();
  });
  expect(result.current.feed[0].commands[0].status).toBe('running');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(result.current.feed[0].commands[0].status).toBe('executed'));
  expect(reads).toBe(3);
});

it('does not let an older background history response replace a newer submission', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  let reads = 0,
    finishBackground;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (url === '/api/status') return response(session);
      if (url.startsWith('/api/history')) {
        if (++reads === 2)
          return new Promise((resolve) => {
            finishBackground = () => resolve(response({ requests: [savedRequest('running')] }));
          });
        return response({ requests: [savedRequest('executed')] });
      }
      return response({
        ...savedRequest('executed').commands[0],
        request_id: 2,
        rows: [{ amount: 20 }],
      });
    }),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(finishBackground).toBeTypeOf('function'));
  await act(async () => {
    await result.current.submit('SELECT amount FROM sales', true);
  });
  await act(async () => {
    finishBackground();
  });
  expect(result.current.feed[0].commands[0].status).toBe('executed');
  expect(result.current.feed.at(-1).request_id).toBe(2);
});

it('renders a structured chart using actual named result columns', () => {
  render(
    <ResultOutput
      command={{
        visualization: 'line',
        chart: {
          type: 'line',
          x: 'month',
          y: 'total_sales',
          title: 'Monthly sales',
        },
        rows: [
          { month: 'Jan', total_sales: '10000.25' },
          { month: 'Feb', total_sales: '14000.75' },
        ],
      }}
    />,
  );
  expect(screen.getByRole('img', { name: 'Monthly sales' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: '10000.25' })).toBeTruthy();
});

it('shows an executed result when the stored request summary is stale', () => {
  render(
    <Translation
      request={{ ...savedRequest('executed'), status: 'rejected', error: 'Not run' }}
      workbench={{ workingCommands: new Set() }}
    />,
  );
  expect(screen.getByText('executed')).toBeTruthy();
  expect(screen.queryByText('Not run')).toBeNull();
  expect(screen.getByRole('cell', { name: '15' })).toBeTruthy();
});

it('marks a partially failed batch as rejected immediately while preserving its successful result', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      response(
        url === '/api/status'
          ? session
          : url.startsWith('/api/history')
            ? { requests: [] }
            : {
                request_id: 2,
                matched: true,
                commands: [
                  {
                    command_id: 21,
                    status: 'executed',
                    sql: 'SELECT amount FROM sales',
                    rows: [{ amount: 15 }],
                  },
                  {
                    command_id: 22,
                    status: 'failed',
                    sql: 'SELECT unavailable FROM sales',
                    matched: false,
                    error: 'Column unavailable.',
                  },
                ],
              },
      ),
    ),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.submit('show two results');
  });
  expect(result.current.feed[0].status).toBe('rejected');
  expect(result.current.feed[0].commands[0].rows).toEqual([{ amount: 15 }]);
  expect(result.current.feed[0].commands[1].error).toBe('Column unavailable.');
  expect(normalizeRequest({ ...result.current.feed[0], status: 'executed' }).status).toBe(
    'rejected',
  );
});

it('keeps a lost POST response uncertain when polling later finds a successful saved result', async () => {
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'live' }));
  let saved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options) => {
      if (options.method === 'POST') {
        saved = true;
        return Promise.reject(new TypeError('Connection lost after execution'));
      }
      return response(
        url === '/api/status' ? session : { requests: saved ? [savedRequest('executed')] : [] },
      );
    }),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.submit('SELECT amount FROM sales', true);
  });
  expect(result.current.feed[0].status).toBe('unverified');
  expect(result.current.feed[0].outcome_unknown).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() =>
    expect(result.current.feed.some((item) => item.status === 'executed')).toBe(true),
  );
  render(
    <>
      {result.current.feed.map((request) => (
        <Translation key={request.request_id} request={request} workbench={result.current} />
      ))}
    </>,
  );
  expect(screen.getByText('Check the saved outcome.')).toBeTruthy();
  expect(screen.getByRole('cell', { name: '15' })).toBeTruthy();
  expect(screen.queryByText('This request wasn’t run.')).toBeNull();
  expect(screen.queryByText('No SQL run. No changes made.')).toBeNull();
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});
