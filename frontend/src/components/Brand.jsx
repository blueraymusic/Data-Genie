import { Link } from '../lib/router';
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Data Genie home">
      <svg
        className="mark"
        viewBox="0 0 32 32"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <ellipse cx="12" cy="9" rx="8" ry="3" stroke="currentColor" />
        <path
          d="M4 9v14c0 1.66 3.58 3 8 3s8-1.34 8-3V9M4 16c0 1.66 3.58 3 8 3s8-1.34 8-3"
          stroke="currentColor"
        />
        <path
          d="M21 3h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-3l-4 3V5a2 2 0 0 1 1-2Z"
          stroke="var(--brass)"
          fill="var(--chalk)"
        />
      </svg>
      Data Genie
    </Link>
  );
}
