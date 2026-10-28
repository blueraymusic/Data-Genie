import { useState } from 'react';
import { Link } from '../lib/router';
export function TableRail({
  session,
  selected,
  setSelected,
  onNewTable,
  onNavigate,
  open,
  disabled,
}) {
  const [search, setSearch] = useState(''),
    [expanded, setExpanded] = useState(new Set([selected || session.tables[0]]));
  const tables = (session.table_details || []).filter((table) =>
    (table.name + ' ' + table.columns.map((column) => column.name).join(' '))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function toggle(name, value) {
    setExpanded((previous) => {
      if (previous.has(name) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(name);
      else next.delete(name);
      return next;
    });
  }
  return (
    <aside className={'side' + (open ? ' open' : '')} id="tableRail">
      <div className="rail-heading">
        <span>
          {session.source === 'demo'
            ? 'Sample database'
            : session.source === 'postgresql'
              ? 'PostgreSQL'
              : 'Database'}
        </span>
        <button className="text-button" onClick={() => onNavigate('connect')}>
          Change
        </button>
      </div>
      <b className="rail-database">{session.database}</b>
      <p className="rail-meta">
        <span className="dot" />
        Connected · {session.tables.length} {session.tables.length === 1 ? 'table' : 'tables'}
      </p>
      {session.source === 'postgresql' && (
        <p className="small muted">
          {session.schema_name} · {session.read_only ? 'Read-only' : 'Changes need confirmation'}
        </p>
      )}
      <label className="sr-only" htmlFor="tableSearch">
        Search tables and columns
      </label>
      <input
        id="tableSearch"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search tables and columns"
      />
      <div className="rail-heading tables-heading">
        <span>Tables</span>
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={onNewTable}
          aria-haspopup="dialog"
        >
          + New table
        </button>
      </div>
      <div>
        {tables.map((table) => (
          <details
            className={'rail-table' + (selected === table.name ? ' selected' : '')}
            key={table.name}
            open={expanded.has(table.name)}
            onToggle={(event) => toggle(table.name, event.currentTarget.open)}
          >
            <summary
              onClick={() => setSelected(table.name)}
              aria-current={selected === table.name ? 'true' : undefined}
            >
              {table.name}
              <span
                className="row-count"
                title={table.row_count_estimated ? 'Estimated row count' : 'Row count'}
              >
                {table.row_count == null
                  ? '—'
                  : (table.row_count_estimated ? '~ ' : '') + table.row_count.toLocaleString()}
              </span>
            </summary>
            <div className="rail-columns">
              {table.columns.map((column) => (
                <div className="rail-column" key={column.name}>
                  {column.primary_key && (
                    <span className="key" title="Primary key">
                      ⌑
                    </span>
                  )}
                  <span className="column-name">{column.name}</span>
                  <span className="column-type">{column.type}</span>
                </div>
              ))}
            </div>
          </details>
        ))}
        {!tables.length && (
          <p className="small muted">
            {session.tables.length ? 'No matching tables.' : 'No tables yet.'}
          </p>
        )}
      </div>
      <button className="rail-structure text-button" onClick={() => onNavigate('schema')}>
        Browse structure and relationships
      </button>
      <div className="rail-foot">
        <Link href="/faq">Questions? Read the FAQ</Link>
      </div>
    </aside>
  );
}
