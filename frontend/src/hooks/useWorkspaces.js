import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export function useWorkspaces(initialId) {
  const [workspaces, setWorkspaces] = useState([]),
    [invitations, setInvitations] = useState([]),
    [ownershipTransfers, setOwnershipTransfers] = useState([]),
    [selected, setSelected] = useState(initialId || ''),
    [details, setDetails] = useState(null),
    [loading, setLoading] = useState(true),
    [listResolved, setListResolved] = useState(false),
    [detailsLoading, setDetailsLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  const lock = useRef(false),
    detailsWorkspace = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api('/api/workspaces', { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setListResolved(true);
        const available = data.workspaces || [];
        setWorkspaces(available);
        setInvitations(data.invitations || []);
        setOwnershipTransfers(data.ownership_transfers || []);
        setSelected((current) =>
          available.some((item) => item.workspace_id === current)
            ? current
            : available.find((item) => item.personal)?.workspace_id ||
              available[0]?.workspace_id ||
              '',
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) {
      setDetails(null);
      detailsWorkspace.current = null;
      setDetailsLoading(false);
      return;
    }
    const controller = new AbortController();
    if (detailsWorkspace.current !== selected) {
      setDetails(null);
      setDetailsLoading(true);
    }
    api('/api/workspaces/' + encodeURIComponent(selected), { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          detailsWorkspace.current = selected;
          setDetails(data);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if (failure.status === 403) {
            detailsWorkspace.current = null;
            setDetails(null);
          }
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailsLoading(false);
      });
    return () => controller.abort();
  }, [selected, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const act = useCallback(async (path, body, success) => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await api(path, { method: 'POST', body });
      window.dispatchEvent(new Event('dg-workspaces-changed'));
      setMessage(success);
      setRevision((value) => value + 1);
      return data;
    } catch (failure) {
      setError(failure.message);
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  function select(id) {
    setSelected(id);
    setError('');
    setMessage('');
  }
  return {
    workspaces,
    invitations,
    ownershipTransfers,
    selected,
    details,
    loading,
    listResolved,
    detailsLoading,
    busy,
    error,
    message,
    select,
    act,
    refresh,
    setError,
    setMessage,
  };
}
