import { useEffect, useState } from 'react';
import { permissionNames } from '../lib/access';

const labels = {
  read: 'Read',
  write: 'Edit rows',
  delete: 'Delete rows',
  structure: 'Change tables',
  export: 'Export',
};
const hints = {
  read: 'View rows and ask questions',
  write: 'Insert and update rows',
  delete: 'Remove rows',
  structure: 'Create, change, or remove tables',
  export: 'Download database data',
};
const emptyAccess = () => Object.fromEntries(permissionNames.map((name) => [name, false]));

function DatabaseAccess({ database, grant, disabled, onSave }) {
  const saved = grant?.permissions || grant;
  const signature = permissionNames.map((name) => (saved?.[name] === true ? '1' : '0')).join('');
  const [permissions, setPermissions] = useState(() =>
    Object.fromEntries(permissionNames.map((name) => [name, saved?.[name] === true])),
  );
  useEffect(() => {
    setPermissions(
      Object.fromEntries(permissionNames.map((name, index) => [name, signature[index] === '1'])),
    );
  }, [signature]);
  const changed = permissionNames.some(
    (name, index) => permissions[name] !== (signature[index] === '1'),
  );
  const preset = !permissions.read
    ? 'none'
    : !permissions.delete && !permissions.structure && !permissions.export
      ? permissions.write
        ? 'edit'
        : 'read'
      : 'custom';
  function toggle(name, value) {
    setPermissions((current) => ({
      ...current,
      [name]: value,
      ...(name === 'read' && !value ? emptyAccess() : {}),
    }));
  }
  return (
    <section className="workspace-access-card" aria-label={'Access to ' + database.database}>
      <header>
        <div>
          <h4>{database.database}</h4>
          <p className="small muted">
            {database.provider === 'postgresql' ? 'PostgreSQL' : 'SQLite'}
          </p>
        </div>
        <label className="workspace-access-preset">
          Access level
          <select
            aria-label={'Access level for ' + database.database}
            value={preset}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== 'custom')
                setPermissions({
                  ...emptyAccess(),
                  read: value !== 'none',
                  write: value === 'edit',
                });
            }}
          >
            <option value="none">No access</option>
            <option value="read">Read only</option>
            <option value="edit">Read &amp; edit rows</option>
            <option value="custom" disabled>
              Custom
            </option>
          </select>
        </label>
      </header>
      <div className="workspace-permission-options">
        {permissionNames.map((name) => (
          <label className="workspace-permission-choice" key={name}>
            <input
              type="checkbox"
              checked={permissions[name]}
              disabled={disabled || (name !== 'read' && !permissions.read)}
              aria-label={labels[name] + ' permission for ' + database.database}
              onChange={(event) => toggle(name, event.target.checked)}
            />
            <span>
              <strong>{labels[name]}</strong>
              <small>{hints[name]}</small>
            </span>
          </label>
        ))}
      </div>
      <footer>
        <span className="small muted">
          {changed
            ? 'Unsaved changes'
            : permissions.read
              ? 'Access is up to date'
              : 'This database is not shared with this person'}
        </span>
        <button className="btn" disabled={disabled || !changed} onClick={() => onSave(permissions)}>
          Save access
        </button>
      </footer>
    </section>
  );
}

function PersonAccess({ member, details, disabled, onAction }) {
  const [role, setRole] = useState(member.role);
  useEffect(() => setRole(member.role), [member.role]);
  const owner = member.role === 'owner';
  return (
    <section className="workspace-person-detail" aria-label={'Access for ' + member.email}>
      <header className="workspace-person-heading">
        <div>
          <h3>
            {member.first_name} {member.last_name}
          </h3>
          <p className="small muted">{member.email}</p>
        </div>
        {owner && <span className="workspace-role">Owner</span>}
      </header>
      {owner ? (
        <div className="workspace-access-explanation">
          <h4>Full workspace access</h4>
          <p className="small muted">
            Owners manage every database, invitation, and member. The owner’s access cannot be
            changed here.
          </p>
        </div>
      ) : (
        <>
          <div className="workspace-member-role">
            <label>
              Workspace role
              <select
                aria-label={'Role for ' + member.email}
                value={role}
                disabled={disabled}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button
              className="btn"
              disabled={disabled || role === member.role}
              onClick={() =>
                onAction('members', { account_id: member.account_id, role }, 'Member role updated.')
              }
            >
              Save role
            </button>
          </div>
          <p className="small muted workspace-role-hint">
            {member.role === 'viewer'
              ? 'Viewers are reserved for future shared reports. They cannot open databases.'
              : 'Members can open only the databases you share below. Row and table changes still require confirmation.'}
          </p>
          {member.role === 'member' && (
            <div className="workspace-member-databases">
              <h4>Database access</h4>
              {!(details.databases || []).length ? (
                <p className="small muted">Add a database to set its permissions.</p>
              ) : (
                details.databases.map((database) => (
                  <DatabaseAccess
                    key={database.database_id}
                    database={database}
                    disabled={disabled}
                    grant={(details.grants || []).find(
                      (grant) =>
                        String(grant.account_id) === String(member.account_id) &&
                        String(grant.database_id) === String(database.database_id),
                    )}
                    onSave={(permissions) =>
                      onAction(
                        'grants',
                        {
                          account_id: member.account_id,
                          database_id: database.database_id,
                          permissions,
                        },
                        'Database access updated.',
                      )
                    }
                  />
                ))
              )}
            </div>
          )}
          <div className="workspace-remove-member">
            <p className="small muted">Removing this person ends their access to this workspace.</p>
            <button
              className="text-button workspace-remove"
              disabled={disabled}
              onClick={() =>
                onAction(
                  'remove',
                  { account_id: member.account_id },
                  'Member removed from this workspace.',
                )
              }
            >
              Remove from workspace
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function WorkspaceMembers({ details, disabled, onAction }) {
  const members = details.members || [];
  const [account, setAccount] = useState(() =>
    String((members.find((member) => member.role === 'member') || members[0])?.account_id || ''),
  );
  const selected =
    members.find((member) => String(member.account_id) === account) ||
    members.find((member) => member.role === 'member') ||
    members[0];
  return (
    <section className="workspace-section" aria-labelledby="workspaceMembersTitle">
      <header className="workspace-section-heading">
        <div>
          <h2 id="workspaceMembersTitle">People</h2>
          <p className="small muted">Choose a person to manage their role and database access.</p>
        </div>
      </header>
      {!members.length ? (
        <p className="muted">Invite a teammate to get started.</p>
      ) : (
        <div className="workspace-people-layout">
          <div className="workspace-person-list" role="group" aria-label="Workspace members">
            {members.map((member) => (
              <button
                key={member.account_id}
                className="workspace-person-button"
                aria-pressed={selected.account_id === member.account_id}
                disabled={disabled}
                onClick={() => setAccount(String(member.account_id))}
              >
                <span className="workspace-avatar" aria-hidden="true">
                  {(member.first_name?.[0] || member.email?.[0] || '?').toUpperCase()}
                  {member.last_name?.[0]?.toUpperCase()}
                </span>
                <span>
                  <strong>
                    {member.first_name} {member.last_name}
                  </strong>
                  <small>{member.email}</small>
                  <span className="workspace-person-role">{member.role}</span>
                </span>
              </button>
            ))}
          </div>
          <PersonAccess
            key={selected.account_id}
            member={selected}
            details={details}
            disabled={disabled}
            onAction={onAction}
          />
        </div>
      )}
    </section>
  );
}
