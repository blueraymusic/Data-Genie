import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthPage from './pages/AuthPage';
import AccountPage from './pages/AccountPage';
import { Router } from './lib/router';
import { setCsrfToken } from './lib/api';

const auth = vi.hoisted(() => ({}));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./context/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
const localUser = {
  account_id: 1,
  first_name: 'Ana',
  last_name: 'Brooks',
  email: 'ana@example.test',
  password_enabled: true,
  google_linked: false,
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const account = () => {
  const view = render(
    <Router>
      <AccountPage workbench={{ session: null }} />
    </Router>,
  );
  return view;
};
beforeEach(() => {
  history.replaceState({}, '', '/signin');
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Object.assign(auth, {
    user: { ...localUser },
    authenticate: vi.fn(),
    refresh: vi.fn().mockResolvedValue(localUser),
    changePassword: vi.fn(),
    error: '',
    connectionError: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ google: { enabled: true } })),
  );
  setCsrfToken('csrf-for-test');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCsrfToken('');
});

describe('Google sign-in', () => {
  it.each(['/signin', '/signup'])(
    'offers a native provider redirect on %s alongside email authentication',
    async (path) => {
      history.replaceState({}, '', path);
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      const link = await screen.findByRole('link', { name: 'Continue with Google' });
      expect(link.getAttribute('href')).toBe('/api/auth/google/start');
      expect(screen.getByLabelText('Password', { exact: true })).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: path === '/signup' ? 'Continue' : 'Log in',
          exact: true,
        }),
      ).toBeTruthy();
    },
  );
  it.each([false, 'failed'])(
    'keeps local sign-in usable when the provider is %s',
    async (enabled) => {
      fetch.mockImplementation(() =>
        enabled === 'failed'
          ? response({ error: 'Unavailable' }, 503)
          : response({ google: { enabled } }),
      );
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith('/api/auth/providers', expect.anything()),
      );
      expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
      expect(screen.getByLabelText('Password', { exact: true })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Log in', exact: true }).disabled).toBe(false);
    },
  );
  it('clears the previous workspace selection before an account switch', async () => {
    sessionStorage.setItem(
      'data-genie-session',
      JSON.stringify({ session_id: 'previous-account' }),
    );
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.setup().click(link);
    expect(sessionStorage.getItem('data-genie-session')).toBeNull();
  });
  it('does not offer Microsoft or treat its availability as Google availability', async () => {
    fetch.mockImplementation(() => response({ microsoft: { enabled: true } }));
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/auth/providers', expect.anything()),
    );
    expect(screen.queryByRole('link', { name: /Continue with/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log in', exact: true }).disabled).toBe(false);
  });
  it('does not redirect or clear the saved workspace while password login is pending', async () => {
    const events = userEvent.setup();
    auth.authenticate.mockReturnValue(new Promise(() => {}));
    sessionStorage.setItem('data-genie-session', JSON.stringify({ session_id: 'current' }));
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    const link = await screen.findByRole('link', { name: 'Continue with Google' });
    await events.type(screen.getByLabelText('Email', { exact: true }), 'ana@example.test');
    await events.type(screen.getByLabelText('Password', { exact: true }), 'current passphrase');
    await events.click(screen.getByRole('button', { name: 'Log in', exact: true }));
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(
      false,
    );
    expect(JSON.parse(sessionStorage.getItem('data-genie-session'))).toEqual({
      session_id: 'current',
    });
  });
  it('shows a safe error without rendering provider response text', async () => {
    history.replaceState({}, '', '/signin?google_error=%3Cscript%3Ebad%3C/script%3E');
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Google sign-in could not be completed. Please try again.',
    );
    expect(screen.queryByText(/<script>/)).toBeNull();
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toBeTruthy();
  });
  it('explains how to connect an existing password account', () => {
    history.replaceState({}, '', '/signin?google_error=account_exists');
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'connect Google from Account & preferences',
    );
  });
  it('explains sign-in throttling without encouraging immediate retries', () => {
    history.replaceState({}, '', '/signin?google_error=rate_limited');
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Too many sign-in attempts. Wait a few minutes before trying again.',
    );
  });
  it.each(['toString', '__proto__', 'constructor'])(
    'treats inherited object names as unknown error codes: %s',
    (code) => {
      history.replaceState({}, '', '/signin?google_error=' + code);
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      expect(screen.getByRole('alert').textContent).toBe(
        'Google sign-in could not be completed. Please try again.',
      );
    },
  );
  it('replaces password controls for Google-only accounts', async () => {
    auth.user = { ...localUser, password_enabled: false, google_linked: true };
    account();
    await screen.findByText('Google account connected');
    expect(screen.getByText(/Your sign-in is managed by Google/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Connect Google account' })).toBeNull();
  });
  it('retains password changes for a linked local account and refreshes after a verified callback', async () => {
    history.replaceState({}, '', '/account?google=linked');
    auth.user = { ...localUser, google_linked: true };
    account();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(
      screen.getByText('You can log in with Google or your Data Genie password.'),
    ).toBeTruthy();
    await waitFor(() => expect(auth.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText('Google sign-in is connected to your account.')).toBeTruthy();
  });
  it('requires the current password and sends CSRF protection before connecting', async () => {
    const events = userEvent.setup();
    fetch.mockImplementation((path) =>
      path === '/api/auth/providers'
        ? response({ google: { enabled: true } })
        : response({ error: 'Your current password is incorrect.' }, 400),
    );
    account();
    const form = await screen.findByRole('form', { name: 'Connect Google account' });
    expect(form.checkValidity()).toBe(false);
    await events.type(screen.getByLabelText('Data Genie password'), 'a long current passphrase');
    await events.click(screen.getByRole('button', { name: 'Connect Google', exact: true }));
    const [, options] = fetch.mock.calls.find(([path]) => path === '/api/auth/google/link');
    expect(options.method).toBe('POST');
    expect(options.headers['X-CSRF-Token']).toBe('csrf-for-test');
    expect(JSON.parse(options.body)).toEqual({ password: 'a long current passphrase' });
    expect(await screen.findByText('Your current password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Google', exact: true }).disabled).toBe(
      false,
    );
  });
  it('refuses to navigate to a URL outside the fixed backend linking endpoint', async () => {
    const events = userEvent.setup();
    fetch.mockImplementation((path) =>
      response(
        path === '/api/auth/providers'
          ? { google: { enabled: true } }
          : { url: 'https://untrusted.example/signin' },
      ),
    );
    account();
    await events.type(
      await screen.findByLabelText('Data Genie password'),
      'a long current passphrase',
    );
    await events.click(screen.getByRole('button', { name: 'Connect Google', exact: true }));
    expect(
      await screen.findByText('Google sign-in could not be started. Please try again.'),
    ).toBeTruthy();
    expect(location.pathname).toBe('/signin');
  });
});
