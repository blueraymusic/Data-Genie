import { useState } from 'react';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceTabs } from './WorkspaceTabs';

export function PersonalWorkspace({ user, view, onNavigate, logout, children }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await logout();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page">
      <a className="skip-link" href="#personalContent">
        Skip to main content
      </a>
      <div id="app">
        <WorkspaceHeader
          session={null}
          identity={user}
          view={view}
          onNavigate={onNavigate}
          onLogout={signOut}
          disabled={busy}
        />
        <main className="content personal-content" id="personalContent" tabIndex="-1">
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
      <WorkspaceTabs view={view} onNavigate={onNavigate} />
    </div>
  );
}
