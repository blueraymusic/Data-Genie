import { useEffect, useRef, useState } from 'react';
import { DatabaseForm } from '../components/DatabaseForm';
import { Icon } from '../components/Icon';
import { WorkspaceDialog } from '../components/WorkspaceDialog';
import { WorkspaceMembers } from '../components/WorkspaceMembers';
import { WorkspaceInvitations, WorkspaceInviteManager } from '../components/WorkspaceInvitations';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { api } from '../lib/api';
import { forgetWorkspaceInvitation } from '../lib/workspaceInvites';

const permissionLabels = {
  read: 'Read',
  write: 'Edit rows',
  delete: 'Delete rows',
  structure: 'Change tables',
  export: 'Export',
};

export default function WorkspacesPage({ workbench, onOpened }) {
  const sectionTabs = useRef(null);
  const teams = useWorkspaces(workbench.session?.access?.workspace_id),
    { details } = teams,
    workspace = details?.workspace,
    owner = workspace?.role === 'owner',
    viewer = workspace?.role === 'viewer';
  const [name, setName] = useState(''),
    [deleteName, setDeleteName] = useState(''),
    [tab, setTab] = useState('databases'),
    [modal, setModal] = useState(null),
    [invitationDraft, setInvitationDraft] = useState({ email: '', role: 'member', link: null }),
    [personalDatabases, setPersonalDatabases] = useState([]),
    [attachId, setAttachId] = useState(''),
    [opening, setOpening] = useState(null);
  const pending = Boolean(workbench.pending || workbench.busy || workbench.workingCommands?.size),
    disabled = pending || teams.busy || opening !== null,
    base = '/api/workspaces/' + encodeURIComponent(teams.selected),
    personalId = teams.workspaces.find((item) => item.personal)?.workspace_id;
  const databases = (details?.databases || []).filter(
    (database) => owner || database.permissions?.read === true,
  );
  const focusSection = useRef(false);
  useEffect(() => {
    if (!focusSection.current) return;
    focusSection.current = false;
    sectionTabs.current?.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  }, [tab]);
  function selectTab(next) {
    focusSection.current = true;
    setTab(next);
    if (!window.matchMedia?.('(max-width: 780px)')?.matches) return;
    window.requestAnimationFrame(() => {
      sectionTabs.current?.scrollIntoView?.({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    });
  }
  useEffect(() => {
    setInvitationDraft({ email: '', role: 'member', link: null });
    setAttachId('');
    setDeleteName('');
    setTab('databases');
    setModal(null);
  }, [teams.selected]);
  useEffect(() => {
    if (!owner || workspace.personal || !personalId) {
      setPersonalDatabases([]);
      return;
    }
    const controller = new AbortController();
    api('/api/workspaces/' + encodeURIComponent(personalId), { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setPersonalDatabases(data.databases || []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPersonalDatabases([]);
      });
    return () => controller.abort();
  }, [owner, workspace?.workspace_id, workspace?.personal, personalId, details]);
  async function action(path, body, success) {
    if (disabled) return null;
    return teams.act(base + '/' + path, body, success);
  }
  async function create(event) {
    event.preventDefault();
    if (disabled || !name.trim()) return;
    const result = await teams.act('/api/workspaces', { name: name.trim() }, 'Workspace created.');
    if (result?.workspace_id) {
      teams.select(result.workspace_id);
      setName('');
      setModal(null);
    }
  }
  async function accept(invitation, token) {
    if (disabled) return;
    if (!token) {
      teams.setError('Paste the private link or code provided by the workspace owner.');
      return;
    }
    const result = await teams.act(
      '/api/workspaces/invitations/accept',
      { invitation_id: invitation.invitation_id, token },
      'You joined the workspace.',
    );
    if (result?.workspace_id) {
      forgetWorkspaceInvitation(invitation.invitation_id);
      teams.select(result.workspace_id);
    }
  }
  async function deleteWorkspace(event) {
    event.preventDefault();
    if (disabled || !owner || workspace.personal || deleteName !== workspace.name) return;
    const result = await action('delete', { name: deleteName }, 'Workspace deleted.');
    if (result?.deleted) {
      teams.select(result.personal_workspace_id || personalId || '');
      teams.setMessage('Workspace deleted. Its databases are in your personal workspace.');
      setModal(null);
      workbench.refresh?.();
    }
  }
  async function open(database) {
    if (disabled) return;
    setOpening(database.database_id);
    teams.setError('');
    try {
      const data = await workbench.openShared(teams.selected, database.database_id);
      onOpened?.(data);
    } catch (error) {
      teams.setError(error.message);
    } finally {
      setOpening(null);
    }
  }
  const selectedItem = teams.workspaces.find((item) => item.workspace_id === teams.selected);
  const currentName = workspace?.name || selectedItem?.name;
  return (
    <section className="workspaces-page">
      <header className="page-heading workspace-page-heading">
        <div>
          <h1>Your workspaces</h1>
          <p className="lead">A place for your databases. A shared space for your team.</p>
        </div>
        <button
          className="btn pri"
          disabled={disabled || teams.loading}
          onClick={() => {
            teams.setError('');
            setModal('create');
          }}
        >
          <Icon name="plus" />
          New workspace
        </button>
      </header>
      {pending && (
        <p className="workspace-pending-note" role="status">
          Finish the current request or confirm or decline its pending changes before switching
          workspaces.
        </p>
      )}
      {teams.error && !modal && (
        <p className="err workspace-feedback" role="alert">
          {teams.error}
        </p>
      )}
      {teams.message && (
        <p className="workspace-feedback" role="status">
          <Icon name="check" />
          {teams.message}
        </p>
      )}
      <WorkspaceInvitations
        invitations={teams.invitations}
        loading={teams.loading}
        disabled={disabled}
        onAccept={accept}
      />
      <div className="workspace-layout">
        <div className="workspace-mobile-switcher">
          <label>
            Select workspace
            <select
              value={teams.selected}
              disabled={disabled || teams.loading || !teams.workspaces.length}
              onChange={(event) => teams.select(event.target.value)}
            >
              {!teams.workspaces.length && (
                <option value="">
                  {teams.loading ? 'Loading workspaces…' : 'No workspaces yet'}
                </option>
              )}
              {[
                ['Personal', true],
                ['Teams', false],
              ].map(([label, personal]) => (
                <optgroup label={label} key={label}>
                  {teams.workspaces
                    .filter((item) => Boolean(item.personal) === personal)
                    .map((item) => (
                      <option value={item.workspace_id} key={item.workspace_id}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            className="btn quiet"
            aria-label="Refresh workspace list"
            disabled={disabled || teams.loading || teams.detailsLoading}
            onClick={teams.refresh}
          >
            <Icon name="replay" />
          </button>
        </div>
        <aside className="workspace-rail" aria-label="Choose a workspace">
          <div className="workspace-rail-heading">
            <span>WORKSPACES</span>
            <button
              className="text-button"
              disabled={disabled || teams.loading || teams.detailsLoading}
              onClick={teams.refresh}
              aria-label="Refresh workspaces"
            >
              <Icon name="replay" />
            </button>
          </div>
          <nav aria-label="Workspaces">
            {[
              ['Personal', true],
              ['Teams', false],
            ].map(([label, personal]) => (
              <div className="workspace-rail-group" key={label}>
                <h2>{label}</h2>
                {teams.workspaces
                  .filter((item) => Boolean(item.personal) === personal)
                  .map((item) => (
                    <button
                      key={item.workspace_id}
                      className="workspace-rail-item"
                      aria-current={teams.selected === item.workspace_id ? 'page' : undefined}
                      disabled={disabled || teams.loading}
                      onClick={() => teams.select(item.workspace_id)}
                    >
                      <span className="workspace-rail-icon">
                        <Icon name={personal ? 'account' : 'layers'} />
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {personal
                            ? 'Only you'
                            : item.role === 'owner'
                              ? 'You manage this team'
                              : item.role === 'viewer'
                                ? 'Viewer'
                                : 'Member'}
                        </small>
                      </span>
                    </button>
                  ))}
                {!personal &&
                  !teams.loading &&
                  !teams.workspaces.some((item) => !item.personal) && (
                    <p className="workspace-rail-empty">Create a workspace to work together.</p>
                  )}
              </div>
            ))}
          </nav>
        </aside>
        <div className="workspace-main">
          {currentName && (
            <header className="workspace-selected-heading">
              <div>
                <p className="workspace-eyebrow">
                  {(workspace || selectedItem).personal ? 'PERSONAL WORKSPACE' : 'TEAM WORKSPACE'}
                </p>
                <h2>{currentName}</h2>
                <p className="muted">
                  {workspace?.personal
                    ? 'Your databases, just for you.'
                    : owner
                      ? 'Manage your shared databases and the people who use them.'
                      : viewer
                        ? 'Reports shared with you will appear in this workspace.'
                        : 'Databases your team has shared with you.'}
                </p>
              </div>
              {workspace && (
                <div
                  className={
                    'workspace-header-actions' +
                    (owner && !workspace.personal ? ' workspace-team-actions' : '')
                  }
                >
                  <span className="workspace-role">{workspace.role}</span>
                  {owner && !workspace.personal && tab === 'databases' && (
                    <button
                      className={'btn' + (tab === 'databases' ? ' pri' : '')}
                      aria-label="Manage people and access"
                      onClick={() => selectTab('people')}
                    >
                      <Icon name="account" />
                      People &amp; access
                    </button>
                  )}
                </div>
              )}
            </header>
          )}
          {(teams.loading || teams.detailsLoading) && (
            <p className="workspace-loading muted" role="status">
              Loading workspace…
            </p>
          )}
          {workspace && !teams.detailsLoading && (
            <>
              <nav
                ref={sectionTabs}
                className="workspace-section-tabs"
                aria-label="Workspace sections"
              >
                <button
                  aria-current={tab === 'databases' ? 'page' : undefined}
                  onClick={() => selectTab('databases')}
                >
                  {viewer ? 'Shared reports' : 'Databases'}
                  {!viewer && <span>{databases.length}</span>}
                  <small>{viewer ? 'Reports shared with you' : 'Open & manage databases'}</small>
                </button>
                {owner && !workspace.personal && (
                  <button
                    aria-current={tab === 'people' ? 'page' : undefined}
                    onClick={() => selectTab('people')}
                  >
                    People &amp; access<span>{(details.members || []).length}</span>
                    <small>
                      Invite teammates &amp; set permissions
                      {details.invitations?.length
                        ? ' · ' + details.invitations.length + ' pending'
                        : ''}
                    </small>
                  </button>
                )}
              </nav>
              {viewer ? (
                <section className="workspace-empty-state workspace-viewer-state">
                  <span className="workspace-empty-icon">
                    <Icon name="layers" />
                  </span>
                  <h3>Shared reports</h3>
                  <p>Reports shared with you will appear here. Report sharing is coming later.</p>
                  <p className="small muted">
                    Viewers do not have access to database rows, conversations, SQL, or structure.
                  </p>
                </section>
              ) : tab === 'databases' ? (
                <section className="workspace-section" aria-labelledby="workspaceDatabasesTitle">
                  <header className="workspace-section-heading">
                    <div>
                      <h2 id="workspaceDatabasesTitle">Databases</h2>
                      <p className="small muted">
                        {owner
                          ? 'Open a database to start working.'
                          : 'Your access is set by a workspace owner.'}
                      </p>
                    </div>
                    {owner && (
                      <button
                        className="btn pri"
                        disabled={disabled}
                        onClick={() => {
                          teams.setError('');
                          setModal('database');
                        }}
                      >
                        <Icon name="plus" />
                        Add a database
                      </button>
                    )}
                  </header>
                  {!databases.length ? (
                    <div className="workspace-empty-state">
                      <span className="workspace-empty-icon">
                        <Icon name="database" />
                      </span>
                      <h3>{owner ? 'Your first database goes here' : 'Nothing shared yet'}</h3>
                      <p className="muted">
                        {owner
                          ? 'Create a database, upload a SQLite file, or connect PostgreSQL.'
                          : 'No databases have been shared with you yet. Ask an owner for read access.'}
                      </p>
                    </div>
                  ) : (
                    <div className="workspace-database-list">
                      {databases.map((database) => {
                        const current =
                          workbench.session?.database_id != null &&
                          String(workbench.session.database_id) === String(database.database_id) &&
                          workbench.session.access?.workspace_id === teams.selected;
                        return (
                          <article className="workspace-database-row" key={database.database_id}>
                            <span className="workspace-database-icon">
                              <Icon name="database" />
                            </span>
                            <div>
                              <h3>
                                {database.database}
                                {current && <span className="workspace-current">Current</span>}
                              </h3>
                              <p className="small muted">
                                {database.provider === 'postgresql' ? 'PostgreSQL' : 'SQLite'}
                                <span className="workspace-meta-dot">·</span>
                                {owner
                                  ? 'Full access'
                                  : Object.entries(database.permissions || {})
                                      .filter(([, enabled]) => enabled === true)
                                      .map(([key]) => permissionLabels[key])
                                      .filter(Boolean)
                                      .join(' · ') || 'No database access'}
                              </p>
                            </div>
                            <button
                              className="btn"
                              disabled={disabled || database.permissions?.read !== true}
                              onClick={() =>
                                current ? onOpened?.(workbench.session) : open(database)
                              }
                            >
                              {opening === database.database_id
                                ? 'Opening…'
                                : current
                                  ? 'Continue working'
                                  : 'Open database'}
                              <Icon name="arrow" />
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {owner && !workspace.personal && (
                    <p className="workspace-section-note small muted">
                      Database access is set for each person in{' '}
                      <button className="text-button" onClick={() => selectTab('people')}>
                        People &amp; access
                      </button>
                      .
                    </p>
                  )}
                </section>
              ) : (
                <div className="workspace-people-tab">
                  <WorkspaceInviteManager
                    draft={invitationDraft}
                    setDraft={setInvitationDraft}
                    invitations={details.invitations || []}
                    disabled={disabled}
                    onAction={action}
                    onError={teams.setError}
                    onMessage={teams.setMessage}
                  />
                  <WorkspaceMembers details={details} disabled={disabled} onAction={action} />
                </div>
              )}
              {owner && !workspace.personal && (
                <footer className="workspace-settings">
                  <p className="small muted">Workspace settings</p>
                  <button
                    className="text-button workspace-remove"
                    disabled={disabled}
                    onClick={() => {
                      teams.setError('');
                      setDeleteName('');
                      setModal('delete');
                    }}
                  >
                    Delete workspace
                  </button>
                </footer>
              )}
            </>
          )}
          {!teams.loading && !teams.detailsLoading && !currentName && (
            <div className="workspace-empty-state">
              <h2>A space to start</h2>
              <p className="muted">Create a workspace to keep your team’s databases together.</p>
            </div>
          )}
        </div>
      </div>
      {modal === 'create' && (
        <WorkspaceDialog
          title="Create a workspace"
          description="Bring your team and its databases together."
          busy={disabled}
          onClose={() => setModal(null)}
        >
          <form className="workspace-create" onSubmit={create}>
            <label>
              New workspace name
              <input
                autoFocus
                value={name}
                maxLength={100}
                required
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Customer operations"
              />
            </label>
            <p className="small muted">
              You’ll be the owner. Add a database, then invite your teammates.
            </p>
            {teams.error && (
              <p className="err" role="alert">
                {teams.error}
              </p>
            )}
            <div className="workspace-dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="btn pri" disabled={disabled || !name.trim()}>
                {teams.busy ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </form>
        </WorkspaceDialog>
      )}
      {modal === 'database' && workspace && owner && (
        <WorkspaceDialog
          title={'Add to ' + workspace.name}
          description={
            workspace.personal
              ? 'Create a database, upload SQLite, or connect PostgreSQL.'
              : 'Choose a new database or bring one from your personal workspace.'
          }
          wide
          busy={disabled}
          onClose={() => setModal(null)}
        >
          <DatabaseForm
            busy={disabled}
            onOpen={async (payload) => {
              const data = await workbench.open({ ...payload, workspace_id: teams.selected });
              teams.refresh();
              setModal(null);
              onOpened?.(data);
            }}
          />
          {!workspace.personal && personalDatabases.length > 0 && (
            <form
              className="workspace-attach"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!attachId) return;
                const database = personalDatabases.find(
                  (item) => String(item.database_id) === attachId,
                );
                const result = await action(
                  'attach',
                  { database_id: database.database_id },
                  'Database moved to this workspace.',
                );
                if (result) {
                  setAttachId('');
                  setModal(null);
                }
              }}
            >
              <h3>Use an existing database</h3>
              <p className="small muted">
                The database moves out of your personal workspace. Members still need explicit
                access.
              </p>
              <label>
                Move one of your personal databases
                <select
                  value={attachId}
                  disabled={disabled}
                  onChange={(event) => setAttachId(event.target.value)}
                >
                  <option value="">Choose a database</option>
                  {personalDatabases.map((database) => (
                    <option key={database.database_id} value={database.database_id}>
                      {database.database}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" disabled={disabled || !attachId}>
                Move to workspace
              </button>
            </form>
          )}
          {teams.error && (
            <p className="err" role="alert">
              {teams.error}
            </p>
          )}
        </WorkspaceDialog>
      )}
      {modal === 'delete' && workspace && owner && !workspace.personal && (
        <WorkspaceDialog
          title="Delete workspace"
          description={'Delete ' + workspace.name + ' and end sharing with this team.'}
          busy={disabled}
          onClose={() => setModal(null)}
        >
          <form className="workspace-delete-form" onSubmit={deleteWorkspace}>
            <ul>
              <li>All databases move to your personal workspace. Your data is kept.</li>
              <li>Team members lose access to this workspace and its databases.</li>
              <li>Pending invitations are revoked.</li>
            </ul>
            <label>
              Type the workspace name to confirm
              <input
                autoFocus
                autoComplete="off"
                spellCheck="false"
                value={deleteName}
                disabled={disabled}
                onChange={(event) => setDeleteName(event.target.value)}
              />
            </label>
            <p className="small muted workspace-delete-match">
              Enter <strong>{workspace.name}</strong> exactly.
            </p>
            {teams.error && (
              <p className="err" role="alert">
                {teams.error}
              </p>
            )}
            <div className="workspace-dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="btn warn" disabled={disabled || deleteName !== workspace.name}>
                {teams.busy ? 'Deleting…' : 'Delete workspace'}
              </button>
            </div>
          </form>
        </WorkspaceDialog>
      )}
    </section>
  );
}
