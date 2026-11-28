export const permissionNames = ['read', 'write', 'delete', 'structure', 'export'];

export function databaseAccess(session) {
  const access = session?.access;
  const role = access?.role || 'owner';
  const legacy = !access;
  const permissions = Object.fromEntries(
    permissionNames.map((name) => [name, legacy || access?.permissions?.[name] === true]),
  );
  if (role === 'viewer') permissionNames.forEach((name) => (permissions[name] = false));
  if (!permissions.read)
    ['write', 'delete', 'structure', 'export'].forEach((name) => (permissions[name] = false));
  if (session?.read_only)
    ['write', 'delete', 'structure'].forEach((name) => (permissions[name] = false));
  return {
    role,
    workspaceId: access?.workspace_id,
    workspaceName: access?.workspace_name || 'Personal workspace',
    permissions,
    canRead: permissions.read && role !== 'viewer',
  };
}

export function canConfirmCommand(session, command) {
  const { permissions } = databaseAccess(session);
  const named = command.sql_operation || command.operation;
  const operation = (
    (!['read', 'write'].includes(named?.toLowerCase()) && named) ||
    command.sql?.trim().split(/\s/)[0] ||
    ''
  ).toUpperCase();
  if (['CREATE', 'ALTER', 'DROP'].includes(operation)) return permissions.structure;
  if (operation === 'DELETE') return permissions.delete;
  if (operation === 'REPLACE' || /\b(?:INSERT|UPDATE)\s+OR\s+REPLACE\b/i.test(command.sql || ''))
    return permissions.write && permissions.delete;
  if (['INSERT', 'UPDATE'].includes(operation)) return permissions.write;
  return operation === 'SELECT' && permissions.read;
}
