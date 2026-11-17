import { useEffect, useState } from 'react';

export function useDatabaseCollection(items, scope, pageSize = 2) {
  const [state, setState] = useState({ scope, query: '', page: 1 });
  const current = state.scope === scope ? state : { scope, query: '', page: 1 };
  const term = current.query.trim().toLowerCase();
  const filtered = items.filter((item) =>
    `${item.database} ${item.provider || 'sqlite'} ${item.access?.workspace_name || ''}`
      .toLowerCase()
      .includes(term),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(current.page, pages);
  useEffect(() => {
    setState((previous) =>
      previous.scope !== scope
        ? { scope, query: '', page: 1 }
        : previous.page > pages
          ? { ...previous, page: pages }
          : previous,
    );
  }, [scope, pages]);
  return {
    query: current.query,
    page,
    pages,
    total: filtered.length,
    all: items.length,
    start: filtered.length ? (page - 1) * pageSize + 1 : 0,
    end: Math.min(page * pageSize, filtered.length),
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    setQuery: (query) => setState({ scope, query, page: 1 }),
    setPage: (next) => setState({ ...current, page: Math.max(1, Math.min(pages, next)) }),
  };
}
