import { useEffect, useRef, useState } from 'react';
import { WorkspaceReports } from '../components/WorkspaceReports';
import { DatabaseForm } from '../components/DatabaseForm';
import { Icon } from '../components/Icon';
import { WorkspaceDialog } from '../components/WorkspaceDialog';
import { CreateWorkspaceDialog } from '../components/CreateWorkspaceDialog';
import { WorkspaceMembers } from '../components/WorkspaceMembers';
import { WorkspaceInvitations, WorkspaceInviteManager } from '../components/WorkspaceInvitations';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useEnterMotion } from '../hooks/useMotion';
import { api } from '../lib/api';
import { forgetWorkspaceInvitation } from '../lib/workspaceInvites';
import { WorkspaceOwnership } from '../components/WorkspaceOwnership';
import { OwnershipRequests } from '../components/OwnershipRequests';
import { DatabaseActions } from '../components/DatabaseActions';
import { setDragPreview } from '../lib/dragPreview';
import { useDatabaseCollection } from '../hooks/useDatabaseCollection';
import { DatabaseListControls, DatabasePagination } from '../components/DatabaseListControls';

const permissionLabels = {
  read: 'Read',
  write: 'Edit rows',
  delete: 'Delete rows',
  structure: 'Change tables',
  export: 'Export',
};

