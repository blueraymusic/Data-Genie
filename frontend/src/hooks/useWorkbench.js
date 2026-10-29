import { useCallback, useEffect, useRef, useState } from 'react';
import { api, rememberSession, savedSession } from '../lib/api';

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

export function useWorkbench(user) {
  const [session, setSession] = useState(null),
    [feed, setFeed] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [workingCommands, setWorkingCommands] = useState(new Set());
  const active = useRef(null),
    version = useRef(0),
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
    try {
      const history = await api('/api/history', { sessionId: data.session_id });
      if (version.current === revision)
        setFeed(
          history.requests
            .filter((request) => request.request_id > (data.conversation_after || 0))
            .map(normalizeRequest)
            .reverse(),
        );
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
        if (live && !data.session_required && !data.ended_at) return adopt(data);
      })
      .catch((error) => {
        rememberSession(null);
        if (live) setMessage('Choose a database to continue. ' + error.message);
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
    const data = await api('/api/status', { sessionId: id });
    if (active.current === id && version.current === revision) setSession(data);
  }, []);
  const open = useCallback(
    async (payload, resumeId) => {
      if (inFlight.current) throw new Error('Wait for the current request to finish.');
      if (pending || commandLocks.current.size)
        throw new Error('Confirm or decline the pending change before switching databases.');
      inFlight.current = true;
      setBusy(true);
      setMessage('');
      try {
        const data = resumeId
          ? await api('/api/sessions/resume', {
              method: 'POST',
              sessionId: active.current,
              body: { session_id: resumeId },
            })
          : payload.database_mode === 'postgresql'
            ? await api('/api/sessions', {
                method: 'POST',
                sessionId: active.current,
                body: payload,
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
              : await api('/api/sessions', { method: 'POST', body: payload });
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
    async (text, raw = false, interpreter = 'keywords', selectedTable = null) => {
      const id = active.current,
        revision = version.current;
      if (!id || inFlight.current || commandLocks.current.size || pending || !text.trim()) return;
      inFlight.current = true;
      setBusy(true);
      setMessage('');
      const temporary = 'sending-' + Date.now();
      setFeed((previous) => [
        ...previous,
        {
          request_id: temporary,
          text,
          status: 'pending',
          submitted_at: new Date().toISOString(),
          commands: [],
          sending: true,
        },
      ]);
      try {
        const data = await api(raw ? '/api/query' : '/api/ask', {
          method: 'POST',
          sessionId: id,
          body: raw
            ? { sql: text }
            : { question: text, interpreter, selected_table: selectedTable },
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
    [pending, refresh],
  );
  const decide = useCallback(
    async (command, decline = false) => {
      const id = active.current,
        revision = version.current;
      if (!id || commandLocks.current.has(command.command_id)) return;
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
        if (active.current === id && version.current === revision) setMessage(error.message);
      } finally {
        commandLocks.current.delete(command.command_id);
        setWorkingCommands(new Set(commandLocks.current));
      }
    },
    [refresh],
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
    submit,
    decide,
    end,
    newConversation,
    refresh: () => refresh(active.current),
    setMessage,
  };
}
