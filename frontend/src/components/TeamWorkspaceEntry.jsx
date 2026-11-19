import { useState } from 'react';
import { useRouter } from '../lib/router';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { Icon } from './Icon';

export function TeamWorkspaceEntry({ disabled = false }) {
  const [creating, setCreating] = useState(false);
  const { navigate } = useRouter();
  return (
    <section className="team-workspace-entry" aria-label="Work with your team">
      <div className="team-entry-copy">
        <h2>Working with a team?</h2>
        <p>Share databases and choose what each teammate can do.</p>
      </div>
      <button className="btn" disabled={disabled} onClick={() => setCreating(true)}>
        <Icon name="plus" /> Create team workspace
      </button>
      {creating && (
        <CreateWorkspaceDialog
          disabled={disabled}
          onClose={() => setCreating(false)}
          onCreated={(workspace) => {
            setCreating(false);
            navigate('/workspaces?workspace=' + encodeURIComponent(workspace.workspace_id));
          }}
        />
      )}
    </section>
  );
}
