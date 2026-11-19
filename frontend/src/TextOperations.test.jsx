import { expect, it } from 'vitest';
import { applyText, diffText, mapTextPosition, transformText } from './lib/textOperations';

it('merges Unicode insertions and deletes without removing a partner’s concurrent text', () => {
  const text = 'ab😀cd',
    left = diffText(text, 'aMb😀cd'),
    right = diffText(text, 'ab💡cd');
  const [leftAfterRight, rightAfterLeft] = transformText(left, right, true);
  expect(applyText(applyText(text, left), rightAfterLeft)).toBe('aMb💡cd');
  expect(applyText(applyText(text, right), leftAfterRight)).toBe('aMb💡cd');
  expect(mapTextPosition(3, [1, 'X', 4])).toBe(4);
  expect(mapTextPosition(3, [1, -3, 1])).toBe(1);
});

it('makes simultaneous insertions at the same position converge with stable ordering', () => {
  const text = 'ab';
  const left = diffText(text, 'a😀b'),
    right = diffText(text, 'a💡b');
  const [leftAfterRight, rightAfterLeft] = transformText(left, right, true);
  expect(applyText(applyText(text, left), rightAfterLeft)).toBe('a😀💡b');
  expect(applyText(applyText(text, right), leftAfterRight)).toBe('a😀💡b');
});
