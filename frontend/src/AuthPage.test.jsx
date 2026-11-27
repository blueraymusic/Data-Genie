import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthPage from './pages/AuthPage';
import { Router } from './lib/router';

const auth = vi.hoisted(() => ({}));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}));
const profile = { first_name: 'Ana', last_name: 'Brooks', email: 'ana@example.test' };
const password = 'a long unique passphrase 42';
const response = (data) => Promise.resolve({ ok: true, json: async () => data });

beforeEach(() => {
  history.replaceState({}, '', '/signup');
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Object.assign(auth, {
    authenticate: vi.fn(),
    refresh: vi.fn(),
    error: '',
    connectionError: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response({ google: { enabled: true } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function show() {
  return render(
    <Router>
      <AuthPage />
    </Router>,
  );
}
async function enterIdentity(events, email = profile.email) {
  await events.type(screen.getByLabelText('First name'), profile.first_name);
  await events.type(screen.getByLabelText('Last name'), profile.last_name);
  await events.type(screen.getByLabelText('Email', { exact: true }), email);
}
async function next(events) {
  await enterIdentity(events);
  await events.click(screen.getByRole('button', { name: 'Continue', exact: true }));
}

describe('compact account creation', () => {
  it('does not submit registration until both steps are complete, then sends the entire draft', async () => {
    auth.authenticate.mockResolvedValue({
      verification_required: true,
      challenge: 'fixture-only',
      email: profile.email,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    const events = userEvent.setup();
    show();
    await next(events);
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('First name').closest('fieldset').disabled).toBe(true);
    expect(screen.getByLabelText('First name').closest('fieldset').hidden).toBe(true);
    await events.type(screen.getByLabelText('Password', { exact: true }), password);
    await events.type(screen.getByLabelText('Confirm password'), password);
    await events.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    await screen.findByRole('heading', { name: 'Check your email.', exact: true });
    expect(auth.authenticate).toHaveBeenCalledOnce();
    expect(auth.authenticate).toHaveBeenCalledWith('register', {
      ...profile,
      password,
      confirmPassword: password,
    });
  });

  it('preserves all field values when moving Back and Continue, with focus on the active step', async () => {
    const events = userEvent.setup();
    show();
    await next(events);
    const secret = screen.getByLabelText('Password', { exact: true });
    await waitFor(() => expect(document.activeElement).toBe(secret));
    await events.type(secret, password);
    await events.type(screen.getByLabelText('Confirm password'), password);
    await events.click(screen.getByRole('button', { name: 'Back', exact: true }));
    const firstName = screen.getByLabelText('First name');
    await waitFor(() => expect(document.activeElement).toBe(firstName));
    expect(firstName.value).toBe(profile.first_name);
    expect(screen.getByLabelText('Last name').value).toBe(profile.last_name);
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(profile.email);
    await events.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    expect(screen.getByLabelText('Password', { exact: true })).toBe(secret);
    expect(secret.value).toBe(password);
    expect(screen.getByLabelText('Confirm password').value).toBe(password);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('uses native email validation before advancing to the password step', async () => {
    const events = userEvent.setup();
    show();
    await enterIdentity(events, 'not-an-email');
    const email = screen.getByLabelText('Email', { exact: true });
    expect(email.validity.typeMismatch).toBe(true);
    await events.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    expect(screen.getByRole('group', { name: 'Your details', exact: true })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Secure your account', exact: true })).toBeNull();
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('advances on Enter and puts keyboard focus in the password field', async () => {
    const events = userEvent.setup();
    show();
    await enterIdentity(events);
    await events.type(screen.getByLabelText('Email', { exact: true }), '{Enter}');
    const secret = screen.getByLabelText('Password', { exact: true });
    await waitFor(() => expect(document.activeElement).toBe(secret));
    expect(screen.getByRole('button', { name: 'Create account', exact: true })).toBeTruthy();
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('focuses the confirmation field after a mismatch and keeps the draft available', async () => {
    const events = userEvent.setup();
    show();
    await next(events);
    await events.type(screen.getByLabelText('Password', { exact: true }), password);
    const confirm = screen.getByLabelText('Confirm password');
    await events.type(confirm, 'a different long passphrase 42');
    await events.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(screen.getByRole('alert').textContent).toBe('The passwords do not match.');
    expect(document.activeElement).toBe(confirm);
    expect(screen.getByLabelText('Password', { exact: true }).value).toBe(password);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('offers Google only on the details step, including after a password-step round trip', async () => {
    const events = userEvent.setup();
    show();
    await screen.findByRole('link', { name: 'Sign up with Google' });
    await next(events);
    expect(screen.queryByRole('link', { name: 'Sign up with Google' })).toBeNull();
    await events.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(screen.getByRole('link', { name: 'Sign up with Google' })).toBeTruthy();
  });

  it('keeps Google and the original details form out of the email verification step', async () => {
    auth.authenticate.mockResolvedValue({
      verification_required: true,
      challenge: 'fixture-only',
      email: profile.email,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    const events = userEvent.setup();
    show();
    await screen.findByRole('link', { name: 'Sign up with Google' });
    await next(events);
    await events.type(screen.getByLabelText('Password', { exact: true }), password);
    await events.type(screen.getByLabelText('Confirm password'), password);
    await events.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    await screen.findByLabelText('Verification code');
    expect(screen.queryByRole('link', { name: 'Sign up with Google' })).toBeNull();
    expect(screen.queryByLabelText('First name')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Check your email.', exact: true })).toHaveLength(
      1,
    );
  });

  it('opens Terms separately so reviewing them does not navigate away or clear the draft', async () => {
    const events = userEvent.setup();
    show();
    await enterIdentity(events);
    const terms = screen.getByRole('link', { name: /^Terms & Conditions/ });
    expect(terms.getAttribute('href')).toBe('/terms');
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(terms.getAttribute('rel')).toContain('noopener');
    // JSDOM cannot open a browser tab; prevent that external action, then check
    // the actual router and controlled form remain unchanged by the click.
    terms.addEventListener('click', (event) => event.preventDefault());
    await events.click(terms);
    expect(location.pathname).toBe('/signup');
    expect(screen.getByLabelText('First name').value).toBe(profile.first_name);
    expect(screen.getByLabelText('Last name').value).toBe(profile.last_name);
    expect(screen.getByLabelText('Email', { exact: true }).value).toBe(profile.email);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
});
