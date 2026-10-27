export function Cell({ value }) {
  if (value === null) return <span className="null">NULL</span>;
  if (value && typeof value === 'object' && value.type === 'blob') {
    const data = value.base64 || value.data || '';
    const size =
      value.size ??
      Math.max(0, Math.floor((data.length * 3) / 4) - (data.match(/=+$/)?.[0].length || 0));
    return <span className="mono">[BLOB: {size} bytes]</span>;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
}
export function ResultTable({ rows = [], truncated = false, home = false }) {
  if (!rows.length)
    return <p className="muted">No rows match. Try a broader request or check the filter.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <>
      <div className={home ? 'tablewrap' : 'tw'}>
        <table className={home ? 'rt' : undefined}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} className={typeof row[column] === 'number' ? 'num' : undefined}>
                    <Cell value={row[column]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={home ? 'count' : 'result-meta'}>
        {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        {truncated ? ' shown' : ''}
      </p>
      {truncated && (
        <p className="notice">
          Result limited to 500 rows. More rows exist; add a filter or LIMIT/OFFSET to inspect them.
        </p>
      )}
    </>
  );
}
