import { useId } from 'react';
import { Icon } from './Icon';

export function DatabaseListControls({ collection }) {
  const id = useId();
  if (collection.all <= 2 && !collection.query) return null;
  return (
    <div className="database-list-controls">
      <label htmlFor={id}>Find a database</label>
      <div className="database-list-search">
        <Icon name="search" />
        <input
          id={id}
          type="search"
          placeholder="Search by name"
          value={collection.query}
          onChange={(event) => collection.setQuery(event.target.value)}
        />
      </div>
      <span role="status">
        {collection.start}–{collection.end} of {collection.total}{' '}
        {collection.total === 1 ? 'database' : 'databases'}
        {collection.query && ` · ${collection.all} total`}
      </span>
      {collection.query && (
        <button type="button" className="text-button" onClick={() => collection.setQuery('')}>
          Clear search
        </button>
      )}
    </div>
  );
}
export function DatabasePagination({ collection }) {
  if (collection.pages <= 1) return null;
  return (
    <nav className="database-pagination" aria-label="Database pages">
      <span>
        Page {collection.page} of {collection.pages}
      </span>
      <button
        type="button"
        className="btn"
        disabled={collection.page === 1}
        onClick={() => collection.setPage(collection.page - 1)}
      >
        Previous databases
      </button>
      <button
        type="button"
        className="btn"
        disabled={collection.page === collection.pages}
        onClick={() => collection.setPage(collection.page + 1)}
      >
        Next databases
      </button>
    </nav>
  );
}
