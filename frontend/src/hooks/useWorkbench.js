import { useCallback, useEffect, useRef, useState } from 'react';
import { api, rememberSession, savedSession } from '../lib/api';
import { databaseAccess, canConfirmCommand } from '../lib/access';

export function normalizeCommand(command) {
  return {
    ...command,
    ...(command.result?.payload || {}),
    operation: command.sql_operation || command.operation,
    sql_operation: command.sql_operation || command.operation,
    status: command.status,
    requires_confirmation: Boolean(command.requires_confirmation && command.status === 'pending'),
  };
}
export function normalizeRequest(request) {
  return {
    ...request,
    text: request.text || request.request_text || '',
    commands: (request.commands || []).map(normalizeCommand),
  };
}

const unresolved = (request) =>
  request.commands?.some((command) => ['pending', 'running'].includes(command.status));
const recentFeed = (requests) =>
  requests.filter(
    (request, index) => index >= requests.length - 50 || request.sending || unresolved(request),
  );
function restoredFeed(history, conversationAfter = 0) {
  const requests = new Map(
    [...(history.pending_requests || []), ...history.requests]
      .filter((request) => request.request_id > conversationAfter)
      .map((request) => [request.request_id, normalizeRequest(request)]),
  );
  return [...requests.values()].sort((left, right) => left.request_id - right.request_id);
}

