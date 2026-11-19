import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskPage from './pages/AskPage';
import { Router } from './lib/router';
beforeEach(() => {
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
it('sends PDF context only with an explicit request and retains it on failure', async () => {
  const user = userEvent.setup();
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <Router>
      <AskPage
        selected="customers"
        draft="show customers"
        setDraft={vi.fn()}
        workbench={{
          session: { session_id: '1', tables: ['customers'], ai: { enabled: true } },
          feed: [],
          submit,
          workingCommands: new Set(),
        }}
      />
    </Router>,
  );
  await user.upload(
    screen.getByLabelText('Attach PDF or image'),
    new File(['%PDF-1.4 fixture'], 'reference.pdf', { type: 'application/pdf' }),
  );
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Ask', exact: true }));
  expect(submit).toHaveBeenCalledWith('show customers', false, 'gemini', 'customers', [
    { mime_type: 'application/pdf', data: btoa('%PDF-1.4 fixture') },
  ]);
  expect(screen.getByRole('button', { name: 'Remove reference.pdf' })).toBeTruthy();
});

it('supports file drops with the same limits and sends nothing until asked', async () => {
  const submit = vi.fn();
  const { container } = render(
    <Router>
      <AskPage
        selected="customers"
        draft="show customers"
        setDraft={vi.fn()}
        workbench={{
          session: { session_id: 'drop', tables: ['customers'], ai: { enabled: true } },
          feed: [],
          submit,
          workingCommands: new Set(),
        }}
      />{' '}
    </Router>,
  );
  const drop = (files) =>
    fireEvent.drop(container.querySelector('.composer'), {
      dataTransfer: { files, types: ['Files'] },
    });
  drop([new File(['image'], 'reference.png', { type: 'image/png' })]);
  await screen.findByRole('button', { name: 'Remove reference.png' });
  expect(submit).not.toHaveBeenCalled();
  drop([
    new File(['a'], 'a.pdf', { type: 'application/pdf' }),
    new File(['b'], 'b.pdf', { type: 'application/pdf' }),
  ]);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('up to two files'));
  expect(screen.queryByRole('button', { name: 'Remove a.pdf' })).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
