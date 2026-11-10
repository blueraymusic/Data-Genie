# Workspaces and database access

Open **Teams** after logging in to manage your workspaces and invitations.
Existing databases stay in your **Personal workspace**; their files and history are preserved.
Accounts and workspaces belong to the installation you are using; the hosted site and a local installation are separate.

## Share a database

1. Create a workspace for your team or project.
2. Create, upload, or connect a database there. You can also move one of your personal databases into the workspace.
3. Enter your teammate's account email, choose **Member** or **Viewer**, and create an invitation.
4. Copy the invitation code and share it privately with that person. A private link is also available. The app does not send email. Invitations expire after seven days and can be revoked or replaced.
5. The recipient signs in or creates an account with the invited email, opens **Teams**, enters the code in the invitation shown there, and chooses **Join workspace**. Opening the private link can fill in the code for them.
6. For a Member, select the database permissions you want to grant and save them. Joining does not automatically grant database access.

Invitation codes and links are credentials: send them only to the intended recipient. Acceptance needs both the private code and the matching signed-in account. The code is shown once when an invitation is created. Replacing an invitation creates a new code and invalidates the previous one.

## Roles

| Role | Access |
| --- | --- |
| Owner | Adds database connections, invites members, and manages permissions. |
| Member | Uses only databases explicitly granted to them, within their permissions. |
| Viewer | Has no direct database, chat, SQL, or schema access in the shared workspace. Report sharing will be added later. |

A person can own their personal workspace and be a Member or Viewer in another workspace.
Only the owner can manage a workspace. Ownership transfer is not included in this version.

## Permissions for each database

- **View data:** ask questions, run reads, and inspect tables and columns.
- **Add or edit records:** run INSERT and UPDATE statements.
- **Delete records:** run DELETE statements. SQLite REPLACE also needs Add or edit because it can delete and insert.
- **Change structure:** create, rename, or remove tables and columns.
- **Download data:** use the app's CSV and SQLite download controls. Anyone who can read rows can still copy the information manually; this is not a data-loss prevention feature.

View access is required before other permissions can be granted. The server checks permissions for chat, SQL, manual schema changes, previews, and confirmations. Hidden or disabled buttons are only a convenience.

Newly opened sessions use the current permissions. Revoking access also blocks subsequent requests from already-open sessions and prevents their pending changes from being confirmed. Members can still end a session after losing access.

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

Deleting ends the team's sharing: memberships, invitations and database grants are removed, and members' shared sessions are ended. The databases move back to the owner's Personal workspace. The owner's sessions, database files, external PostgreSQL data and private History are preserved; deletion does not drop tables or undo confirmed changes.

Reports, charts for sharing, public links, and scheduled delivery are not included yet.
