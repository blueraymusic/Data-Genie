import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { applyText, diffText, mapTextPosition, transformText } from '../lib/textOperations';

const identifier = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fields = ['title', 'body'];

export function useReportCollaboration({ base, enabled, draft, setDraft }) {
  const session = useRef(null),
    draftRef = useRef(draft),
    setter = useRef(setDraft),
    selection = useRef(null);
  const [status, setStatus] = useState({
    ready: false,
    pending: false,
    collaborators: [],
    error: '',
  });
  draftRef.current = draft;
  setter.current = setDraft;
  const reportId = enabled ? draft?.report_id : null;
  useLayoutEffect(() => {
    const restore = selection.current;
    selection.current = null;
    if (restore && document.activeElement === restore.element) {
      const text = Array.from(restore.element.value);
      restore.element.setSelectionRange(
        text.slice(0, restore.start).join('').length,
        text.slice(0, restore.end).join('').length,
        restore.direction,
      );
    }
  });
  const publish = useCallback((state, remoteSelection) => {
    if (!state.alive || !state.confirmed || !draftRef.current) return;
    const text = Object.fromEntries(fields.map((field) => [field, state.confirmed[field]]));
    for (const edit of state.pending)
      text[edit.field] = applyText(text[edit.field], edit.operation);
    const next = { ...draftRef.current, ...text, version: state.confirmed.base_version };
    if (!state.sharingChanged) next.published = state.confirmed.published;
    draftRef.current = next;
    setter.current(next);
    if (remoteSelection) selection.current = remoteSelection;
    setStatus({
      ready: true,
      pending: state.pending.length > 0,
      collaborators: state.collaborators,
      error: state.error || '',
    });
  }, []);
  useEffect(() => {
    if (!reportId) {
      session.current = null;
      setStatus({ ready: false, pending: false, collaborators: [], error: '' });
      return;
    }
    const controller = new AbortController();
    const state = {
      alive: true,
      pending: [],
      confirmed: null,
      clientId: identifier(),
      collaborators: [],
      request: null,
      polling: null,
      timer: null,
      error: '',
      blocked: false,
      sharingChanged: false,
    };
    session.current = state;
    setStatus({ ready: false, pending: false, collaborators: [], error: '' });
    const url = base + '/' + encodeURIComponent(reportId) + '/live';
    function integrate(data) {
      if (!state.alive || state.blocked) return;
      try {
        merge(data);
      } catch (error) {
        // A response that cannot be merged must never replace the visible
        // local draft, even if an older successful request arrives afterward.
        state.blocked = true;
        throw error;
      }
    }
    function merge(data) {
      if (!data.document)
        throw new Error('Live editing is unavailable. Your writing is kept here.');
      state.collaborators = data.collaborators || [];
      if (!state.confirmed) {
        state.confirmed = { ...data.document };
        publish(state);
        return;
      }
      if (data.reset) {
        if (state.pending.length) {
          state.blocked = true;
          throw new Error(
            'This editing session was disconnected too long to merge safely. Your local writing is kept; copy it before reopening the live draft.',
          );
        }
        state.confirmed = { ...data.document };
        publish(state);
        return;
      }
      const element = document.activeElement;
      const field = element?.dataset?.liveField;
      let caret =
        fields.includes(field) && typeof element.selectionStart === 'number'
          ? {
              element,
              field,
              start: Array.from(element.value.slice(0, element.selectionStart)).length,
              end: Array.from(element.value.slice(0, element.selectionEnd)).length,
              direction: element.selectionDirection,
            }
          : null;
      for (const remote of data.operations || []) {
        if (remote.revision <= state.confirmed.revision) continue;
        if (remote.revision !== state.confirmed.revision + 1)
          throw new Error(
            'Some live edits have not arrived yet. Your writing is kept while reconnecting.',
          );
        const own = state.pending[0]?.operation_id === remote.operation_id;
        if (own) state.pending.shift();
        else {
          let incoming = remote.operation;
          for (const pending of state.pending) {
            if (pending.field !== remote.field) continue;
            [pending.operation, incoming] = transformText(
              pending.operation,
              incoming,
              pending.operation_id < remote.operation_id,
            );
          }
          if (caret?.field === remote.field) {
            caret.start = mapTextPosition(caret.start, incoming);
            caret.end = mapTextPosition(caret.end, incoming);
          }
        }
        state.confirmed[remote.field] = applyText(state.confirmed[remote.field], remote.operation);
        state.confirmed.revision = remote.revision;
      }
      if (state.confirmed.revision === data.document.revision) {
        state.confirmed.base_version = data.document.base_version;
        state.confirmed.published = data.document.published;
      }
      if (!state.blocked) state.error = '';
      publish(state, caret);
    }
    function failure(error) {
      if (!state.alive || error.name === 'AbortError') return;
      state.error = error.message;
      state.blocked = state.blocked || error.status === 400 || error.status === 403;
      setStatus((current) => ({
        ...current,
        error: error.message,
        pending: state.pending.length > 0,
      }));
    }
    function schedule() {
      clearTimeout(state.timer);
      if (!state.alive || state.blocked || !state.pending.length) return;
      state.timer = setTimeout(() => send().catch(() => {}), 300);
    }
    async function send() {
      if (state.request) return state.request;
      if (!state.alive || !state.confirmed || !state.pending.length) return;
      if (state.blocked)
        throw new Error(state.error || 'Live syncing is unavailable. Your writing is kept.');
      const edit = state.pending[0];
      edit.attempted = true;
      state.request = (async () => {
        try {
          const data = await api(url, {
            method: 'POST',
            signal: controller.signal,
            body: { ...edit, client_id: state.clientId, base_revision: state.confirmed.revision },
          });
          integrate(data);
        } catch (error) {
          failure(error);
          throw error;
        } finally {
          state.request = null;
          schedule();
        }
      })();
      return state.request;
    }
    async function poll() {
      if (state.polling) return state.polling;
      if (!state.alive || document.visibilityState === 'hidden') return;
      state.polling = (async () => {
        try {
          const data = await api(
            url +
              '?after=' +
              (state.confirmed?.revision || 0) +
              '&client_id=' +
              encodeURIComponent(state.clientId),
            { signal: controller.signal },
          );
          integrate(data);
          schedule();
        } catch (error) {
          failure(error);
        } finally {
          state.polling = null;
        }
      })();
      return state.polling;
    }
    state.schedule = schedule;
    state.flush = async () => {
      clearTimeout(state.timer);
      if (!state.confirmed) throw new Error('Wait for the live draft to connect before saving.');
      while (state.request || state.pending.length) {
        if (state.request) await state.request;
        else await send();
      }
      await poll();
      if (state.blocked) throw new Error(state.error);
      return {
        ...state.confirmed,
        published: state.sharingChanged ? draftRef.current.published : state.confirmed.published,
      };
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      state.alive = false;
      controller.abort();
      clearTimeout(state.timer);
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [base, reportId, publish]);
  const changeDraft = useCallback((update) => {
    const current = draftRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    const state = session.current;
    if (state?.confirmed && state.alive) {
      for (const field of fields) {
        if (current[field] === next[field]) continue;
        const last = state.pending.at(-1);
        if (last?.field === field && !last.attempted) {
          let before = state.confirmed[field];
          for (const edit of state.pending.slice(0, -1))
            if (edit.field === field) before = applyText(before, edit.operation);
          if (before === next[field]) state.pending.pop();
          else last.operation = diffText(before, next[field]);
        } else
          state.pending.push({
            operation_id: identifier(),
            field,
            operation: diffText(current[field], next[field]),
          });
      }
      if (current.published !== next.published) state.sharingChanged = true;
      state.schedule();
      setStatus((value) => ({ ...value, pending: state.pending.length > 0 }));
    }
    draftRef.current = next;
    setter.current(next);
  }, []);
  const flush = useCallback(
    async () => (session.current?.flush ? session.current.flush() : null),
    [],
  );
  return { ...status, active: Boolean(reportId), changeDraft, flush };
}
