import { Link } from '../lib/router';
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Data Genie home">
      <img className="mark" src="/favicon.svg" width="32" height="32" alt="" />
      Data Genie
    </Link>
  );
}
