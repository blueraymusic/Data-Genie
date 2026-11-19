const storageKey = 'genie-agent-authorization';
export function captureAgentAuthorization(route) {
  if (route.split('?')[0] !== '/connect-agent') return;
  const flow = new URLSearchParams(route.split('?')[1] || '').get('flow');
  if (/^[A-Za-z0-9_-]{43}$/.test(flow || '')) {
    try {
      sessionStorage.setItem(storageKey, flow);
    } catch {}
  }
}
export function pendingAgentAuthorization() {
  try {
    const flow = sessionStorage.getItem(storageKey);
    return /^[A-Za-z0-9_-]{43}$/.test(flow || '') ? '/connect-agent?flow=' + flow : '';
  } catch {
    return '';
  }
}
export function clearAgentAuthorization() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {}
}
