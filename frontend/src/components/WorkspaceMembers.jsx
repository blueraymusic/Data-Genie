import { useEffect, useRef, useState } from 'react';
import { permissionNames } from '../lib/access';
import { useEnterMotion } from '../hooks/useMotion';
import { PersonPicker } from './PersonPicker';

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

function DatabaseAccess({ database, grant, disabled, onSave, compact }) {
  const saved = grant?.permissions || grant;
  const signature = permissionNames.map((name) => (saved?.[name] === true ? '1' : '0')).join('');
  const [permissions, setPermissions] = useState(() =>
      Object.fromEntries(permissionNames.map((name) => [name, saved?.[name] === true])),
    ),
    [conflict, setConflict] = useState(false);
  const editing = useRef(false),
    previous = useRef(signature);
  useEffect(() => {
    if (signature === previous.current) return;
    previous.current = signature;
    if (editing.current) {
      setConflict(true);
      return;
    }
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
    editing.current = true;
    setPermissions((current) => ({
      ...current,
      [name]: value,
      ...(name === 'read' && !value ? emptyAccess() : {}),
    }));
  }
  async function save(value) {
    const result = await onSave(value);
    if (result) {
      editing.current = false;
      setConflict(false);
    }
  }
  return (
    <section
      className={'workspace-access-card' + (compact ? ' is-compact' : '')}
      aria-label={'Access to ' + database.database}
    >
      <header>
        <div>
          <h4>{database.database}</h4>
          <p className="small muted">
            {database.provider === 'postgresql' ? 'PostgreSQL' : 'SQLite'} · Permissions for this
            person
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
              if (value !== 'custom') {
                editing.current = true;
                setPermissions({
                  ...emptyAccess(),
                  read: value !== 'none',
                  write: value === 'edit',
                });
              }
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
          <label className="workspace-permission-choice" key={name} title={hints[name]}>
            <input
              type="checkbox"
              checked={permissions[name]}
              disabled={disabled || (name !== 'read' && !permissions.read)}
              aria-label={labels[name] + ' permission for ' + database.database}
              onChange={(event) => toggle(name, event.target.checked)}
            />
            <span>
              <strong>{labels[name]}</strong>
              <small className={compact ? 'sr-only' : undefined}>{hints[name]}</small>
            </span>
          </label>
        ))}
      </div>
      {conflict && (
        <p className="small workspace-permission-conflict" role="status">
          Access changed in another session. Your choices are kept; review them before saving.
        </p>
      )}
      <footer>
        {(changed || !compact) && (
          <span className="small muted">
            {changed
              ? 'Unsaved changes'
              : permissions.read
                ? 'Access is up to date'
                : 'This database is not shared with this person'}
          </span>
        )}
        {saved?.read === true && (
          <button
            className="btn quiet workspace-remove"
            disabled={disabled}
            onClick={() => save(emptyAccess())}
          >
            Revoke access
          </button>
        )}
        <button
          className="btn pri"
          disabled={disabled || !changed}
          onClick={() => save(permissions)}
        >
          Save access
        </button>
      </footer>
    </section>
  );
}

