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
  microsoft_linked: false,
};
const response = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const account = () =>
  render(
    <Router>
      <AccountPage workbench={{ session: null }} />
    </Router>,
  );
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
    vi.fn(() => response({ microsoft: { enabled: true } })),
  );
  setCsrfToken('csrf-for-test');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCsrfToken('');
});

describe('Microsoft sign-in', () => {
  it.each(['/signin', '/signup'])(
    'offers a native provider redirect on %s alongside the password form',
    async (path) => {
      history.replaceState({}, '', path);
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      const link = await screen.findByRole('link', { name: 'Continue with Microsoft' });
      expect(link.getAttribute('href')).toBe('/api/auth/microsoft/start');
      expect(screen.getByLabelText('Password', { exact: true })).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: path === '/signup' ? 'Create account' : 'Log in',
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
          : response({ microsoft: { enabled } }),
      );
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith('/api/auth/providers', expect.anything()),
      );
      expect(screen.queryByRole('link', { name: 'Continue with Microsoft' })).toBeNull();
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
    const link = await screen.findByRole('link', { name: 'Continue with Microsoft' });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.setup().click(link);
    expect(sessionStorage.getItem('data-genie-session')).toBeNull();
  });
  it('shows a safe error without rendering provider response text', async () => {
    history.replaceState({}, '', '/signin?microsoft_error=%3Cscript%3Ebad%3C/script%3E');
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Microsoft sign-in could not be completed. Please try again.',
    );
    expect(screen.queryByText(/<script>/)).toBeNull();
    expect(await screen.findByRole('link', { name: 'Continue with Microsoft' })).toBeTruthy();
  });
  it('explains how to connect an existing password account', () => {
    history.replaceState({}, '', '/signin?microsoft_error=account_exists');
    render(
      <Router>
        <AuthPage />
      </Router>,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'connect Microsoft from Account & preferences',
    );
  });
  it('explains sign-in throttling without encouraging immediate retries', () => {
    history.replaceState({}, '', '/signin?microsoft_error=rate_limited');
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
      history.replaceState({}, '', '/signin?microsoft_error=' + code);
      render(
        <Router>
          <AuthPage />
        </Router>,
      );
      expect(screen.getByRole('alert').textContent).toBe(
        'Microsoft sign-in could not be completed. Please try again.',
      );
    },
  );
  it('replaces password controls for Microsoft-only accounts', async () => {
    auth.user = { ...localUser, password_enabled: false, microsoft_linked: true };
    account();
    await screen.findByText('Microsoft account connected');
    expect(screen.getByText(/Your sign-in is managed by Microsoft/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Connect Microsoft account' })).toBeNull();
  });
  it('retains password changes for a linked local account and refreshes after a verified callback', async () => {
    history.replaceState({}, '', '/account?microsoft=linked');
    auth.user = { ...localUser, microsoft_linked: true };
    account();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    expect(
      screen.getByText('You can log in with Microsoft or your Data Genie password.'),
    ).toBeTruthy();
    await waitFor(() => expect(auth.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText('Microsoft sign-in is connected to your account.')).toBeTruthy();
  });
  it('requires the current password and sends CSRF protection before connecting', async () => {
    const events = userEvent.setup();
    fetch.mockImplementation((path) =>
      path === '/api/auth/providers'
        ? response({ microsoft: { enabled: true } })
        : response({ error: 'Your current password is incorrect.' }, 400),
    );
    account();
    const form = await screen.findByRole('form', { name: 'Connect Microsoft account' });
    expect(form.checkValidity()).toBe(false);
    await events.type(screen.getByLabelText('Data Genie password'), 'a long current passphrase');
    await events.click(screen.getByRole('button', { name: 'Connect Microsoft', exact: true }));
    const [, options] = fetch.mock.calls.find(([path]) => path === '/api/auth/microsoft/link');
    expect(options.method).toBe('POST');
    expect(options.headers['X-CSRF-Token']).toBe('csrf-for-test');
    expect(JSON.parse(options.body)).toEqual({ password: 'a long current passphrase' });
    expect(await screen.findByText('Your current password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Microsoft', exact: true }).disabled).toBe(
      false,
    );
  });
  it('refuses to navigate to a URL outside the fixed backend linking endpoint', async () => {
    const events = userEvent.setup();
    fetch.mockImplementation((path) =>
      response(
        path === '/api/auth/providers'
          ? { microsoft: { enabled: true } }
          : { url: 'https://untrusted.example/signin' },
      ),
    );
    account();
    await events.type(
      await screen.findByLabelText('Data Genie password'),
      'a long current passphrase',
    );
    await events.click(screen.getByRole('button', { name: 'Connect Microsoft', exact: true }));
    expect(
      await screen.findByText('Microsoft sign-in could not be started. Please try again.'),
    ).toBeTruthy();
    expect(location.pathname).toBe('/signin');
  });
});
