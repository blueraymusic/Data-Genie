import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useReportCollaboration } from './hooks/useReportCollaboration';
import { applyText, diffText, transformText } from './lib/textOperations';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const document = {
  report_id: 'report',
  title: 'Findings',
  body: 'ab😀cd',
  published: false,
  base_version: 1,
  revision: 0,
};
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const initial = () => response({ document: { ...document }, operations: [], collaborators: [] });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function useEditor() {
  const [draft, setDraft] = useState({ ...document, version: 1 });
  const live = useReportCollaboration({
    base: '/api/workspaces/team/reports',
    enabled: true,
    draft,
    setDraft,
  });
  return { draft, live };
}
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('retains access-revocation errors when an older edit response arrives later', async () => {
  vi.useFakeTimers();
  const oldPost = deferred();
  let request;
  let getCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path, options) => {
      if (options.method === 'POST') {
        request = JSON.parse(options.body);
        return oldPost.promise;
      }
      getCount += 1;
      return getCount === 1
        ? initial()
        : response({ error: 'Your report access was revoked.' }, 403);
    }),
  );
  const { result } = renderHook(useEditor);
  await tick();
  act(() => result.current.live.changeDraft((draft) => ({ ...draft, body: 'ab😀cd local' })));
  await tick(350);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(result.current.live.error).toContain('access was revoked');
  await act(async () =>
    oldPost.resolve(
      response({
        document: { ...document, revision: 1, body: 'ab😀cd local' },
        operations: [
          {
            revision: 1,
            operation_id: request.operation_id,
            field: 'body',
            operation: request.operation,
          },
        ],
        collaborators: [],
      }),
    ),
  );
  expect(result.current.live.error).toContain('access was revoked');
  expect(result.current.draft.body).toBe('ab😀cd local');
  expect(result.current.live.pending).toBe(true);
});

it('retries an accepted edit with the same ID after a lost response without duplicating text', async () => {
  vi.useFakeTimers();
  const current = { ...document };
  const operations = [];
  const attempts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path, options) => {
      let after;
      if (options.method === 'POST') {
        const edit = JSON.parse(options.body);
        attempts.push(edit.operation_id);
        if (!operations.some((item) => item.operation_id === edit.operation_id)) {
          current.body = applyText(current.body, edit.operation);
          current.revision += 1;
          operations.push({ ...edit, revision: current.revision });
        }
        if (attempts.length === 1) throw new TypeError('Response was lost after commit');
        after = edit.base_revision;
      } else after = Number(new URL(path, 'https://example.test').searchParams.get('after'));
      return response({
        document: { ...current },
        operations: operations.filter((item) => item.revision > after),
        collaborators: [],
      });
    }),
  );
  const { result } = renderHook(useEditor);
  await tick();
  act(() => result.current.live.changeDraft((draft) => ({ ...draft, body: 'ab💡😀cd' })));
  await tick(650);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  expect(current.body).toBe('ab💡😀cd');
  expect(result.current.draft.body).toBe(current.body);
  expect(result.current.live.pending).toBe(false);
});

it('keeps the local draft and stops submissions when its merge log has expired', async () => {
  vi.useFakeTimers();
  let gets = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      gets += 1;
      return gets === 1
        ? initial()
        : response({
            document: { ...document, revision: 1001, body: 'remote latest' },
            reset: true,
            operations: [],
            collaborators: [],
          });
    }),
  );
  const { result } = renderHook(useEditor);
  await tick();
  act(() =>
    result.current.live.changeDraft((draft) => ({ ...draft, body: 'my unpublished local text' })),
  );
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await tick(500);
  expect(result.current.live.error).toContain('disconnected too long');
  expect(result.current.draft.body).toBe('my unpublished local text');
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});

it('does not revert newer content or saved versions when an older poll finishes late', async () => {
  vi.useFakeTimers();
  const oldPoll = deferred();
  let gets = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path, options) => {
      if (options.method === 'POST') {
        const edit = JSON.parse(options.body);
        return response({
          document: {
            ...document,
            revision: 1,
            base_version: 2,
            body: 'ab😀cd latest',
            published: true,
          },
          operations: [
            {
              revision: 1,
              operation_id: edit.operation_id,
              field: 'body',
              operation: edit.operation,
            },
          ],
          collaborators: [],
        });
      }
      gets += 1;
      return gets === 2 ? oldPoll.promise : initial();
    }),
  );
  const { result } = renderHook(useEditor);
  await tick();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  act(() => result.current.live.changeDraft((draft) => ({ ...draft, body: 'ab😀cd latest' })));
  await tick(350);
  expect(result.current.draft.version).toBe(2);
  await act(async () => oldPoll.resolve(initial()));
  expect(result.current.draft).toMatchObject({
    body: 'ab😀cd latest',
    version: 2,
    published: true,
  });
});

it('converges for randomized Unicode replacements with either insert priority', () => {
  let seed = 927353;
  const random = (bound) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % bound;
  };
  const chars = [...'abXY😀💡é𐐷', '\u0301', '\r', '\n'];
  const text = (length) => Array.from({ length }, () => chars[random(chars.length)]).join('');
  for (let index = 0; index < 5000; index += 1) {
    const before = text(random(30));
    const replace = () => {
      const list = Array.from(before),
        start = random(list.length + 1),
        end = start + random(list.length - start + 1);
      return list.slice(0, start).join('') + text(random(8)) + list.slice(end).join('');
    };
    const left = diffText(before, replace()),
      right = diffText(before, replace());
    const [afterLeft, afterRight] = transformText(left, right, Boolean(random(2)));
    expect(applyText(applyText(before, left), afterRight)).toBe(
      applyText(applyText(before, right), afterLeft),
    );
  }
});
