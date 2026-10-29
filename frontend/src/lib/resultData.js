function numericParts(value) {
  if (!['number', 'string'].includes(typeof value)) return null;
  const match = String(value).match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const digits = (match[2] + (match[3] || '')).replace(/^0+/, '') || '0';
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!Number.isSafeInteger(exponent + digits.length)) return null;
  return {
    sign: digits === '0' ? 0 : match[1] === '-' ? -1 : 1,
    digits,
    magnitude: digits.length + exponent,
  };
}

function compareNumbers(left, right) {
  const a = numericParts(left),
    b = numericParts(right);
  if (!a || !b) return null;
  if (a.sign !== b.sign) return a.sign - b.sign;
  if (a.sign === 0) return 0;
  if (a.magnitude !== b.magnitude) return (a.magnitude - b.magnitude) * a.sign;
  const width = Math.max(a.digits.length, b.digits.length);
  const x = a.digits.padEnd(width, '0'),
    y = b.digits.padEnd(width, '0');
  return (x === y ? 0 : x < y ? -1 : 1) * a.sign;
}

export function isNumeric(value) {
  return numericParts(value) !== null;
}

export function chartNumber(value) {
  const parts = numericParts(value),
    number = Number(value);
  return parts &&
    Number.isFinite(number) &&
    Math.abs(number) <= Number.MAX_SAFE_INTEGER &&
    (number !== 0 || parts.sign === 0)
    ? number
    : null;
}

export function sortedRows(rows, sort) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const left = a[sort.column],
      right = b[sort.column];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const compared =
      compareNumbers(left, right) ??
      String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    return sort.direction === 'asc' ? compared : -compared;
  });
}

const textValue = (value) =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function exportRows(rows, format = 'csv') {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const cell = (value) => {
    let text = textValue(value);
    // Spreadsheet programs must treat database strings as text, never formulas.
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    if (format === 'tsv')
      return text.replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(cell).join(format === 'tsv' ? '\t' : ','))
    .join('\r\n');
}

export function resultHeadline(command, rows, hasMore) {
  if (command.result_heading) return command.result_heading;
  const tables = [
    ...new Set(
      (command.targets || [])
        .filter((target) => target.access_type === 'read')
        .map((target) => target.table_name),
    ),
  ];
  const noun =
    tables.length === 1 ? tables[0].replaceAll('_', ' ') : rows.length === 1 ? 'record' : 'records';
  return hasMore
    ? `${rows.length} ${noun} shown`
    : rows.length === 1 && tables.length === 1
      ? `1 record found in ${noun}`
      : rows.length
        ? `${rows.length} ${noun} found`
        : 'No matching records';
}
