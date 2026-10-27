let csrfToken = '';
export const setCsrfToken = (value) => {
  csrfToken = value || '';
};

export async function api(path, { method = 'GET', body, sessionId, signal } = {}) {
  const headers = {};
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (sessionId) headers['X-Session-ID'] = sessionId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      'The server returned an unreadable response. Check History before retrying a change.',
    );
  }
  if (!response.ok) {
    if (data.auth_required && !['/api/auth/login', '/api/auth/register'].includes(path))
      window.dispatchEvent(new Event('genie-auth-expired'));
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function rememberSession(id) {
  try {
    if (id) sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: id }));
    else sessionStorage.removeItem('data-genie-session');
  } catch {
    /* In-memory sessions still work when storage is disabled. */
  }
}

export function savedSession() {
  try {
    return JSON.parse(sessionStorage.getItem('data-genie-session') || 'null')?.session_id;
  } catch {
    return null;
  }
}

export async function encodeDatabase(file) {
  if (!file || !file.size || file.size > 25 * 1024 * 1024)
    throw new Error('Choose a SQLite file between 1 byte and 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export const quoteIdentifier = (name) => '"' + name.replaceAll('"', '""') + '"';
export const formatTime = (value) => (value ? new Date(value).toLocaleString() : '');