function PersonAccess({ member, details, disabled, onAction, panel = 'all' }) {
  const surface = useRef(null);
  useEnterMotion(surface, member.account_id);
  const [role, setRole] = useState(member.role);
  const [databaseId, setDatabaseId] = useState('');
  useEffect(() => setRole(member.role), [member.role]);
  useEffect(() => {
    setDatabaseId((current) =>
      (details.databases || []).some((database) => String(database.database_id) === current)
        ? current
        : String(details.databases?.[0]?.database_id || ''),
    );
  }, [details.databases]);
  const owner = member.role === 'owner';
  return (
    <section
      ref={surface}
      className={'workspace-person-detail' + (owner ? ' is-owner' : '')}
      aria-label={'Access for ' + member.email}
    >
      <header className="workspace-person-heading">
        <div>
          <h3>
            {member.first_name} {member.last_name}
          </h3>
          <p className="small muted">{member.email}</p>
        </div>
        <span className="workspace-role">
          {owner ? 'Owner' : member.role === 'viewer' ? 'Viewer' : 'Member'}
        </span>
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
          <div hidden={panel === 'access'}>
            <div className="workspace-member-role">
              {panel === 'all' && (
                <div className="workspace-access-step">
                  <span aria-hidden="true">1</span>
                  <div>
                    <h4>Workspace role</h4>
                    <p>Choose how this person takes part.</p>
                  </div>
                </div>
              )}
              <label>
                Role
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
                  onAction(
                    'members',
                    { account_id: member.account_id, role },
                    'Member role updated.',
                  )
                }
              >
                Save role
              </button>
            </div>
            <p className="small muted workspace-role-hint">
              {role === 'viewer'
                ? 'Viewers can read reports shared by the owner. They cannot open databases.'
                : 'Members can open the databases you share in Database access. Row and table changes still require confirmation.'}
            </p>
            {role !== member.role && (
              <p className="small workspace-role-pending" role="status">
                Save the role to apply this change.
              </p>
            )}
          </div>
          {member.role === 'viewer' && panel === 'access' && (
            <p className="muted">
              Viewers read shared reports only. Change their workspace role to grant database
              access.
            </p>
          )}
          {member.role === 'member' && (
            <div className="workspace-member-databases" hidden={panel === 'role'}>
              {panel === 'all' && (
                <div className="workspace-access-step">
                  <span aria-hidden="true">2</span>
                  <div>
                    <h4>Database access</h4>
                    <p>Grant only the actions this person needs.</p>
                  </div>
                </div>
              )}
              {!(details.databases || []).length ? (
                <p className="small muted">Add a database to set its permissions.</p>
              ) : (
                <>
                  {details.databases.length > 1 && (
                    <label className="workspace-database-selector">
                      Database
                      <select
                        value={databaseId || String(details.databases[0].database_id)}
                        onChange={(event) => setDatabaseId(event.target.value)}
                      >
                        {details.databases.map((database) => (
                          <option key={database.database_id} value={database.database_id}>
                            {database.database}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {details.databases.map((database) => (
                    <div
                      key={database.database_id}
                      hidden={
                        String(database.database_id) !==
                        (databaseId || String(details.databases[0].database_id))
                      }
                    >
                      <DatabaseAccess
                        database={database}
                        compact={panel !== 'all'}
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
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          <div className="workspace-remove-member" hidden={panel === 'access'}>
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

export function WorkspaceMembers({ details, disabled, onAction, panel = 'all' }) {
  const members = details.members || [];
  const visited = useRef(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [account, setAccount] = useState(() =>
    String((members.find((member) => member.role === 'member') || members[0])?.account_id || ''),
  );
  useEffect(() => {
    if (members.some((member) => String(member.account_id) === account)) return;
    setAccount(
      String((members.find((member) => member.role === 'member') || members[0])?.account_id || ''),
    );
  }, [members, account]);
  const selected =
    members.find((member) => String(member.account_id) === account) ||
    members.find((member) => member.role === 'member') ||
    members[0];
  if (selected) visited.current.add(String(selected.account_id));
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
          <div className="workspace-person-picker" role="group" aria-label="Workspace members">
            <PersonPicker
              members={members}
              selected={selected}
              disabled={disabled}
              onSelect={setAccount}
              onOpenChange={setPickerOpen}
            />
            {panel === 'all' && (
              <p className="small muted">
                {members.length} {members.length === 1 ? 'person' : 'people'} · Select a name to
                manage access. Your unsaved choices stay here when you switch.
              </p>
            )}
          </div>
          <div className="workspace-person-panels" hidden={pickerOpen}>
            {members
              .filter((member) => visited.current.has(String(member.account_id)))
              .map((member) => (
                <div
                  key={member.account_id}
                  hidden={String(member.account_id) !== String(selected.account_id)}
                >
                  <PersonAccess
                    member={member}
                    panel={panel}
                    details={details}
                    disabled={disabled}
                    onAction={onAction}
                  />
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
