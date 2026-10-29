export function Icon({ name, className = 'ic', ...props }) {
  const paths = {
    sun: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
    plus: 'M12 5v14M5 12h14',
    check: 'm5 12 4 4L19 6',
    x: 'm6 6 12 12M6 18 18 6',
    copy: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    clock: 'M12 7v5l3 2',
    replay: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    search: 'm16 16 4 4',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4h8v2',
    database: 'M4 6v12c0 2 16 2 16 0V6M4 12c0 2 16 2 16 0',
    table: 'M3 9h18M9 9v12',
    upload: 'M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5',
    layers: 'm3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    send: 'M12 19V5m-6 6 6-6 6 6',
    workspace: 'M8 3v18M8 9h13',
    account: 'M5 21v-2a7 7 0 0 1 14 0v2',
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {name === 'sun' && <circle cx="12" cy="12" r="4" />}
      {['clock'].includes(name) && <circle cx="12" cy="12" r="9" />}
      {name === 'search' && <circle cx="10.5" cy="10.5" r="6.5" />}
      {name === 'copy' && <rect x="9" y="9" width="12" height="12" rx="2" />}
      {name === 'database' && <ellipse cx="12" cy="6" rx="8" ry="3" />}
      {['table', 'workspace'].includes(name) && <rect x="3" y="3" width="18" height="18" rx="2" />}
      {name === 'account' && <circle cx="12" cy="7" r="4" />}
      <path d={paths[name] || paths.search} />
    </svg>
  );
}
