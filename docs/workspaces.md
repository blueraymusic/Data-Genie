# Workspaces and database access

[Main README](../README.md) · [All guides](README.md) · [Agent permissions](agents.md)

On [Choose your database](https://data-genie.space/databases), choose **Create team workspace** to start a team before opening a database. Enter a **New workspace name** and choose **Create workspace**. The new workspace opens in **Teams** with that team selected.

You can also create a team from **Databases** while a database is open, or choose **New workspace** in [Teams](https://data-genie.space/workspaces). Creating a workspace keeps your current connection; it does not move that database automatically.

Existing databases stay in your **Personal workspace**; their files and history are preserved.
Accounts and workspaces belong to the installation you are using; the hosted site and a local installation are separate.

## Share a database

1. Create a workspace for your team or project, or select one you own in **Teams**.
2. In **Databases**, choose **Add a database** to create, upload, or connect a database there. Choose **Use an existing database** to move a personal database, or **New or connected database** to create, upload, or connect one. These are separate workflows.
3. Open **People & access → Invitations**, choose **Invite a teammate**, enter their account email, choose **Member** or **Viewer**, then choose **Create invitation**.
4. Copy the invitation code and share it privately with that person. A private link is also available. The app does not send email. Invitations expire after seven days and can be revoked or replaced.
5. The recipient signs in or creates an account with the invited email, opens **Teams**, enters the code in the invitation shown there, and chooses **Join workspace**. Opening the private link can fill in the code for them.
6. In **People & access → Database access**, select the Member, select a database, choose the permissions you want to grant, and save them. Joining does not automatically grant database access.

Invitation codes and links are credentials: send them only to the intended recipient. Acceptance needs both the private code and the matching signed-in account. The code is shown once when an invitation is created. Replacing an invitation creates a new code and invalidates the previous one.

Change a person’s role or remove them in **People & access → Workspace role**. The person picker includes photos or initials, name/email search, and pages for large teams. Role and database drafts stay while you switch between the popup’s views.

## Roles

An agent connection acts within the signed-in account's current role and database grants. Connecting an agent does not add a member or create new database permissions. OAuth consent and API keys can narrow access further. See [agent setup](agents.md).

| Role   | Access                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner  | Adds database connections, invites members, and manages permissions.                                                                        |
| Member | Uses only databases explicitly granted to them, within their permissions.                                                                   |
| Viewer | Has no direct database, chat, SQL, or schema access in the shared workspace. Can read only reports the owner has shared with the workspace. |

A person can own their personal workspace and be a Member or Viewer in another workspace.
Only the owner can manage a workspace. An owner can [request an ownership transfer](#transfer-ownership) of a **team workspace** to an existing Data Genie account; ownership changes only after the recipient accepts. **Personal workspaces cannot be transferred.** Move personal databases or reports into a team you own first.

## Permissions for each database

- **View data:** ask questions, run reads, and inspect tables and columns.
- **Add or edit records:** run INSERT and UPDATE statements.
- **Delete records:** run DELETE statements. SQLite REPLACE also needs Add or edit because it can delete and insert.
- **Change structure:** create, rename, or remove tables and columns.
- **Download data:** use the app's CSV and SQLite download controls. Anyone who can read rows can still copy the information manually; this is not a data-loss prevention feature.

View access is required before other permissions can be granted. The server checks permissions for chat, SQL, manual schema changes, previews, and confirmations. Hidden or disabled buttons are only a convenience.

Newly opened sessions use the current permissions. Use **Revoke access** to remove all capabilities for that person and database. Revoking read access ends existing shared sessions and prevents their pending changes from being confirmed, even if access is granted again later. Removing a person clears their grants; rejoining does not restore them. Visible screens check for changes every five seconds and when focus returns; no page reload is needed. The server rechecks before protected operations, including AI calls. Members can still end a session after losing access.

## Shared data, private conversations

Everyone with access uses the same underlying database. Confirmed changes affect that database directly; PostgreSQL changes are also visible to other applications using that server. A workspace does not make a copy for each member.

Each person gets their own session, conversation, pending confirmations, and saved History. Joining a team does not reveal another member's chats or confirmation tokens. Connection passwords are used only on the server and are not returned to members.

All changes still need confirmation. Workspace permissions cannot override a PostgreSQL connection's read-only setting or its database user's privileges. Limited PostgreSQL changes are refused on tables whose triggers, rules, cascading actions, or custom expressions could add hidden effects; the owner can review those operations separately.

## Edit at the same time

Each pending change is checked against the tables and dependencies used by its preview. If another person changes those rows or their structure before you confirm, the app refuses the stale change and asks you to prepare the request again. This also detects changes made directly in a connected PostgreSQL database. Changes to an unrelated table do not invalidate your preview.

The app takes a short database lock while checking and applying a confirmed change. It does not keep that lock while you review the confirmation. Two people can read and prepare requests; if they confirm conflicting previews, the first current change succeeds and the other must be prepared again. Your own confirmed steps in a multi-step request advance that request's later checks.

Checks are deliberately bounded: at most 64 relevant tables, 20,000 inspected rows, 8 MiB of fingerprint input, and two seconds of fingerprint work. Larger operations are refused; use your database's transaction tools for those changes. Saved checks contain hashes, without database rows. Pending changes created before these checks were introduced must be prepared again.

## Delete a workspace

Only the owner can delete a team workspace. Open its workspace settings, choose **Delete workspace**, and type its exact name to confirm. Your Personal workspace cannot be deleted.

Deleting ends the team's sharing: memberships, invitations, workspace reports and database grants are removed, and members' shared sessions are ended. The databases move back to the owner's Personal workspace. The owner's sessions, database files, external PostgreSQL data and private History are preserved; deletion does not drop tables or undo confirmed changes.

## Reports

Choose **Reports** in a workspace, then **New report**. Reports open in a full-screen view with a fixed Close button and save controls. The writing tools sit beside the document on desktop and above it on mobile. **Write** and **Preview** show the same draft, with a live word count. Closing an edited report asks before discarding unsaved work. Start with a blank page, choose **Use a template**, or select **Draft with Data Genie AI**. AI generation sends only the goal and source notes you enter; it does not run database queries. Check its facts before saving. Generation is limited to ten drafts per account per hour.

Members can create and edit their own drafts. Once shared, only the owner can edit or unshare a report. Owners can review every report and choose **Share with all workspace members and viewers** when saving. Viewers can read only shared reports and cannot create reports or access the underlying databases, chats, SQL, or History. Drafts are visible only to their author and the owner. Editing a shared report keeps its existing sharing choice; use **Make private** to unshare it explicitly.

### Write together live

Save a new report once, then open it for editing on both devices. The report's author and workspace owner can coedit an unpublished draft; existing edit permissions still apply. Connected editors see each other's typing in about one second, with small batches sent after roughly 300 milliseconds. Names identify the other connected editors. Simultaneous edits merge and cursor positions follow incoming text, including emoji and other Unicode characters.

Typing updates a durable **live working copy**. **Save report** creates the reviewed snapshot and applies the owner's sharing choice. People reading a published report continue to see that snapshot until the owner saves again. This keeps unfinished writing out of shared findings. Live synchronization does not run queries or regenerate report figures when source database data changes.

Wait for **Live draft · All typing synced** before closing. Network failures preserve local writing while the editor reconnects; do not refresh or close while changes are pending. A very old editing session can outlive the bounded merge history. In that case, the app keeps its local text and asks you to copy it before reopening instead of overwriting either person's writing. Closing without saving leaves the live working copy available to authorized editors; it does not publish it.

Report saves check both the saved version and the exact live revision. If another session changes the draft while a save is in progress, review the newest draft and save again. Stale edits cannot silently overwrite it.

Owners can move a report to another workspace they own, including between Personal and a team. Choose **Move report** on its card and select the destination. The report becomes a private draft in its destination so moving it never silently shares it with a different team. Only a workspace owner can move reports; moving an item is separate from transferring workspace ownership.

Choose **Download PDF** on a saved report to keep a copy. Anyone who can read that report can download it: viewers can download shared reports, while drafts remain limited to their author and the owner. PDF downloads do not grant access to the underlying database.

For active reports, only the creator can choose **Delete report**, and only while they are a Member or Owner of the workspace. Confirming permanently removes the saved report. Anyone who can view an archived report may delete it after confirmation, including reports retained from a deleted author in an otherwise active workspace.

For local PDF downloads, install `python3 -m pip install -r backend/requirements-reports.txt` and restart the server. The Azure deployment includes this package.

Charts in shared reports, public links, and scheduled delivery are not included yet.

## Account deletion, transfers, and archives

### Transfer ownership

Only the current owner can transfer a **team workspace**. Ownership transfer does not apply to your **Personal workspace**, individual databases, or individual reports. To hand off personal data, move it into a team you own, then transfer that team. This is a separate action from account deletion. In **Teams**, select a team and choose **Transfer ownership** under **Workspace settings**. Enter the recipient’s existing Data Genie account email, type the workspace name, and confirm your password. They do not need to join first and receive no workspace access while the request is pending. Your account and ownership stay unchanged while the request is pending.

The recipient sees an **Ownership requests** section in Teams and a pending-request badge in navigation. They choose **Review request**, inspect the current database and connection counts, then **Accept ownership** or **Decline request**. Acceptance requires their current password, or a Google sign-in within five minutes. If the workspace changes after review, they must refresh before accepting.

Acceptance transfers the workspace, its databases, and saved PostgreSQL connection credentials. The recipient becomes Owner; the sender becomes Member and the new owner controls their database access. Existing members keep their grants; outstanding membership invitations are revoked so the new owner can review new invitations. Declining or cancelling leaves ownership unchanged. The sender can cancel a pending request; requests expire after seven days. Notifications are in Data Genie, not email.

### Delete account

In **Account & preferences → Sign-in & security → Delete account**, review the deletion impact, confirm your email, type **DELETE**, and enter your current password. Google-only accounts require a fresh sign-in within five minutes. Complete any desired ownership transfer in Teams before deleting your account; a pending request does not preserve ownership or data and is cancelled by deletion. Personal databases must first move into a team if you want to transfer them.

Deletion removes remaining owned Data Genie databases, saved connections, private history, invitations, browser logins, and agent keys/OAuth grants. It never drops an external PostgreSQL server or an original file outside Data Genie's managed storage.

Teams with remaining members and reports become **Archived**. Existing visibility is preserved: shared reports stay available, private reports by remaining authors stay private, and the departing owner's private drafts in their deleted workspaces are removed. Retained authorship is shown as **Deleted account**. Archives cannot add databases, edit reports, invite people, or generate AI drafts. Any current member who can view an archived report may download its PDF or permanently delete that report after confirmation. An archive disappears when its final real member deletes their account. A workspace without remaining members is deleted with its reports.

Reports in someone else's workspace remain there as read-only archived reports, attributed to **Deleted account**. Anyone in that workspace who can view an archived report can delete it; its previous visibility is preserved. Ownership and deletion actions use browser login and CSRF protection and are not agent API actions.