export function useWorkbench(user) {
  const [session, setSession] = useState(null),
    [feed, setFeed] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [workingCommands, setWorkingCommands] = useState(new Set());
  const active = useRef(null),
    version = useRef(0),
    statusVersion = useRef(0),
    inFlight = useRef(false),
    commandLocks = useRef(new Set());
  const pending = feed.some((request) =>
    request.commands.some(
      (command) => command.requires_confirmation && command.status === 'pending',
    ),
  );
  const adopt = useCallback(async (data) => {
    const revision = ++version.current;
    active.current = data.session_id;
    rememberSession(data.session_id);
    setSession(data);
    setFeed([]);
    setMessage('');
    if (!databaseAccess(data).canRead) return;
    try {
      const history = await api('/api/history?limit=50&include_pending=1', {
        sessionId: data.session_id,
      });
      if (version.current === revision)
        setFeed(restoredFeed(history, data.conversation_after || 0));
    } catch (error) {
      if (version.current === revision)
        setMessage('The database is open, but History could not be loaded. ' + error.message);
    }
  }, []);
  useEffect(() => {
    let live = true;
    const id = savedSession();
    if (!id) {
      setLoading(false);
      return;
    }
    api('/api/status', { sessionId: id })
      .then((data) => {
        if (!live) return;
        if (!data.session_required && !data.ended_at) return adopt(data);
        rememberSession(null);
        setMessage('Choose a database to continue. Your previous session has ended.');
      })
      .catch((error) => {
        if (live) {
          rememberSession(null);
          setMessage('Choose a database to continue. ' + error.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      version.current++;
      active.current = null;
    };
  }, [user.account_id, adopt]);
  const refresh = useCallback(async (id) => {
    const revision = version.current;
    const statusRevision = ++statusVersion.current;
    const current = () => active.current === id && version.current === revision;
    const forget = (message) => {
      version.current++;
      active.current = null;
      rememberSession(null);
      setFeed([]);
      setSession(null);
      setMessage(message);
    };
    try {
      const data = await api('/api/status', { sessionId: id });
      if (current() && statusVersion.current === statusRevision) {
        if (data.session_required || data.ended_at) {
          forget('Your previous session has ended. Choose a database to continue.');
          return;
        }
        setSession(data);
        if (!databaseAccess(data).canRead) setFeed([]);
      }
    } catch (error) {
      if (!current() || statusVersion.current !== statusRevision) return;
      if (error.status === 403) {
        forget('Your access to this database has changed. Choose a database you can access.');
        return;
      }
      if (error.code === 'session_unavailable') {
        forget('Your previous session has ended. Choose a database to continue.');
        return;
      }
      throw error;
    }
  }, []);
  useEffect(() => {
    if (!session?.session_id || !databaseAccess(session).canRead) return;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      refresh(session.session_id).catch((error) => {
        if (error.status !== 403) setMessage(error.message);
      });
    };
    const timer = setInterval(check, 15000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [session?.session_id, session?.access?.role, session?.access?.permissions?.read, refresh]);
  const open = useCallback(
    async (payload, resumeId) => {
      if (inFlight.current) throw new Error('Wait for the current request to finish.');
      if (pending || commandLocks.current.size)
        throw new Error('Confirm or decline the pending change before switching databases.');
      inFlight.current = true;
      setBusy(true);
      setMessage('');
      try {
        const destination =
          payload.workspace_id === undefined && session?.access?.role === 'owner'
            ? { ...payload, workspace_id: session.access.workspace_id }
            : payload;
        const data = resumeId
          ? await api('/api/sessions/resume', {
              method: 'POST',
              sessionId: active.current,
              body: { session_id: resumeId },
            })
          : payload.workspace_id || session?.access || payload.database_mode === 'postgresql'
            ? await api('/api/sessions', {
                method: 'POST',
                sessionId: active.current,
                body: destination,
              })
            : active.current
              ? await api(
                  payload.database_mode === 'create'
                    ? '/api/databases'
                    : payload.database_mode === 'sample'
                      ? '/api/reset'
                      : '/api/connect',
                  {
                    method: 'POST',
                    sessionId: active.current,
                    body:
                      payload.database_mode === 'create'
                        ? { name: payload.database_name, starter: payload.starter }
                        : payload.database_mode === 'sample'
                          ? { sample: true }
                          : payload,
                  },
                )
              : await api('/api/sessions', { method: 'POST', body: destination });
        await adopt(data);
        return data;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [adopt, pending, session?.access?.workspace_id, session?.access?.role],
  );
  const openShared = useCallback(
    async (workspaceId, databaseId) => {
      if (inFlight.current) throw new Error('Wait for the current request to finish.');
      if (pending || commandLocks.current.size)
        throw new Error('Confirm or decline the pending change before switching databases.');
      inFlight.current = true;
      setBusy(true);
      setMessage('');
      try {
        const data = await api('/api/workspaces/' + encodeURIComponent(workspaceId) + '/open', {
          method: 'POST',
          sessionId: active.current,
          body: { database_id: databaseId },
        });
        await adopt(data);
        return data;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [adopt, pending],
  );
  const submit = useCallback(
    async (text, raw = false, interpreter = 'keywords', selectedTable = null, attachments = []) => {
      const id = active.current,
        revision = version.current;
      if (!id || inFlight.current || commandLocks.current.size || pending || !text.trim()) return;
      if (!databaseAccess(session).canRead) {
        setMessage('Your database access has been revoked.');
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setMessage('');
      const temporary = 'sending-' + Date.now();
      setFeed((previous) =>
        recentFeed([
          ...previous,
          {
            request_id: temporary,
            text,
            raw_sql: raw,
            status: 'pending',
            submitted_at: new Date().toISOString(),
            commands: [],
            sending: true,
          },
        ]),
      );
      try {
        const data = await api(raw ? '/api/query' : '/api/ask', {
          method: 'POST',
          sessionId: id,
          body: raw
            ? { sql: text }
            : {
                question: text,
                interpreter,
                selected_table: selectedTable,
                ...(attachments.length ? { attachments } : {}),
              },
        });
        if (active.current !== id || version.current !== revision) return;
        const commands = data.commands?.length
          ? data.commands
          : data.sql || data.metadata
            ? [data]
            : [];
        const request = {
          request_id: data.request_id || temporary,
          text,
          raw_sql: raw,
          submitted_at: new Date().toISOString(),
          status:
            data.matched === false
              ? 'rejected'
              : commands.some((command) => command.requires_confirmation)
                ? 'pending'
                : 'executed',
          error: data.matched === false ? data.message : null,
          needs_clarification: data.needs_clarification,
          suggestions: data.suggestions || [],
          choices: data.choices || [],
          intent: data.intent || '',
          commands: commands.map((command) => ({
            ...command,
            status: command.status || (command.requires_confirmation ? 'pending' : 'executed'),
          })),
        };
        setFeed((previous) =>
          previous.map((item) => (item.request_id === temporary ? request : item)),
        );
        await refresh(id);
        return data;
      } catch (error) {
        if (active.current === id && version.current === revision) {
          setFeed((previous) =>
            previous.map((item) =>
              item.request_id === temporary
                ? { ...item, sending: false, status: 'rejected', error: error.message }
                : item,
            ),
          );
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [pending, refresh, session],
  );
  const decide = useCallback(
    async (command, decline = false) => {
      const id = active.current,
        revision = version.current;
      if (!id || commandLocks.current.has(command.command_id)) return;
      if (!databaseAccess(session).canRead || (!decline && !canConfirmCommand(session, command))) {
        setMessage('Your current permissions do not allow this action.');
        return;
      }
      commandLocks.current.add(command.command_id);
      setWorkingCommands(new Set(commandLocks.current));
      setMessage('');
      try {
        const data = await api('/api/commands/' + (decline ? 'decline' : 'confirm'), {
          method: 'POST',
          sessionId: id,
          body: { command_id: command.command_id, confirmation_token: command.confirmation_token },
        });
        if (active.current !== id || version.current !== revision) return;
        const declined = new Set(data.declined_command_ids || []);
        setFeed((previous) =>
          previous.map((request) => {
            if (
              !request.commands.some(
                (item) => item.command_id === command.command_id || declined.has(item.command_id),
              )
            )
              return request;
            const commands = request.commands.map((item) =>
              item.command_id === command.command_id
                ? {
                    ...item,
                    ...data,
                    status: decline ? 'declined' : data.status || 'executed',
                    requires_confirmation: false,
                  }
                : declined.has(item.command_id)
                  ? { ...item, status: 'declined', requires_confirmation: false }
                  : item,
            );
            return {
              ...request,
              commands,
              status: commands.some((item) => item.status === 'failed')
                ? 'rejected'
                : commands.some((item) => item.status === 'declined')
                  ? 'declined'
                  : commands.some((item) => item.status === 'pending')
                    ? 'pending'
                    : 'executed',
            };
          }),
        );
        await refresh(id);
      } catch (error) {
        if (active.current === id && version.current === revision) {
          setMessage(error.message);
          // A rejected confirmation may already be recorded as failed (or completed).
          // Read its stored outcome; never replay the decision or guess it succeeded.
          try {
            const requestId = command.request_id;
            const query = requestId
              ? '?request_id=' + encodeURIComponent(requestId)
              : '?limit=50&include_pending=1';
            const history = await api('/api/history' + query, { sessionId: id });
            if (active.current !== id || version.current !== revision) return;
            const saved = new Map(
              restoredFeed(history).map((request) => [request.request_id, request]),
            );
            setFeed((previous) =>
              previous.map((request) => {
                const stored = saved.get(request.request_id);
                if (!stored) return request;
                return {
                  ...request,
                  ...stored,
                  commands: stored.commands.map((item) => ({
                    ...request.commands.find((previous) => previous.command_id === item.command_id),
                    ...item,
                  })),
                };
              }),
            );
            await refresh(id);
          } catch {
            // Keep a pending command pending when its outcome cannot be checked.
          }
        }
      } finally {
        commandLocks.current.delete(command.command_id);
        setWorkingCommands(new Set(commandLocks.current));
      }
    },
    [refresh, session],
  );
  const end = useCallback(async () => {
    if (!active.current || pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api('/api/sessions/end', { method: 'POST', sessionId: active.current, body: {} });
      active.current = null;
      version.current++;
      rememberSession(null);
      setSession(null);
      setFeed([]);
      setMessage('Session ended. Your databases and history are saved.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [pending]);
  const newConversation = useCallback(async () => {
    const id = active.current,
      revision = version.current;
    if (!id || pending || inFlight.current || commandLocks.current.size) return false;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const data = await api('/api/conversation/reset', {
        method: 'POST',
        sessionId: id,
        body: {},
      });
      if (active.current !== id || version.current !== revision) return false;
      setSession((current) => ({
        ...current,
        conversation_after: data.conversation_after,
        conversation_context: null,
        pending_intent: '',
      }));
      setFeed([]);
      setMessage('New conversation started. Previous requests are saved in History.');
      return true;
    } catch (error) {
      if (active.current === id && version.current === revision) setMessage(error.message);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [pending]);
  return {
    session,
    feed,
    loading,
    busy,
    message,
    pending,
    workingCommands,
    open,
    openShared,
    submit,
    decide,
    end,
    newConversation,
    refresh: () => refresh(active.current),
    setMessage,
  };
}
