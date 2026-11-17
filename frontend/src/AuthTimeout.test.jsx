import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api, rememberSession, savedSession, setCsrfToken } from './lib/api';

const user = { account_id: 1, first_name: 'Test', email: 'reader@example.test' };
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const advance = (duration) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(duration);
  });
const settle = () => advance(0);

let auth;
function AuthProbe() {
  auth = useAuth();
  return <input aria-label="SQL draft" defaultValue="SELECT * FROM customers" />;
}
function renderAuth() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  setCsrfToken('');
  history.replaceState({}, '', '/signin');
  window.scrollTo = vi.fn();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => {
  cleanup();
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['/signin', '/signup'])(
  'ends a stalled initial login check after eight seconds and preserves retry drafts on %s',
  async (path) => {
    history.replaceState({}, '', path);
    rememberSession('saved-database');
    const initial = deferred(),
      retry = deferred();
    let reads = 0;
    fetch.mockImplementation((url) =>
      url === '/api/auth/providers'
        ? response({ google: { enabled: false } })
        : ++reads === 1
          ? initial.promise
          : retry.promise,
    );
    render(<App />);
    const initialSignal = fetch.mock.calls[0][1].signal;
    await advance(7999);
    expect(screen.getByText('Checking your login.')).toBeTruthy();
    expect(initialSignal.aborted).toBe(false);
    await advance(1);
    expect(initialSignal.aborted).toBe(true);
    expect(screen.queryByText('Checking your login.')).toBeNull();
    expect(screen.getByText('Checking your login took too long. Please try again.')).toBeTruthy();
    expect(savedSession()).toBe('saved-database');

    const email = screen.getByRole('textbox', { name: 'Email', exact: true }),
      password = screen.getByLabelText('Password', { exact: true });
    fireEvent.change(email, { target: { value: user.email } });
    fireEvent.change(password, { target: { value: 'a long test passphrase' } });
    if (path === '/signup') {
      fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Test' } });
      fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reader' } });
      fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: 'a long test passphrase' },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection', exact: true }));
    expect(screen.getByRole('button', { name: 'Checking connection…' }).disabled).toBe(true);
    expect(screen.getByLabelText('Password', { exact: true })).toBe(password);
    expect(password.value).toBe('a long test passphrase');
    await act(async () => {
      retry.resolve(await response({ user: null }));
    });
    expect(screen.queryByRole('button', { name: 'Retry connection', exact: true })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Email', exact: true })).toBe(email);
    expect(email.value).toBe(user.email);
    expect(password.value).toBe('a long test passphrase');
    if (path === '/signup') {
      expect(screen.getByLabelText('First name').value).toBe('Test');
      expect(screen.getByLabelText('Last name').value).toBe('Reader');
      expect(screen.getByLabelText('Confirm password').value).toBe('a long test passphrase');
    }
    await act(async () => {
      // A transport that ignores abort must not restore an account after a newer check.
      initial.resolve(await response({ user, csrf_token: 'late-token' }));
    });
    expect(screen.getByRole('textbox', { name: 'Email', exact: true })).toBe(email);
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['/api/auth/session', 'GET'],
      ['/api/auth/providers', 'GET'],
      ['/api/auth/session', 'GET'],
    ]);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('includes a stalled JSON body in the login deadline and ignores its late result', async () => {
  const body = deferred();
  fetch.mockResolvedValue({ ok: true, status: 200, json: () => body.promise });
  renderAuth();
  await settle();
  const signal = fetch.mock.calls[0][1].signal;
  expect(auth.loading).toBe(true);
  await advance(8000);
  expect(signal.aborted).toBe(true);
  expect(auth.loading).toBe(false);
  expect(auth.connectionError).toBe(true);
  expect(auth.error).toBe('Checking your login took too long. Please try again.');
  await act(async () => {
    body.resolve({ user, csrf_token: 'late-token' });
  });
  expect(auth.user).toBeNull();
  expect(auth.connectionError).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the current account, token, saved session and draft when a background check times out', async () => {
  const delayed = deferred();
  let reads = 0;
  fetch.mockImplementation((url) =>
    url === '/api/auth/session'
      ? ++reads === 1
        ? response({ user, csrf_token: 'current-token' })
        : delayed.promise
      : response({}),
  );
  rememberSession('saved-database');
  renderAuth();
  await settle();
  expect(vi.getTimerCount()).toBe(0);
  const draft = screen.getByLabelText('SQL draft');
  fireEvent.change(draft, { target: { value: 'SELECT customer_id FROM customers' } });
  let pending;
  await act(async () => {
    pending = auth.refresh().catch((error) => error);
  });
  expect(auth.loading).toBe(false);
  await advance(8000);
  expect((await pending).message).toContain('took too long');
  expect(auth.user).toBe(user);
  expect(auth.connectionError).toBe(true);
  expect(savedSession()).toBe('saved-database');
  expect(screen.getByLabelText('SQL draft')).toBe(draft);
  expect(draft.value).toBe('SELECT customer_id FROM customers');
  const expired = vi.fn();
  window.addEventListener('genie-auth-expired', expired);
  await act(async () => {
    delayed.resolve(await response({ auth_required: true, error: 'Old login expired' }, 401));
  });
  expect(expired).not.toHaveBeenCalled();
  window.removeEventListener('genie-auth-expired', expired);
  expect(auth.user).toBe(user);
  expect(savedSession()).toBe('saved-database');
  await api('/api/probe', { method: 'POST', body: {} });
  expect(fetch.mock.calls.at(-1)[1].headers['X-CSRF-Token']).toBe('current-token');
});

it('does not replace a newer login or its error state when an older check times out', async () => {
  const oldCheck = deferred(),
    newerUser = { ...user, account_id: 2 };
  let reads = 0;
  fetch.mockImplementation((url) =>
    url === '/api/auth/session'
      ? ++reads === 1
        ? response({ user, csrf_token: 'old-token' })
        : oldCheck.promise
      : response({ user: newerUser, csrf_token: 'new-token' }),
  );
  renderAuth();
  await settle();
  let pending;
  await act(async () => {
    pending = auth.refresh().catch((error) => error);
    await auth.authenticate('login', { email: 'new@example.test', password: 'passphrase' });
  });
  await advance(8000);
  await pending;
  expect(auth.user).toBe(newerUser);
  expect(auth.error).toBe('');
  expect(auth.connectionError).toBe(false);
  await act(async () => {
    oldCheck.resolve(await response({ user, csrf_token: 'old-token' }));
  });
  expect(auth.user).toBe(newerUser);
  await api('/api/probe', { method: 'POST', body: {} });
  expect(fetch.mock.calls.at(-1)[1].headers['X-CSRF-Token']).toBe('new-token');
});

it('aborts a pending check and clears its deadline when the provider unmounts', async () => {
  const delayed = deferred();
  fetch.mockReturnValue(delayed.promise);
  const view = renderAuth();
  const signal = fetch.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  await settle();
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => {
    delayed.resolve(await response({ user, csrf_token: 'late-token' }));
  });
});
