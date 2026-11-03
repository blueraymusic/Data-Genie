import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskPage from './pages/AskPage';
import { Router } from './lib/router';
import { useRequestWindow } from './hooks/useRequestWindow';

const makeRequest = (request_id) => ({
  request_id,
  text: `Request ${request_id}`,
  status: 'executed',
  submitted_at: '2026-11-02T10:00:00Z',
  commands: [],
});
const requests = (count) => Array.from({ length: count }, (_, index) => makeRequest(index + 1));
function pendingRequest(request_id) {
  return {
    ...makeRequest(request_id),
    status: 'pending',
    commands: [
      {
        command_id: request_id,
        sql_operation: 'DELETE',
        sql: `DELETE FROM "customers" WHERE "id" = ${request_id}`,
        status: 'pending',
        requires_confirmation: true,
        preview: { table: 'customers', affected_rows: 1 },
      },
    ],
  };
}
const workbench = (feed, extra = {}) => ({
  session: { session_id: 'first-session', tables: ['customers'], ai: { enabled: true } },
  feed,
  busy: false,
  pending: false,
  workingCommands: new Set(),
  submit: vi.fn(),
  decide: vi.fn(),
  newConversation: vi.fn().mockResolvedValue(true),
  ...extra,
});
const askProps = (feed, extra = {}) => ({
  selected: 'customers',
  draft: 'A draft I am keeping',
  setDraft: vi.fn(),
  workbench: workbench(feed, extra),
});
const renderAsk = (props) =>
  render(
    <Router>
      <AskPage {...props} />
    </Router>,
  );

beforeEach(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  history.replaceState({}, '', '/app');
});
afterEach(cleanup);

