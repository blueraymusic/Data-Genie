import { Component, useEffect, useLayoutEffect } from 'react';
import { Router, useRouter } from './lib/router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthShell } from './components/AuthShell';
import HomePage from './pages/HomePage';
import FaqPage from './pages/FaqPage';
import ContactPage from './pages/ContactPage';
import AuthPage from './pages/AuthPage';
import WorkspaceApp from './pages/WorkspaceApp';
import AgentConsentPage from './pages/AgentConsentPage';
import { captureAgentAuthorization, pendingAgentAuthorization } from './lib/agentAuthorization';
import { captureWorkspaceInvitation, readWorkspaceInvitation } from './lib/workspaceInvites';

function ProtectedPages() {
  const { user, loading } = useAuth(),
    { pathname, route, navigate } = useRouter();
  useLayoutEffect(() => {
    captureAgentAuthorization(route);
    if (captureWorkspaceInvitation(route)) navigate('/workspaces', true);
  }, [route, navigate]);
  useEffect(() => {
    if (!loading && !user && !['/signin', '/signup'].includes(pathname)) navigate('/signin', true);
    if (!loading && user && ['/signin', '/signup'].includes(pathname))
      navigate(
        pendingAgentAuthorization() || (readWorkspaceInvitation() ? '/workspaces' : '/databases'),
        true,
      );
  }, [loading, user, pathname, navigate]);
  if (loading)
    return (
      <AuthShell title="A moment, please." lead="Checking your login.">
        <p role="status">Loading…</p>
      </AuthShell>
    );
  return user ? (
    pathname === '/connect-agent' ? (
      <AgentConsentPage />
    ) : (
      <WorkspaceApp key={user.account_id} />
    )
  ) : (
    <AuthPage />
  );
}
function Pages() {
  const { pathname } = useRouter();
  if (['/', '/index.html'].includes(pathname)) return <HomePage />;
  if (['/faq', '/faq.html'].includes(pathname)) return <FaqPage />;
  if (['/contact', '/contact.html'].includes(pathname)) return <ContactPage />;
  return <ProtectedPages />;
}
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="workspace-page">
          <section className="gate">
            <h1>The page could not be displayed.</h1>
            <p>Your database changes and saved history remain on the server.</p>
            <a className="btn pri" href="/">
              Reload homepage
            </a>
          </section>
        </div>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <ThemeProvider>
          <AuthProvider>
            <Pages />
          </AuthProvider>
        </ThemeProvider>
      </Router>
    </ErrorBoundary>
  );
}
