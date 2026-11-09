const storageKey = 'dg-workspace-invitation';

export function readWorkspaceInvitation() {
  try {
    const invitation = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    return invitation?.invitation_id && invitation?.token ? invitation : null;
  } catch {
    return null;
  }
}

export function captureWorkspaceInvitation(route) {
  if (route.split(/[?#]/)[0] !== '/workspaces') return false;
  const query = new URLSearchParams((route.split('?')[1] || '').split('#')[0]);
  const invitation_id = query.get('invite'),
    token = query.get('token');
  if (!invitation_id || !token) return false;
  if (invitation_id.length <= 100 && token.length <= 500) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ invitation_id, token }));
    } catch {}
  }
  return true;
}

export function forgetWorkspaceInvitation(invitationId) {
  try {
    if (!invitationId || readWorkspaceInvitation()?.invitation_id === invitationId)
      sessionStorage.removeItem(storageKey);
  } catch {}
}

export function invitationToken(value, invitationId) {
  const text = value.trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.pathname === '/workspaces' && url.searchParams.get('invite') === invitationId
      ? url.searchParams.get('token') || ''
      : '';
  } catch {
    return text;
  }
}
