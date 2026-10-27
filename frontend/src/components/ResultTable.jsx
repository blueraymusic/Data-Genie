import { useState } from 'react';
import { exportRows, sortedRows } from '../lib/resultData';

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
export function ResultTable({
  rows = [],
  truncated = false,
  home = false,
  onLoadMore,
  loadingMore = false,
  onUseSuggestion,
  recovery = [],
  filename = 'data-genie-results',
  compactTools = false,
}) {
  const [sort, setSort] = useState(null),
    [message, setMessage] = useState('');
  const displayRows = sortedRows(rows, sort);
  async function copy() {
    try {
      await navigator.clipboard.writeText(exportRows(displayRows, 'tsv'));
      setMessage('Copied shown rows.');
    } catch {
      setMessage('Copy is unavailable. Download the CSV instead.');
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + exportRows(displayRows)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/[^a-z0-9_-]/gi, '-') + '.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('CSV downloaded with shown rows.');
  }
  if (!rows.length)
    return (
      <div className="empty-result">
        <p className="muted">No rows match this request. Try a broader filter.</p>
        {onUseSuggestion && recovery.length > 0 && (
          <div className="clarification-suggestions">
            {recovery.map((choice) => (
              <button key={choice.request} onClick={() => onUseSuggestion(choice.request)}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  const columns = Object.keys(rows[0]);
  return (
    <>
      {!home && (
        <div className={'result-tools' + (compactTools ? ' compact-tools' : '')}>
          {!compactTools && (
            <span>
              {rows.length} {rows.length === 1 ? 'row' : 'rows'}
              {truncated ? ' shown' : ''}
            </span>
          )}
          <div>
            <button type="button" className="text-button" onClick={copy}>
              Copy results
            </button>
            <button type="button" className="text-button" onClick={download}>
              Download CSV
            </button>
          </div>
        </div>
      )}
      <div
        className={home ? 'tablewrap' : 'tw'}
        tabIndex="0"
        role="region"
        aria-label="Result table, scroll to see more columns"
      >
        <table className={home ? 'rt' : undefined}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  scope="col"
                  key={column}
                  aria-sort={
                    !home && sort?.column === column
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {home ? (
                    column
                  ) : (
                    <button
                      className="sort-column"
                      type="button"
                      title={'Sort shown rows by ' + column}
                      onClick={() =>
                        setSort({
                          column,
                          direction:
                            sort?.column === column && sort.direction === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {column.replaceAll('_', ' ')}
                      <span aria-hidden="true">
                        {sort?.column === column ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, index) => (
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
      {home && (
        <p className="count">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          {truncated ? ' shown' : ''}
        </p>
      )}
      {!home && (
        <p className="result-action-status" role="status">
          {message || (sort ? 'Sorting shown rows. Copy and CSV use this order.' : '')}
        </p>
      )}
      {truncated &&
        (onLoadMore ? (
          <button
            className="btn show-more"
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Loading more…' : 'Show more'}
          </button>
        ) : (
          <p className="notice">
            More rows are available. Open this result in its active workspace to load more.
          </p>
        ))}
    </>
  );
}
