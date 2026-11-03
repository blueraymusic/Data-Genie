import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useWorkbench } from './hooks/useWorkbench';

const session = { session_id: 'long-conversation', conversation_after: 0, tables: ['customers'] };
const request = (id, pending = false) => ({
  request_id: id,
  text: 'SELECT * FROM customers',
  status: pending ? 'pending' : 'executed',
  commands: [
    {
      command_id: id,
      status: pending ? 'pending' : 'executed',
      requires_confirmation: pending,
      sql: 'SELECT * FROM customers',
    },
  ],
});
const response = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: session.session_id }));
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('restores only recent requests while retaining and deduplicating older pending work', async () => {
  const recent = Array.from({ length: 50 }, (_, index) => request(10000 - index));
  fetch.mockImplementation((url) =>
    response(
      url === '/api/status'
        ? session
        : {
            requests: recent,
            total: 10000,
            pending_requests: [request(1, true), recent[0]],
          },
    ),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(fetch.mock.calls.some(([url]) => url === '/api/history?limit=50&include_pending=1')).toBe(
    true,
  );
  expect(result.current.feed).toHaveLength(51);
  expect(result.current.feed[0].request_id).toBe(1);
  expect(result.current.feed.at(-1).request_id).toBe(10000);
  expect(result.current.pending).toBe(true);
});

it('keeps a long active session bounded as new requests are saved', async () => {
  let latest = 10000;
  fetch.mockImplementation((url) =>
    response(
      url === '/api/status'
        ? session
        : url.startsWith('/api/history')
          ? {
              requests: Array.from({ length: 50 }, (_, index) => request(10000 - index)),
              total: 10000,
            }
          : { request_id: ++latest, ...request(latest).commands[0], status: 'executed', rows: [] },
    ),
  );
  const { result } = renderHook(() => useWorkbench({ account_id: 1 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  for (let index = 0; index < 3; index++) {
    await act(async () => result.current.submit('SELECT * FROM customers', true));
  }
  expect(result.current.feed).toHaveLength(50);
  expect(result.current.feed[0].request_id).toBe(9954);
  expect(result.current.feed.at(-1).request_id).toBe(10003);
  expect(fetch.mock.calls.filter(([url]) => url === '/api/query')).toHaveLength(3);
});