export default function WorkspacesPage({ workbench, onOpened, initialWorkspaceId, preview }) {
  const sectionTabs = useRef(null),
    sectionContent = useRef(null);
  const teams = useWorkspaces(
      initialWorkspaceId || workbench.session?.access?.workspace_id,
      preview,
    ),
    { details } = teams,
    workspace = details?.workspace,
    owner = workspace?.role === 'owner',
    viewer = workspace?.role === 'viewer' || Boolean(workspace?.archived_at);
  const [deleteName, setDeleteName] = useState(''),
    [draggingDatabase, setDraggingDatabase] = useState(null),
    [draggingReport, setDraggingReport] = useState(null),
    [dropWorkspace, setDropWorkspace] = useState(null),
    [peoplePanel, setPeoplePanel] = useState('access'),
    [tab, setTab] = useState('databases'),
    [modal, setModal] = useState(null),
    [invitationDraft, setInvitationDraft] = useState({
      email: '',
      role: 'member',
      link: null,
    }),
    [personalDatabases, setPersonalDatabases] = useState([]),
    [attachId, setAttachId] = useState(''),
    [opening, setOpening] = useState(null),
    [databaseChoice, setDatabaseChoice] = useState('new');
  const lastRequestedWorkspace = useRef(initialWorkspaceId);
  useEffect(() => {
    if (lastRequestedWorkspace.current === initialWorkspaceId) return;
    lastRequestedWorkspace.current = initialWorkspaceId;
    if (initialWorkspaceId) teams.select(initialWorkspaceId);
  }, [initialWorkspaceId]);
  const pending = Boolean(workbench.pending || workbench.busy || workbench.workingCommands?.size),
    disabled = pending || teams.busy || opening !== null,
    base = '/api/workspaces/' + encodeURIComponent(teams.selected),
    personalId = teams.workspaces.find((item) => item.personal)?.workspace_id;
  useEnterMotion(
    sectionContent,
    `${workspace?.workspace_id || ''}:${tab}`,
    Boolean(!preview && workspace && !teams.detailsLoading),
  );
  const databases = (details?.databases || []).filter(
    (database) => owner || database.permissions?.read === true,
  );
  const databaseCollection = useDatabaseCollection(databases, teams.selected);
  const focusSection = useRef(false);
  useEffect(() => {
    if (!focusSection.current) return;
    focusSection.current = false;
    sectionTabs.current?.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
  }, [tab]);
  function selectTab(next) {
    if (next === 'people') {
      teams.setError('');
      setPeoplePanel('access');
      setModal('people');
      return;
    }
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
    setDatabaseChoice('new');
    setDeleteName('');
    setTab('databases');
    setModal(null);
  }, [teams.selected]);
  useEffect(() => {
    if (preview || !owner || workspace.personal || !personalId) {
      setPersonalDatabases([]);
      return;
    }
    const controller = new AbortController();
    api('/api/workspaces/' + encodeURIComponent(personalId), {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setPersonalDatabases(data.databases || []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPersonalDatabases([]);
      });
    return () => controller.abort();
  }, [owner, workspace?.workspace_id, workspace?.personal, personalId, details, preview]);
  async function action(path, body, success) {
    if (disabled) return null;
    return teams.act(base + '/' + path, body, success);
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
  const moveDestinations = teams.workspaces.filter(
    (item) => item.role === 'owner' && !item.archived_at && item.workspace_id !== teams.selected,
  );
  async function moveDatabase(destinationId, databaseId) {
    if (
      disabled ||
      !Number.isSafeInteger(databaseId) ||
      databaseId < 1 ||
      !moveDestinations.some((item) => item.workspace_id === destinationId)
    )
      return;
    setDropWorkspace(null);
    setDraggingDatabase(null);
    const destination = moveDestinations.find((item) => item.workspace_id === destinationId);
    const result = await teams.act(
      '/api/workspaces/' + encodeURIComponent(destinationId) + '/attach',
      { database_id: databaseId },
      'Database moved to ' + destination.name + '. Previous sharing permissions were removed.',
    );
    if (result) {
      window.dispatchEvent(new Event('dg-databases-changed'));
      await workbench.refresh?.();
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
      {teams.message && modal !== 'people' && (
        <p className="workspace-feedback" role="status">
          <Icon name="check" />
          {teams.message}
        </p>
      )}
      <WorkspaceInvitations
        invitations={teams.invitations}
        loading={teams.loading}
        resolved={teams.listResolved}
        disabled={disabled}
        onAccept={accept}
      />
      <OwnershipRequests
        requests={teams.ownershipTransfers}
        disabled={disabled}
        onComplete={(result) => {
          teams.refresh();
          if (result.status === 'accepted') teams.select(result.workspace_id);
          teams.setMessage(
            result.status === 'accepted'
              ? 'Ownership accepted. You now manage this workspace.'
              : 'Ownership request declined. Your access is unchanged.',
          );
        }}
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
                      className={
                        'workspace-rail-item' +
                        (dropWorkspace === item.workspace_id ? ' is-drop-target' : '') +
                        ((draggingDatabase || draggingReport) &&
                        moveDestinations.some((target) => target.workspace_id === item.workspace_id)
                          ? ' is-drop-available'
                          : '')
                      }
                      aria-current={teams.selected === item.workspace_id ? 'page' : undefined}
                      disabled={disabled || teams.loading}
                      onClick={() => teams.select(item.workspace_id)}
                      onDragOver={(event) => {
                        if (
                          moveDestinations.some(
                            (target) => target.workspace_id === item.workspace_id,
                          ) &&
                          !disabled &&
                          (event.dataTransfer.types.includes('application/x-data-genie-database') ||
                            (draggingReport &&
                              event.dataTransfer.types.includes('application/x-data-genie-report')))
                        ) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDropWorkspace(item.workspace_id);
                        }
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setDropWorkspace(null);
                      }}
                      onDrop={async (event) => {
                        if (
                          draggingReport &&
                          event.dataTransfer.getData('application/x-data-genie-report') ===
                            draggingReport.id
                        ) {
                          event.preventDefault();
                          setDropWorkspace(null);
                          if (
                            item.role === 'owner' &&
                            !item.archived_at &&
                            item.workspace_id !== workspace?.workspace_id &&
                            !disabled
                          )
                            await draggingReport.move(item.workspace_id);
                          setDraggingReport(null);
                          return;
                        }
                        const raw = event.dataTransfer.getData('application/x-data-genie-database');
                        if (!raw || item.role !== 'owner' || disabled) return;
                        event.preventDefault();
                        await moveDatabase(item.workspace_id, Number(raw));
                      }}
                    >
                      <span className="workspace-rail-icon">
                        <Icon name={personal ? 'account' : 'layers'} />
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {dropWorkspace === item.workspace_id
                            ? 'Release to move here'
                            : personal
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
                  {workspace?.archived_at
                    ? 'Archived workspace. Reports are retained; databases and editing are unavailable.'
                    : workspace?.personal
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
                  <span className="workspace-role">
                    {workspace.archived_at ? 'Archived' : workspace.role}
                  </span>
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
                {!viewer && (
                  <button
                    aria-current={tab === 'reports' ? 'page' : undefined}
                    onClick={() => selectTab('reports')}
                  >
                    Reports<small>Draft & share findings</small>
                  </button>
                )}
                {owner && !workspace.personal && (
                  <button
                    aria-current={tab === 'people' ? 'page' : undefined}
                    aria-haspopup="dialog"
                    aria-expanded={modal === 'people'}
                    onClick={() => selectTab('people')}
                  >
                    People &amp; access
                    <span>{(details.members || []).length}</span>
                    <small>
                      Invite teammates &amp; set permissions
                      {details.invitations?.length
                        ? ' · ' + details.invitations.length + ' pending'
                        : ''}
                    </small>
                  </button>
                )}
              </nav>
              {viewer || tab === 'reports' ? (
                <WorkspaceReports
                  key={workspace.workspace_id}
                  workspace={workspace}
                  workspaces={teams.workspaces}
                  busy={disabled}
                  onReportDragChange={setDraggingReport}
                />
              ) : tab === 'databases' ? (
                <section
                  ref={sectionContent}
                  className="workspace-section"
                  aria-labelledby="workspaceDatabasesTitle"
                >
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
                  <DatabaseListControls collection={databaseCollection} />
                  {databases.length > 0 && !databaseCollection.items.length && (
                    <p className="muted">No databases match your search.</p>
                  )}
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
                      {databaseCollection.items.map((database) => {
                        const current =
                          workbench.session?.database_id != null &&
                          String(workbench.session.database_id) === String(database.database_id) &&
                          workbench.session.access?.workspace_id === teams.selected;
                        return (
                          <article
                            className={
                              'workspace-database-row' +
                              (draggingDatabase === database.database_id ? ' is-dragging' : '')
                            }
                            key={database.database_id}
                            draggable={owner && !disabled}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                'application/x-data-genie-database',
                                String(database.database_id),
                              );
                              event.dataTransfer.effectAllowed = 'move';
                              setDragPreview(event);
                              setDraggingDatabase(database.database_id);
                            }}
                            onDragEnd={() => {
                              setDraggingDatabase(null);
                              setDropWorkspace(null);
                            }}
                          >
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
                            <DatabaseActions
                              database={database}
                              workspaceId={workspace.workspace_id}
                              owner={owner}
                              canExport={database.permissions?.export === true}
                              disabled={disabled}
                              workbench={workbench}
                              onChanged={(notice) => {
                                teams.setMessage(notice || 'Database updated.');
                                teams.refresh();
                              }}
                            />
                          </article>
                        );
                      })}
                    </div>
                  )}
                  <DatabasePagination collection={databaseCollection} />
                  {owner && databases.length > 0 && (
                    <p className="workspace-section-note small muted">
                      Drag a database to a workspace you own in the sidebar, or use Manage to move,
                      download, or remove it. Confirmed changes are saved automatically.
                    </p>
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
              ) : null}
              {owner && !workspace.personal && (
                <footer className="workspace-settings">
                  <p className="small muted">Workspace settings</p>
                  <WorkspaceOwnership
                    key={workspace.workspace_id}
                    workspace={workspace}
                    members={details.members || []}
                    disabled={disabled}
                    onChanged={teams.refresh}
                    onInvite={() => selectTab('people')}
                  />
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
      {modal === 'people' && workspace && owner && !workspace.personal && (
        <WorkspaceDialog
          title="People & access"
          initialFocusSelector='[role="combobox"][aria-label="Select a person"]'
          description={workspace.name}
          wide
          busy={teams.busy}
          onClose={() => setModal(null)}
        >
          <div className="people-access-content">
            {teams.error && (
              <p role="alert" className="err">
                {teams.error}
              </p>
            )}
            {teams.message && (
              <p role="status" className="small">
                {teams.message}
              </p>
            )}
            <div className="people-settings-tabs" role="group" aria-label="Access settings">
              {[
                ['access', 'Database access'],
                ['role', 'Workspace role'],
                ['invitations', 'Invitations'],
              ].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className="btn"
                  aria-pressed={peoplePanel === key}
                  disabled={teams.busy}
                  onClick={() => setPeoplePanel(key)}
                >
                  {label}
                  {key === 'invitations' && details.invitations?.length > 0 && (
                    <span className="people-pending-count">
                      {details.invitations.length} pending
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div hidden={peoplePanel === 'invitations'}>
              <WorkspaceMembers
                details={details}
                disabled={disabled}
                onAction={action}
                panel={peoplePanel}
              />
            </div>
            {peoplePanel === 'invitations' && (
              <WorkspaceInviteManager
                inline
                draft={invitationDraft}
                setDraft={setInvitationDraft}
                invitations={details.invitations || []}
                disabled={disabled}
                onAction={action}
                onError={teams.setError}
              />
            )}
          </div>
        </WorkspaceDialog>
      )}
      {modal === 'create' && (
        <CreateWorkspaceDialog
          disabled={disabled}
          onClose={() => setModal(null)}
          onCreated={(workspace) => {
            teams.refresh();
            teams.select(workspace.workspace_id);
            teams.setMessage('Workspace created.');
            setModal(null);
          }}
        />
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
          {!workspace.personal && personalDatabases.length > 0 && (
            <div className="database-source-tabs" role="group" aria-label="Database source">
              <button
                className="btn"
                aria-pressed={databaseChoice === 'new'}
                onClick={() => setDatabaseChoice('new')}
              >
                New or connected database
              </button>
              <button
                className="btn"
                aria-pressed={databaseChoice === 'existing'}
                onClick={() => setDatabaseChoice('existing')}
              >
                Use an existing database
              </button>
            </div>
          )}
          {(databaseChoice === 'new' || workspace.personal || !personalDatabases.length) && (
            <DatabaseForm
              busy={disabled}
              onOpen={async (payload) => {
                const data = await workbench.open({
                  ...payload,
                  workspace_id: teams.selected,
                });
                teams.refresh();
                setModal(null);
                onOpened?.(data);
              }}
            />
          )}
          {databaseChoice === 'existing' && !workspace.personal && personalDatabases.length > 0 && (
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
              <li>Workspace reports are deleted.</li>
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
