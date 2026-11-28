import { databaseAccess } from '../lib/access';
import { Link } from '../lib/router';

export function DatabaseAccess({ session }) {
  const { role, workspaceName, permissions } = databaseAccess(session);
  const allowed = [
    ['read', 'read'],
    ['write', 'edit rows'],
    ['delete', 'delete rows'],
    ['structure', 'change tables'],
    ['export', 'export'],
  ]
    .filter(([permission]) => permissions[permission])
    .map(([, label]) => label);
  const summary = Object.values(permissions).every(Boolean)
    ? 'Full database access'
    : !permissions.read
      ? 'No database access'
      : !permissions.write && !permissions.delete && !permissions.structure
        ? 'Read-only access'
        : 'Custom database access';
  return (
    <div className="database-access" aria-label="Workspace and database permissions">
      <p>
        <Link href="/workspaces">{workspaceName}</Link> <span>· {role}</span>
      </p>
      <p title={allowed.length ? 'Can ' + allowed.join(', ') + '.' : undefined}>{summary}</p>
    </div>
  );
}
