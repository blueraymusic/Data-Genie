import { useEffect, useState } from 'react';
import { api, formatTime } from '../lib/api';
import { WorkspaceDialog } from './WorkspaceDialog';
import { Icon } from './Icon';
import '../styles/agents.css';

const labels = {
  'databases:read': 'Read databases & query',
  'queries:prepare': 'Prepare changes for review',
  'databases:create': 'Create blank databases',
  'reports:read': 'Read reports',
  'reports:write': 'Save private report drafts',
  'reports:generate': 'Draft with Data Genie AI',
};

export function AgentAccess({ passwordEnabled, active = true }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState(false),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState(null),
    [workspaceId, setWorkspaceId] = useState(''),
    [scopes, setScopes] = useState(['databases:read', 'reports:read']),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError('');
    Promise.all([
      api('/api/agent-tokens', { signal: controller.signal }),
      api('/api/workspaces', { signal: controller.signal }),
    ])
      .then(([keys, spaces]) => {
        if (!controller.signal.aborted) {
          setData({ ...keys, ...spaces });
          setWorkspaceId(spaces.workspaces[0]?.workspace_id || '');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision, active]);
  const workspace = data?.workspaces.find((item) => item.workspace_id === workspaceId);
  const allowed = Object.keys(labels).filter((scope) =>
    workspace?.role === 'viewer' || workspace?.archived_at
      ? scope === 'reports:read'
      : scope !== 'databases:create' || workspace?.role === 'owner',
  );
  const selectedScopes = [...new Set(scopes.filter((scope) => allowed.includes(scope)))];
  async function create(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/agent-tokens', {
        method: 'POST',
        body: {
          name: values.name,
          workspace_id: workspaceId,
          password: values.password,
          days: Number(values.days),
          scopes: selectedScopes,
        },
      });
      form.reset();
      setCreated(result);
      const { token: secret, ...metadata } = result;
      setData((current) => ({ ...current, tokens: [metadata, ...current.tokens] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(token) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/api/agent-tokens/revoke', { method: 'POST', body: { token_id: token.token_id } });
      setData((current) => ({
        ...current,
        tokens: current.tokens.map((item) =>
          item.token_id === token.token_id ? { ...item, revoked_at: Date.now() / 1000 } : item,
        ),
      }));
      setNotice(`${token.name} revoked. It can no longer make requests.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy) {
      setDialog(false);
      setCreated(null);
      setError('');
      setNotice('');
    }
  }
  return (
    <div className="agent-access">
      <div className="agent-connection-methods">
        <section aria-label="Browser agents">
          <span className="agent-method-label">
            <Icon name="workspace" />
            Browser agents
          </span>
          <h3>Sign in through your agent</h3>
          <p>
            Add this MCP server URL in your agent. Data Genie will ask you to choose a workspace and
            permissions.
          </p>
          <div className="agent-endpoint">
            <code>{window.location.origin}/mcp</code>
            <button
              className="btn quiet"
              aria-label="Copy MCP server URL"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.origin + '/mcp');
                  setNotice('MCP server URL copied.');
                } catch {
                  setNotice('Select and copy the MCP server URL above.');
                }
              }}
            >
              <Icon name="copy" />
            </button>
          </div>
        </section>
        <section aria-label="Scripts and apps">
          <span className="agent-method-label">
            <Icon name="layers" />
            Scripts &amp; apps
          </span>
          <h3>Connect with an API key</h3>
          <p>
            Create a key below for one workspace. Send it as a Bearer token when calling the HTTP
            API.
          </p>
          <div className="agent-endpoint">
            <code>{window.location.origin}/api/v1</code>
          </div>
        </section>
      </div>
      <div className="agent-intro">
        <div>
          <h3>Keys &amp; connections</h3>
          <p className="muted small">
            Access stays within your permissions. Revoke it here at any time.
          </p>
        </div>
        <button
          className="btn"
          disabled={!data?.workspaces.length || !passwordEnabled || busy}
          onClick={() => {
            setCreated(null);
            setError('');
            setDialog(true);
          }}
        >
          New agent key
        </button>
      </div>
      {!passwordEnabled && (
        <p className="small muted">
          Creating agent keys currently requires a Data Genie password account.
        </p>
      )}
      {!data && !error && (
        <p role="status" className="small muted">
          Loading agent connections…
        </p>
      )}
      {data && !data.tokens.length && <p className="small muted">No agent keys yet.</p>}
      <ul className="agent-key-list" aria-label="Agent keys">
        {data?.tokens.map((token) => {
          const inactive = token.revoked_at || token.expires_at * 1000 <= Date.now();
          return (
            <li key={token.token_id}>
              <div>
                <strong>{token.name}</strong>
                <span className="small muted">
                  {data.workspaces.find((item) => item.workspace_id === token.workspace_id)?.name ||
                    'Workspace unavailable'}{' '}
                  ·{' '}
                  {token.revoked_at
                    ? 'Revoked'
                    : inactive
                      ? 'Expired'
                      : `Expires ${formatTime(token.expires_at * 1000)}`}
                </span>
                <span className="small muted">
                  {token.scopes.map((scope) => labels[scope] || scope).join(' · ')}
                </span>
              </div>
              {!inactive && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => revoke(token)}
                  aria-label={`Revoke ${token.name}`}
                >
                  Revoke
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!dialog && error && (
        <div>
          <p className="err" role="alert">
            {error}
          </p>
          {!data && (
            <button className="btn" onClick={() => setRevision((value) => value + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
      {!dialog && notice && (
        <p className="small ok" role="status">
          {notice}
        </p>
      )}
      <p className="small">
        <a
          href="https://github.com/blueraymusic/Data-Genie/blob/dev/docs/agents.md"
          target="_blank"
          rel="noreferrer"
        >
          MCP & API setup ↗
        </a>{' '}
        ·{' '}
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
          API schema ↗
        </a>
      </p>
      {dialog && (
        <WorkspaceDialog
          title={created ? 'Your agent key' : 'Connect an agent'}
          description={
            created
              ? 'Copy it now. You won’t be able to see it again.'
              : 'Choose the workspace and actions this agent may use.'
          }
          onClose={close}
          busy={busy}
        >
          {created ? (
            <div className="agent-key-created">
              <label>
                Agent key
                <input
                  readOnly
                  autoFocus
                  type="text"
                  autoComplete="off"
                  value={created.token}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.token);
                    setNotice('Key copied.');
                  } catch {
                    setNotice('Select and copy the key above.');
                  }
                }}
              >
                Copy key
              </button>
              <p className="small muted">
                Set DATA_GENIE_API_KEY in your MCP client’s private environment. Keep this key out
                of chat messages and source control. Revoke it here whenever needed.
              </p>
              <button className="btn pri" onClick={close}>
                Done
              </button>
              {notice && (
                <p className="small ok" role="status">
                  {notice}
                </p>
              )}
            </div>
          ) : (
            <form className="agent-key-form" onSubmit={create}>
              <label>
                Key name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="My research agent"
                  autoComplete="off"
                />
              </label>
              <div className="agent-form-pair">
                <label>
                  Workspace
                  <select
                    value={workspaceId}
                    onChange={(event) => {
                      setWorkspaceId(event.target.value);
                      setScopes(['reports:read']);
                    }}
                  >
                    {data.workspaces.map((item) => (
                      <option key={item.workspace_id} value={item.workspace_id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Expires in
                  <select name="days" defaultValue="30">
                    <option value="1">1 day</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </select>
                </label>
              </div>
              <fieldset>
                <legend>Allowed actions</legend>
                <div className="agent-scope-grid">
                  {allowed.map((scope) => (
                    <label key={scope}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={(event) =>
                          setScopes((current) =>
                            event.target.checked
                              ? [
                                  ...current,
                                  scope,
                                  ...(scope === 'queries:prepare' ? ['databases:read'] : []),
                                ]
                              : current.filter(
                                  (item) =>
                                    item !== scope &&
                                    !(scope === 'databases:read' && item === 'queries:prepare'),
                                ),
                          )
                        }
                      />
                      {labels[scope]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="small muted">
                Changes wait for your review in the site. Reports stay private drafts. AI drafting
                uses your existing quota and sends the supplied notes to Data Genie’s AI service.
              </p>
              <label>
                Confirm your password
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              {error && (
                <p className="err" role="alert">
                  {error}
                </p>
              )}
              <div className="agent-dialog-actions">
                <button className="btn" type="button" onClick={close} disabled={busy}>
                  Cancel
                </button>
                <button className="btn pri" disabled={busy || !selectedScopes.length}>
                  {busy ? 'Creating key…' : 'Create key'}
                </button>
              </div>
            </form>
          )}
        </WorkspaceDialog>
      )}
    </div>
  );
}
