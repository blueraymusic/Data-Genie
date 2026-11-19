// Text operations count Unicode code points, matching the Python server.
const size = (value) => Array.from(value).length;
function append(operation, part) {
  if (part === '' || part === 0) return;
  const last = operation.at(-1);
  if (typeof last === typeof part && (typeof part === 'string' || part > 0 === last > 0))
    operation[operation.length - 1] += part;
  else operation.push(part);
}
export function diffText(before, after) {
  const a = Array.from(before),
    b = Array.from(after);
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix += 1;
  const operation = [];
  append(operation, prefix);
  append(operation, -(a.length - prefix - suffix));
  append(operation, b.slice(prefix, b.length - suffix).join(''));
  append(operation, suffix);
  return operation;
}
export function applyText(text, operation) {
  const chars = Array.from(text),
    output = [];
  let cursor = 0;
  for (const part of operation) {
    if (typeof part === 'string') output.push(part);
    else if (part > 0) {
      output.push(chars.slice(cursor, cursor + part).join(''));
      cursor += part;
    } else cursor -= part;
  }
  if (cursor !== chars.length)
    throw new Error('The live edit no longer matches this report. Your writing is kept.');
  return output.join('');
}
export function transformText(left, right, leftFirst = true) {
  const a = [...left],
    b = [...right],
    outA = [],
    outB = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    const x = a[i],
      y = b[j];
    if (typeof x === 'string' && (typeof y !== 'string' || leftFirst)) {
      append(outA, x);
      append(outB, size(x));
      i += 1;
      continue;
    }
    if (typeof y === 'string') {
      append(outA, size(y));
      append(outB, y);
      j += 1;
      continue;
    }
    if (x === undefined || y === undefined)
      throw new Error('The live edit no longer matches this report. Your writing is kept.');
    const count = Math.min(Math.abs(x), Math.abs(y));
    if (x > 0 && y > 0) {
      append(outA, count);
      append(outB, count);
    } else if (x < 0 && y > 0) append(outA, -count);
    else if (x > 0 && y < 0) append(outB, -count);
    a[i] += x > 0 ? -count : count;
    b[j] += y > 0 ? -count : count;
    if (a[i] === 0) i += 1;
    if (b[j] === 0) j += 1;
  }
  return [outA, outB];
}
export function mapTextPosition(position, operation) {
  let oldCursor = 0,
    newCursor = 0;
  for (const part of operation) {
    if (typeof part === 'string') {
      newCursor += size(part);
      continue;
    }
    if (part > 0) {
      if (position < oldCursor + part) return newCursor + position - oldCursor;
      oldCursor += part;
      newCursor += part;
    } else {
      if (position < oldCursor - part) return newCursor;
      oldCursor -= part;
    }
  }
  return newCursor;
}
