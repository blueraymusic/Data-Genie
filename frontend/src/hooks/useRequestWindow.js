import { useCallback, useEffect, useMemo, useState } from 'react';

const LATEST_COUNT = 8;
const EARLIER_COUNT = 10;
const hasPendingChange = (request) =>
  (request.commands || []).some(
    (command) => command.requires_confirmation && command.status === 'pending',
  );

// Keep expensive result cards bounded; pending changes are always available for review.
export function useRequestWindow(requests, sessionId) {
  const latestRequestId = requests.at(-1)?.request_id ?? null;
  const [pageState, setPageState] = useState({ sessionId, latestRequestId, page: 0 });
  const [jumpVersion, setJumpVersion] = useState(0);
  const current =
    pageState.sessionId === sessionId && pageState.latestRequestId === latestRequestId;
  const page = current ? pageState.page : 0;
  useEffect(() => {
    setPageState({ sessionId, latestRequestId, page: 0 });
  }, [sessionId, latestRequestId]);

  const total = requests.length;
  const end = page === 0 ? total : Math.max(0, total - LATEST_COUNT - (page - 1) * EARLIER_COUNT);
  const start = Math.max(0, end - (page === 0 ? LATEST_COUNT : EARLIER_COUNT));
  const visibleRequests = useMemo(
    () =>
      requests.filter(
        (request, index) => (index >= start && index < end) || hasPendingChange(request),
      ),
    [requests, start, end],
  );
  const pendingOutsideCount = visibleRequests.length - (end - start);
  const showEarlier = useCallback(() => {
    if (start === 0) return;
    setPageState({ sessionId, latestRequestId, page: page + 1 });
  }, [sessionId, latestRequestId, page, start]);
  const jumpToLatest = useCallback(() => {
    setPageState({ sessionId, latestRequestId, page: 0 });
    setJumpVersion((version) => version + 1);
  }, [sessionId, latestRequestId]);

  return {
    requests: visibleRequests,
    start,
    end,
    total,
    hiddenCount: total - visibleRequests.length,
    pendingOutsideCount,
    hasEarlier: start > 0,
    viewingEarlier: end < total,
    showEarlier,
    jumpToLatest,
    latestRequestId,
    jumpVersion,
  };
}
