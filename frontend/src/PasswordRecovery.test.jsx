import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage';
import { Router } from './lib/router';
vi.mock('./context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}));

beforeEach(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState({}, '', '/');
});
function show(path) {
  history.replaceState({}, '', path);
  render(
    <Router>
      <PasswordRecoveryPage />
    </Router>,
  );
}
it('requests recovery with an email and displays the generic server response', async () => {
  const message =
    'If an account with a password exists for this email, you will receive instructions to reset it.';
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message }) });
  vi.stubGlobal('fetch', fetcher);
  show('/forgot-password');
  const events = userEvent.setup();
  await events.type(screen.getByLabelText('Email'), 'reader@example.com');
  await events.click(screen.getByRole('button', { name: 'Send reset instructions' }));
  expect(await screen.findByText(message)).toBeTruthy();
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe('/api/auth/forgot-password');
  expect(JSON.parse(request.body)).toEqual({ email: 'reader@example.com' });
});
it('captures the token from the email link, removes it from the URL, and submits it with matching passwords', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ message: 'Password updated. Log in.' }) });
  vi.stubGlobal('fetch', fetcher);
  show('/reset-password#token=private-fixture-token');
  expect(location.hash).toBe('');
  const events = userEvent.setup();
  await events.type(screen.getByLabelText('New password'), 'a new long passphrase 123');
  await events.type(screen.getByLabelText('Confirm new password'), 'another long passphrase 456');
  await events.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(screen.getByRole('alert').textContent).toBe('The passwords do not match.');
  expect(fetcher).not.toHaveBeenCalled();
  await events.clear(screen.getByLabelText('Confirm new password'));
  await events.type(screen.getByLabelText('Confirm new password'), 'a new long passphrase 123');
  await events.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByText('Password updated. Log in.')).toBeTruthy();
  expect(fetcher.mock.calls[0][0]).toBe('/api/auth/reset-password');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    token: 'private-fixture-token',
    new_password: 'a new long passphrase 123',
  });
});
it('offers a new link when opened without a recovery token', () => {
  show('/reset-password');
  expect(screen.getByRole('alert').textContent).toContain('Open the reset link');
  expect(screen.getByRole('link', { name: 'Request a new reset link' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save new password' })).toBeNull();
});
