import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerifySignup } from './components/VerifySignup';
import { Router } from './lib/router';
const authenticate = vi.hoisted(() => vi.fn());
vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ authenticate }) }));
const initial = {
  challenge: 'private-fixture',
  email: 'code@example.test',
  expires_at: Math.floor(Date.now() / 1000) + 300,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('verifies six digits without resending profile or password', async () => {
  authenticate.mockResolvedValue({ account_id: 1 });
  const complete = vi.fn(),
    user = userEvent.setup();
  render(<VerifySignup initial={initial} onVerified={complete} onRestart={vi.fn()} />);
  expect(screen.getByText(/3 attempts maximum/)).toBeTruthy();
  await user.type(screen.getByLabelText('Verification code'), '012345');
  await user.click(screen.getByRole('button', { name: 'Verify and create account' }));
  expect(authenticate).toHaveBeenCalledWith('verify-email', {
    challenge: initial.challenge,
    code: '012345',
  });
  expect(complete).toHaveBeenCalledOnce();
});
it('keeps the account uncreated on a wrong code and shows the attempt budget', async () => {
  authenticate.mockRejectedValue(new Error('Incorrect code. 2 attempts remaining.'));
  const complete = vi.fn(),
    user = userEvent.setup();
  render(<VerifySignup initial={initial} onVerified={complete} onRestart={vi.fn()} />);
  await user.type(screen.getByLabelText('Verification code'), '654321');
  await user.click(screen.getByRole('button', { name: 'Verify and create account' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Incorrect code. 2 attempts remaining.')).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});
it('disables verification after expiry and lets the person restart', async () => {
  const restart = vi.fn();
  render(<VerifySignup initial={{ ...initial, expires_at: 1 }} onRestart={restart} />);
  expect(screen.getByRole('button', { name: 'Verify and create account' }).disabled).toBe(true);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Use different details' }));
  expect(restart).toHaveBeenCalledOnce();
  expect(authenticate).not.toHaveBeenCalled();
});
it('offers login and password recovery after proving an already registered mailbox', async () => {
  authenticate.mockResolvedValue({
    sign_in_required: true,
    message: 'This email is already verified. Log in or reset your password.',
  });
  const complete = vi.fn(),
    events = userEvent.setup();
  render(
    <Router>
      <VerifySignup initial={initial} onVerified={complete} onRestart={vi.fn()} />
    </Router>,
  );
  await events.type(screen.getByLabelText('Verification code'), '012345');
  await events.click(screen.getByRole('button', { name: 'Verify and create account' }));
  expect(await screen.findByRole('link', { name: 'Reset password' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});
