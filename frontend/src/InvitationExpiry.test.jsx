import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { WorkspaceInvitations } from './components/WorkspaceInvitations';
import { captureWorkspaceInvitation, readWorkspaceInvitation } from './lib/workspaceInvites';
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('dismisses only an unavailable invitation after a successful lookup', () => {
  captureWorkspaceInvitation('/workspaces?invite=missing&token=secret');
  const view = render(<WorkspaceInvitations invitations={[]} loading={false} resolved={false} />);
  act(() => vi.advanceTimersByTime(7000));
  expect(readWorkspaceInvitation()).toBeTruthy();
  view.rerender(<WorkspaceInvitations invitations={[]} loading={false} resolved />);
  expect(screen.getByText(/This invitation is not available/)).toBeTruthy();
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole('heading', { name: 'Your invitations' })).toBeNull();
  expect(readWorkspaceInvitation()).toBeNull();
});
it('keeps a valid invitation available for explicit acceptance', () => {
  captureWorkspaceInvitation('/workspaces?invite=valid&token=secret');
  render(
    <WorkspaceInvitations
      invitations={[
        {
          invitation_id: 'valid',
          workspace_name: 'Studio',
          role: 'member',
          expires_at: 1893456000,
        },
      ]}
      loading={false}
      resolved
      onAccept={vi.fn()}
    />,
  );
  act(() => vi.advanceTimersByTime(7000));
  expect(screen.getByRole('button', { name: 'Join workspace' })).toBeTruthy();
  expect(readWorkspaceInvitation()).toBeTruthy();
});
