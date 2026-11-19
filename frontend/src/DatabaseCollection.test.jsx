import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useDatabaseCollection } from './hooks/useDatabaseCollection';
import { setDragPreview } from './lib/dragPreview';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const databases = Array.from({ length: 20 }, (_, index) => ({
  database_id: index + 1,
  database: `Database ${index + 1}`,
  provider: 'sqlite',
}));
it('paginates twenty databases and resets to the first page when searching', () => {
  const { result } = renderHook(() => useDatabaseCollection(databases, 'team'));
  expect(result.current.items).toHaveLength(2);
  expect(result.current.pages).toBe(10);
  act(() => result.current.setPage(10));
  expect(result.current.items.map((item) => item.database_id)).toEqual([19, 20]);
  act(() => result.current.setQuery('  DATABASE 20  '));
  expect(result.current.page).toBe(1);
  expect(result.current.items[0].database_id).toBe(20);
  act(() => result.current.setQuery('missing'));
  expect(result.current.items).toEqual([]);
  expect(result.current.start).toBe(0);
});
it('clamps pages after live removals without jumping back when items return, and resets between teams', () => {
  const { result, rerender } = renderHook(
    ({ items, scope }) => useDatabaseCollection(items, scope),
    { initialProps: { items: databases, scope: 'one' } },
  );
  act(() => result.current.setPage(10));
  rerender({ items: databases.slice(0, 1), scope: 'one' });
  expect(result.current.page).toBe(1);
  rerender({ items: databases, scope: 'one' });
  expect(result.current.page).toBe(1);
  act(() => result.current.setQuery('missing'));
  rerender({ items: databases, scope: 'two' });
  expect(result.current.query).toBe('');
  expect(result.current.items).toHaveLength(2);
});
it('uses only a small file emoji as the drag image, without adding a floating layer', () => {
  const context = { fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const setDragImage = vi.fn();
  setDragPreview({ dataTransfer: { setDragImage } });
  const [canvas, x, y] = setDragImage.mock.calls[0];
  expect([canvas.width, canvas.height]).toEqual([40, 44]);
  expect(context.fillText).toHaveBeenCalledWith('📄', 20, 22);
  expect([x, y]).toEqual([20, 22]);
  expect(canvas.isConnected).toBe(false);
});
