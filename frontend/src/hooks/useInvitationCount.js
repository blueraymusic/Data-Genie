import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLiveRefresh } from './useLiveRefresh';

export function useInvitationCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let controller;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      api('/api/workspaces', { signal: current.signal })
        .then((data) => {
          if (!current.signal.aborted)
            setCount((data.invitations?.length || 0) + (data.ownership_transfers?.length || 0));
        })
        .catch(() => {});
    };
    load();
    return () => {
      controller?.abort();
    };
  }, []);
  useLiveRefresh(async (signal) => {
    const data = await api('/api/workspaces', { signal });
    if (!signal.aborted)
      setCount((data.invitations?.length || 0) + (data.ownership_transfers?.length || 0));
  });
  return count;
}
