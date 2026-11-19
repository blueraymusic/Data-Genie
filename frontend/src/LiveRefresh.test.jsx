import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useLiveRefresh } from './hooks/useLiveRefresh';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function Surface({ refresh, page = 'one' }) {
  useLiveRefresh(refresh, { key: page });
  return null;
}
it('skips overlapping live refreshes and aborts a pending request when the page changes', async () => {
  vi.useFakeTimers();
  let resolve;
  const refresh = vi.fn(() => new Promise((done) => { resolve = done; }));
  const view = render(<Surface refresh={refresh} />);
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  const signal = refresh.mock.calls[0][0];
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  view.rerender(<Surface refresh={refresh} page="two" />);
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(); await vi.advanceTimersByTimeAsync(5000); });
  expect(refresh).toHaveBeenCalledTimes(2);
  const nextSignal = refresh.mock.calls[1][0];
  view.unmount();
  expect(nextSignal.aborted).toBe(true);
});
