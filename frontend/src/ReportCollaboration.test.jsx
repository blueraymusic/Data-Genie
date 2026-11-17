import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useReportCollaboration } from './hooks/useReportCollaboration';
import { applyText, transformText } from './lib/textOperations';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function Editor() {
  const [draft, setDraft] = useState({
    report_id: 'report',
    title: 'Findings',
    body: 'abc',
    published: false,
    version: 1,
  });
  const [snapshot, setSnapshot] = useState(null);
  const live = useReportCollaboration({
    base: '/api/workspaces/team/reports',
    enabled: true,
    draft,
    setDraft,
  });
  return (
    <>
      <textarea
        aria-label="Report text"
        data-live-field="body"
        value={draft.body}
        disabled={!live.ready}
        onChange={(event) => live.changeDraft((value) => ({ ...value, body: event.target.value }))}
      />
      <p>
        {live.ready ? (live.pending ? 'Typing is syncing' : 'All typing synced') : 'Connecting'}
      </p>
      <p>{live.collaborators.map((person) => person.first_name).join(', ')}</p>
      <p role="alert">{live.error}</p>
      <button onClick={async () => setSnapshot(await live.flush())}>Save snapshot</button>
      {snapshot && <output>{JSON.stringify(snapshot)}</output>}
    </>
  );
}
function server() {
  const document = {
    report_id: 'report',
    title: 'Findings',
    body: 'abc',
    base_version: 1,
    revision: 0,
    published: false,
  };
  const operations = [];
  const append = (operation, operation_id, field = 'body') => {
    document[field] = applyText(document[field], operation);
    document.revision += 1;
    operations.push({ revision: document.revision, operation_id, field, operation });
  };
  const response = (after) => ({
    document: { ...document },
    operations: operations.filter((item) => item.revision > after),
    collaborators: [{ first_name: 'Partner' }],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path, options) => {
      let data;
      if (options.method === 'POST') {
        const request = JSON.parse(options.body);
        let operation = request.operation;
        for (const remote of operations.filter(
          (item) => item.revision > request.base_revision && item.field === request.field,
        ))
          [operation] = transformText(
            operation,
            remote.operation,
            request.operation_id < remote.operation_id,
          );
        append(operation, request.operation_id, request.field);
        data = response(request.base_revision);
      } else
        data = response(
          Number(new URL(path, 'https://example.test').searchParams.get('after') || 0),
        );
      return { ok: true, status: 200, json: async () => data };
    }),
  );
  return { document, append };
}

it('shows a partner’s typing, merges pending local edits, preserves the cursor and flushes before saving', async () => {
  vi.useFakeTimers();
  const service = server();
  render(<Editor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText('Partner')).toBeTruthy();
  const text = screen.getByLabelText('Report text');
  text.focus();
  fireEvent.change(text, { target: { value: 'aLc' } });
  text.setSelectionRange(2, 2);
  service.append([1, 'R', 2], 'partner-op');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(text.value).toBe('aRLc');
  expect(text.selectionStart).toBe(3);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(service.document.body).toBe('aRLc');
  expect(screen.getByText('All typing synced')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(JSON.parse(screen.getByRole('status').textContent)).toMatchObject({
    body: 'aRLc',
    revision: 2,
  });
});

it('keeps local writing when connectivity fails and retries it after reconnecting', async () => {
  vi.useFakeTimers();
  const service = server();
  render(<Editor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  const fetchWorking = fetch.getMockImplementation();
  fetch.mockImplementation(async () => {
    throw new TypeError('Offline');
  });
  fireEvent.change(screen.getByLabelText('Report text'), { target: { value: 'abc local' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(screen.getByLabelText('Report text').value).toBe('abc local');
  expect(service.document.body).toBe('abc');
  expect(screen.getByRole('alert').textContent).toContain('Could not reach Data Genie');
  fetch.mockImplementation(fetchWorking);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1300);
  });
  expect(service.document.body).toBe('abc local');
  expect(screen.getByLabelText('Report text').value).toBe('abc local');
});
