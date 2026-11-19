import { useEffect, useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { useRouter, Link } from '../lib/router';
import { api } from '../lib/api';
import { clearAgentAuthorization } from '../lib/agentAuthorization';
import '../styles/agents.css';

export default function AgentConsentPage() {
  const { route } = useRouter();
  const flow = new URLSearchParams(route.split('?')[1] || '').get('flow') || '';
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [workspaceId, setWorkspaceId] = useState(''),
    [scopes, setScopes] = useState([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api('/api/oauth/flow?flow=' + encodeURIComponent(flow), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setWorkspaceId(result.workspaces[0]?.workspace_id || '');
        setScopes(
          result.scopes.filter((scope) => ['databases:read', 'reports:read'].includes(scope)),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [flow]);
  const workspace = data?.workspaces.find((item) => item.workspace_id === workspaceId);
  const allowed =
    data?.scopes.filter((scope) =>
      workspace?.role === 'viewer'
        ? scope === 'reports:read'
        : scope !== 'databases:create' || workspace?.role === 'owner',
    ) || [];
  const selected = scopes.filter((scope) => allowed.includes(scope));
  async function consent(approve) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/oauth/consent', {
        method: 'POST',
        body: { flow, approve, workspace_id: workspaceId, scopes: selected },
      });
      const destination = new URL(result.url);
      if (
        destination.protocol !== 'https:' &&
        !(
          destination.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname)
        )
      )
        throw new Error('The client callback is invalid.');
      clearAgentAuthorization();
      window.location.assign(destination.href);
    } catch (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  return (
    <AuthShell title="Connect your agent." lead="Choose what this connection can access.">
      {!data && !error && (
        <p className="small muted" role="status">
          Loading connection request…
        </p>
      )}
      {data && (
        <div className="agent-key-form">
          <h2>{data.client_name}</h2>
          <p className="small muted">
            This client’s name is self-reported. Check the callback address before approving.
          </p>
          <p className="agent-callback">
            <span className="small muted">Return address</span>
            <strong>{data.callback}</strong>
          </p>
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
          <fieldset>
            <legend>Allow this connection to</legend>
            {!allowed.length && (
              <p className="small muted">
                This workspace cannot grant the requested actions. Choose another workspace or
                cancel.
              </p>
            )}
            <div className="agent-scope-grid">
              {allowed.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={selected.includes(scope)}
                    onChange={(event) =>
                      setScopes((current) =>
                        event.target.checked
                          ? [
                              ...new Set([
                                ...current,
                                scope,
                                ...(scope === 'queries:prepare' ? ['databases:read'] : []),
                              ]),
                            ]
                          : current.filter(
                              (item) =>
                                item !== scope &&
                                !(scope === 'databases:read' && item === 'queries:prepare'),
                            ),
                      )
                    }
                  />
                  {data.scope_labels[scope]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="small muted">
            Your current workspace permissions still apply. SQL changes need your confirmation in
            Data Genie. Reports stay private drafts. AI drafting sends the supplied notes to the
            configured AI service.
          </p>
          <p className="small muted">
            This connection expires in 30 days. You can revoke it sooner in Account → Agents &amp;
            API.
          </p>
          <div className="agent-dialog-actions">
            <button className="btn" disabled={busy} onClick={() => consent(false)}>
              Cancel
            </button>
            <button
              className="btn pri"
              disabled={busy || !selected.length || !workspaceId}
              onClick={() => consent(true)}
            >
              {busy ? 'Connecting…' : 'Allow connection'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!data && error && (
        <Link href="/account" onClick={clearAgentAuthorization}>
          Back to your account
        </Link>
      )}
    </AuthShell>
  );
}
