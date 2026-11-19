import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceDialog } from './components/WorkspaceDialog';
afterEach(cleanup);
it('keeps keyboard navigation inside visible dialog controls', async () => {
  const user = userEvent.setup();
  render(
    <WorkspaceDialog title="Invite" onClose={vi.fn()}>
      <label>
        Email
        <input />
      </label>
      <details>
        <summary>Private link</summary>
        <input aria-label="Hidden private link" />
      </details>
      <button>Save</button>
      <div hidden>
        <button>Hidden action</button>
      </div>
    </WorkspaceDialog>,
  );
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
});
