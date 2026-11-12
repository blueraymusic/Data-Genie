import { useEffect, useState } from 'react';
import { api } from '../lib/api';

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
    window.addEventListener('focus', load);
    window.addEventListener('dg-workspaces-changed', load);
    return () => {
      controller?.abort();
      window.removeEventListener('focus', load);
      window.removeEventListener('dg-workspaces-changed', load);
    };
  }, []);
  return count;
}
