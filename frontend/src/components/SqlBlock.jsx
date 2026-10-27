import { useState } from 'react';
import { Icon } from './Icon';
const tokens =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|\b\d+(?:\.\d+)?\b|\b(?:SELECT|FROM|WHERE|GROUP|BY|ORDER|JOIN|LEFT|INNER|ON|AS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|DROP|TABLE|CREATE|ALTER|ADD|COLUMN|AVG|SUM|COUNT|MIN|MAX|ROUND|DESC|ASC|LIMIT|IS|NULL|NOT|PRIMARY|KEY|INTEGER|TEXT|REAL|AND|OR)\b/gi;
export function SqlCode({ sql = '' }) {
  const chunks = [];
  let offset = 0;
  for (const match of sql.matchAll(tokens)) {
    chunks.push(sql.slice(offset, match.index));
    const value = match[0],
      kind = value[0] === "'" ? 's' : value[0] === '"' ? '' : /^\d/.test(value) ? 'n' : 'k';
    chunks.push(
      <span className={kind || undefined} key={match.index}>
        {value}
      </span>,
    );
    offset = match.index + value.length;
  }
  chunks.push(sql.slice(offset));
  return <code>{chunks}</code>;
}
export function SqlBlock({ sql = '', operation = 'SELECT', home = false, declined = false }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setError('');
    } catch {
      setError('Copy unavailable. Select the SQL to copy it.');
    }
  }
  return (
    <div className={'sqlblock' + (declined ? ' declined-sql' : '')}>
      <div className="sqlhead">
        <span className={(home ? 'chip op ' : 'tag ') + 'op-' + operation.toLowerCase()}>
          {operation}
        </span>
        <button
          className={home ? 'copy' : 'copy-sql'}
          type="button"
          onClick={copy}
          onBlur={() => setCopied(false)}
          aria-label={copied ? 'Copied' : 'Copy SQL'}
        >
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
      </div>
      <pre>
        <SqlCode sql={sql} />
      </pre>
      {error && (
        <p className="small err" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
