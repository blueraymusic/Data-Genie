# Workspaces and database access

Open **Teams** after logging in to manage your workspaces and invitations.
Existing databases stay in your **Personal workspace**; their files and history are preserved.
Accounts and workspaces belong to the installation you are using; the hosted site and a local installation are separate.

## Share a database

1. Create a workspace for your team or project.
2. Create, upload, or connect a database there. You can also move one of your personal databases into the workspace.
3. Enter your teammate's email and choose **Member** or **Viewer**. Choose **Send invitation** when email is configured, or **Create invitation link** when it is unavailable.
4. Check the email status. You can also copy the private invitation link and share it with that person. If sending fails or email is not configured, use the link. Links expire after seven days and can be revoked or replaced.
5. The recipient signs in or creates an account with the invited email, opens the link, and chooses **Join workspace**.
6. For a Member, select the database permissions you want to grant and save them. Joining does not automatically grant database access.

Invitation links are credentials: send them only to the intended recipient. Acceptance needs both the private code and the matching signed-in account. The link is shown once when an invitation is created. Resending or replacing an invitation creates a new code and invalidates the previous one.

**Email sent** means the provider accepted the message; it does not confirm inbox delivery. Ask the recipient to check their inbox and spam folder. If the status could not be confirmed, check with the recipient before resending. The app does not resend automatically. Installation owners can configure [Azure invitation email](email.md); ordinary local development keeps the manual-link option.

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

Reports, charts for sharing, public links, and scheduled delivery are not included yet.
