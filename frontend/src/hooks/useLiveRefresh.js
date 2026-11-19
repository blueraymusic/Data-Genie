import { useEffect, useRef } from 'react';

// Keep visible screens current without disturbing the form or reader using them.
export function useLiveRefresh(
  refresh,
  { enabled = true, interval = 5000, event = 'dg-workspaces-changed', events, key } = {},
) {
  const current = useRef(refresh);
  current.current = refresh;
  const eventNames = (events || [event]).join('\n');
  useEffect(() => {
    if (!enabled) return;
    let controller,
      inFlight = false;
    const update = (event) => {
      if (document.visibilityState === 'hidden') return;
      // Timer ticks coalesce, so a slow request can finish. Explicit changes or
      // returning to the tab supersede an older snapshot immediately.
      if (inFlight && !event) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      inFlight = true;
      Promise.resolve()
        .then(() => {
          if (!signal.aborted) return current.current(signal);
        })
        .catch(() => {})
        .finally(() => {
          if (!signal.aborted) inFlight = false;
        });
    };
    const timer = window.setInterval(update, interval);
    window.addEventListener('focus', update);
    const names = eventNames.split('\n').filter(Boolean);
    names.forEach((name) => window.addEventListener(name, update));
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
      window.removeEventListener('focus', update);
      names.forEach((name) => window.removeEventListener(name, update));
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled, interval, eventNames, key]);
}
