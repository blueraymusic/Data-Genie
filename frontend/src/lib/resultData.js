export function sortedRows(rows, sort) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const left = a[sort.column],
      right = b[sort.column];
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, {
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