describe('bounded recent request window', () => {
  it('pages through 10,000 records without accumulating rendered requests', () => {
    const feed = requests(10000);
    const { result } = renderHook(() => useRequestWindow(feed, 'session'));
    expect(result.current.requests.map((request) => request.request_id)).toEqual([
      9993, 9994, 9995, 9996, 9997, 9998, 9999, 10000,
    ]);
    for (let page = 0; page < 100; page++) {
      act(() => result.current.showEarlier());
      expect(result.current.requests).toHaveLength(10);
    }
    expect(result.current.end).toBe(9002);
    expect(result.current.total).toBe(10000);
    expect(result.current.hiddenCount).toBe(9990);
    act(() => result.current.jumpToLatest());
    expect(result.current.requests[0].request_id).toBe(9993);
    expect(result.current.jumpVersion).toBe(1);
    expect(feed).toHaveLength(10000);
  });

  it('includes every pending request outside the active window without duplication', () => {
    const feed = requests(50);
    feed[0] = pendingRequest(1);
    feed[19] = pendingRequest(20);
    feed[49] = pendingRequest(50);
    const { result } = renderHook(() => useRequestWindow(feed, 'session'));
    expect(result.current.requests.map((request) => request.request_id)).toEqual([
      1, 20, 43, 44, 45, 46, 47, 48, 49, 50,
    ]);
    expect(result.current.pendingOutsideCount).toBe(2);
    act(() => result.current.showEarlier());
    expect(result.current.requests.map((request) => request.request_id)).toEqual([
      1, 20, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 50,
    ]);
    expect(result.current.pendingOutsideCount).toBe(3);
  });

  it('resets for a new latest ID even when the capped feed length stays unchanged', () => {
    const feed = requests(50);
    const { result, rerender } = renderHook(
      ({ items, sessionId }) => useRequestWindow(items, sessionId),
      { initialProps: { items: feed, sessionId: 'session' } },
    );
    act(() => result.current.showEarlier());
    expect(result.current.viewingEarlier).toBe(true);
    rerender({ items: [...feed.slice(1), makeRequest(51)], sessionId: 'session' });
    expect(result.current.viewingEarlier).toBe(false);
    expect(result.current.requests.map((request) => request.request_id)).toEqual([
      44, 45, 46, 47, 48, 49, 50, 51,
    ]);
    act(() => result.current.showEarlier());
    rerender({ items: feed, sessionId: 'second-session' });
    expect(result.current.viewingEarlier).toBe(false);
    expect(result.current.requests.at(-1).request_id).toBe(50);
  });

  it('keeps the active page across status updates and handles the oldest and empty windows', () => {
    const feed = requests(23);
    const { result, rerender } = renderHook(({ items }) => useRequestWindow(items, 'session'), {
      initialProps: { items: feed },
    });
    act(() => result.current.showEarlier());
    expect([result.current.start, result.current.end]).toEqual([5, 15]);
    rerender({ items: feed.map((request) => ({ ...request, status: 'declined' })) });
    expect([result.current.start, result.current.end]).toEqual([5, 15]);
    act(() => result.current.showEarlier());
    expect(result.current.requests.map((request) => request.request_id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.hasEarlier).toBe(false);
    act(() => result.current.showEarlier());
    expect(result.current.requests).toHaveLength(5);
    rerender({ items: [] });
    expect(result.current.requests).toEqual([]);
    expect(result.current.viewingEarlier).toBe(false);
    expect(result.current.hasEarlier).toBe(false);
  });
});

describe('Ask recent request navigation', () => {
  it('mounts only eight latest cards and browses earlier pages without scrolling or changing a draft', async () => {
    const events = userEvent.setup();
    const feed = requests(10000);
    const props = askProps(feed);
    const { container } = renderAsk(props);
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(8);
    expect(screen.getByText('Request 10000', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Request 1', { exact: true })).toBeNull();
    const composer = container.querySelector('.composer');
    expect(within(composer).getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: 'Recent request navigation' }).textContent,
    ).toContain('Recent requests 9993–10000 of 10000.');
    expect(screen.getByRole('link', { name: 'View all in History' }).getAttribute('href')).toBe(
      '/history',
    );
    Element.prototype.scrollIntoView.mockClear();
    await events.click(screen.getByRole('button', { name: 'Show earlier requests' }));
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(10);
    expect(screen.getByText('Request 9983', { exact: true })).toBeTruthy();
    expect(screen.getByText('Request 9992', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Request 10000', { exact: true })).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await events.click(screen.getByRole('button', { name: 'Show earlier requests' }));
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(10);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Ask in plain English' }).value).toBe(props.draft);
    expect(props.setDraft).not.toHaveBeenCalled();
    expect(props.workbench.feed).toHaveLength(10000);
    await events.click(within(composer).getByRole('button', { name: 'Jump to latest' }));
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(8);
    expect(screen.getByText('Request 10000', { exact: true })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'auto',
    });
    expect(props.setDraft).not.toHaveBeenCalled();
  });

  it('keeps earlier pages steady while requests update, then returns latest when a new request arrives', async () => {
    const events = userEvent.setup();
    const feed = requests(50);
    const props = askProps(feed);
    const view = renderAsk(props);
    await events.click(screen.getByRole('button', { name: 'Show earlier requests' }));
    Element.prototype.scrollIntoView.mockClear();
    view.rerender(
      <Router>
        <AskPage {...props} workbench={{ ...props.workbench, busy: true }} />
      </Router>,
    );
    expect(screen.getByText('Request 33', { exact: true })).toBeTruthy();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    view.rerender(
      <Router>
        <AskPage
          {...props}
          workbench={{ ...props.workbench, feed: [...feed.slice(1), makeRequest(51)] }}
        />
      </Router>,
    );
    expect(screen.getByText('Request 51', { exact: true })).toBeTruthy();
    expect(screen.queryByText('Request 33', { exact: true })).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(props.setDraft).not.toHaveBeenCalled();
  });

  it('keeps an older pending change reviewable on every page and supports decline while blocked', async () => {
    const events = userEvent.setup();
    const feed = requests(50);
    feed[0] = pendingRequest(1);
    const props = askProps(feed, { pending: true });
    const { container } = renderAsk(props);
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(9);
    expect(
      screen.getByRole('navigation', { name: 'Recent request navigation' }).textContent,
    ).toContain('1 pending request is also shown.');
    expect(screen.getByRole('button', { name: 'Delete 1 row' })).toBeTruthy();
    await events.click(screen.getByRole('button', { name: 'Show earlier requests' }));
    expect(container.querySelectorAll('#feed > .exchange')).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'Delete 1 row' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Ask in plain English' }).disabled).toBe(true);
    expect(
      within(container.querySelector('.composer')).getByRole('button', { name: 'Jump to latest' })
        .disabled,
    ).toBe(false);
    await events.click(screen.getByRole('button', { name: 'Don’t run' }));
    expect(props.workbench.decide).toHaveBeenCalledWith(feed[0].commands[0], true);
  });

  it('preserves New conversation and clears a draft only after an accepted reset', async () => {
    const events = userEvent.setup();
    const props = askProps(requests(25));
    const view = renderAsk(props);
    await events.click(screen.getByRole('button', { name: 'Show earlier requests' }));
    await events.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(props.workbench.newConversation).toHaveBeenCalledOnce();
    expect(props.setDraft).toHaveBeenCalledExactlyOnceWith('');
    view.rerender(
      <Router>
        <AskPage {...props} workbench={{ ...props.workbench, feed: [] }} draft="" />
      </Router>,
    );
    expect(screen.queryByRole('navigation', { name: 'Recent request navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull();
  });
});
