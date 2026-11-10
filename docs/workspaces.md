# Workspaces and database access

On [Choose your database](https://data-genie.space/databases), choose **Create team workspace** to start a team before opening a database. Enter a **New workspace name** and choose **Create workspace**. The new workspace opens in **Teams** with that team selected.

You can also create a team from **Databases** while a database is open, or choose **New workspace** in [Teams](https://data-genie.space/workspaces). Creating a workspace keeps your current connection; it does not move that database automatically.

Existing databases stay in your **Personal workspace**; their files and history are preserved.
Accounts and workspaces belong to the installation you are using; the hosted site and a local installation are separate.

## Share a database

1. Create a workspace for your team or project, or select one you own in **Teams**.
2. In **Databases**, choose **Add a database** to create, upload, or connect a database there. Choose **Use an existing database** to move a personal database, or **New or connected database** to create, upload, or connect one. These are separate workflows.
3. Open **People & access**, choose **Invite a teammate**, enter their account email, choose **Member** or **Viewer**, then choose **Create invitation**.
4. Copy the invitation code and share it privately with that person. A private link is also available. The app does not send email. Invitations expire after seven days and can be revoked or replaced.
5. The recipient signs in or creates an account with the invited email, opens **Teams**, enters the code in the invitation shown there, and chooses **Join workspace**. Opening the private link can fill in the code for them.
6. In **People & access**, select the Member, select a database, choose the permissions you want to grant, and save them. Joining does not automatically grant database access.

Invitation codes and links are credentials: send them only to the intended recipient. Acceptance needs both the private code and the matching signed-in account. The code is shown once when an invitation is created. Replacing an invitation creates a new code and invalidates the previous one.

## Roles

| Role   | Access                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner  | Adds database connections, invites members, and manages permissions.                                                                        |
| Member | Uses only databases explicitly granted to them, within their permissions.                                                                   |
| Viewer | Has no direct database, chat, SQL, or schema access in the shared workspace. Can read only reports the owner has shared with the workspace. |

A person can own their personal workspace and be a Member or Viewer in another workspace.
Only the owner can manage a workspace. Ownership transfer is not included in this version.

## Permissions for each database

- **View data:** ask questions, run reads, and inspect tables and columns.
- **Add or edit records:** run INSERT and UPDATE statements.
- **Delete records:** run DELETE statements. SQLite REPLACE also needs Add or edit because it can delete and insert.
- **Change structure:** create, rename, or remove tables and columns.
- **Download data:** use the app's CSV and SQLite download controls. Anyone who can read rows can still copy the information manually; this is not a data-loss prevention feature.

View access is required before other permissions can be granted. The server checks permissions for chat, SQL, manual schema changes, previews, and confirmations. Hidden or disabled buttons are only a convenience.

Newly opened sessions use the current permissions. Use **Revoke access** to remove all capabilities for that person and database. Revoking read access ends existing shared sessions and prevents their pending changes from being confirmed, even if access is granted again later. Removing a person clears their grants; rejoining does not restore them. The browser checks for access changes every 15 seconds while visible and when it regains focus. The server rechecks before protected operations, including AI calls. Members can still end a session after losing access.

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

Choose **Reports** in a workspace, then **New report**. Start with a blank page, choose **Use a template**, or select **Draft with Data Genie AI**. AI generation sends only the goal and source notes you enter; it does not run database queries. Check its facts before saving. Generation is limited to ten drafts per account per hour.

Members can create and edit their own drafts. Owners can review every report and choose **Share with all workspace members and viewers** when saving. Viewers can read only shared reports and cannot create reports or access the underlying databases, chats, SQL, or History. Drafts are visible only to their author and the owner. Reports are snapshots, not live dashboards; update them manually when source data changes. Editing a shared report returns it to draft unless the owner shares it again when saving.

Report saves check a version number. If another session has saved changes first, reopen the report before editing again; stale edits cannot silently overwrite it.

Charts in shared reports, public links, report exports, and scheduled delivery are not included yet.
