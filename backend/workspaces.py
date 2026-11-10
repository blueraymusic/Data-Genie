"""Workspace membership and database grants, separate from private chat sessions.

Every authorization decision reads current membership and grants. The shared
lock also lets the application keep an access check and database execution in
the same critical section as a grant change. SQLite transactions protect the
checks and metadata mutations themselves.
"""

from functools import wraps
import hashlib
import hmac
import re
import secrets
import threading
import time
import uuid

from .repository import RepositoryError, _now


AUTHORIZATION_LOCK = threading.RLock()
PERMISSIONS = ("read", "write", "delete", "structure", "export")
INVITATION_LIFETIME = 7 * 24 * 60 * 60
_UNAVAILABLE = "This workspace or database is not available for your account."


def _serialized(method):
    @wraps(method)
    def wrapped(*args, **kwargs):
        with AUTHORIZATION_LOCK:
            return method(*args, **kwargs)
    return wrapped


def _integer(value):
    if type(value) is not int or value < 1:
        raise ValueError("Choose a valid account or database.")
    return value


def _reference(value):
    if not isinstance(value, str) or not value or len(value) > 100:
        raise PermissionError(_UNAVAILABLE)
    return value


def _role(value):
    if value not in ("member", "viewer"):
        raise ValueError("Choose member or viewer.")
    return value


def _invitation_code(token):
    """Normalize readable codes while preserving existing URL-safe secrets."""
    if not isinstance(token, str):
        return token
    candidate = token.strip()
    if re.fullmatch(r"[0-9a-fA-F]{20}|(?:[0-9a-fA-F]{4}-){4}[0-9a-fA-F]{4}", candidate):
        compact = candidate.replace("-", "").upper()
        return "-".join(compact[offset:offset + 4] for offset in range(0, 20, 4))
    return token


def _permissions(values):
    if (not isinstance(values, dict) or set(values) - set(PERMISSIONS)
            or any(type(value) is not bool for value in values.values())):
        raise ValueError("Permissions must use read, write, delete, structure and export with true or false values.")
    result = {key: values.get(key, False) for key in PERMISSIONS}
    if not result["read"] and any(result[key] for key in PERMISSIONS if key != "read"):
        raise ValueError("Allow reading before granting other database permissions.")
    return result


class WorkspaceStore:
    def __init__(self, repository):
        self.repository = repository

    @staticmethod
    def _account(connection, account_id):
        _integer(account_id)
        account = connection.execute("SELECT * FROM accounts WHERE account_id=?", (account_id,)).fetchone()
        if account is None:
            raise PermissionError(_UNAVAILABLE)
        return account

    @staticmethod
    def _membership(connection, account_id, workspace_id, owner=False):
        row = connection.execute("""SELECT w.*,m.role FROM workspaces w
            JOIN workspace_members m USING(workspace_id)
            WHERE w.workspace_id=? AND m.account_id=?""", (_reference(workspace_id), account_id)).fetchone()
        if row is None or (owner and (row["role"] != "owner" or row["owner_account_id"] != account_id)):
            raise PermissionError(_UNAVAILABLE)
        return row

    @staticmethod
    def _workspace(connection, row):
        result = dict(row)
        result["personal"] = row["kind"] == "personal"
        workspace_id = row["workspace_id"]
        result["database_count"] = connection.execute(
            "SELECT COUNT(*) FROM workspace_databases WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        result["member_count"] = connection.execute(
            "SELECT COUNT(*) FROM workspace_members WHERE workspace_id=?", (workspace_id,)).fetchone()[0]
        # Viewers see reports only, so do not disclose raw database inventory.
        if row["role"] == "viewer":
            result["database_count"] = 0
        elif row["role"] == "member":
            result["database_count"] = connection.execute("""SELECT COUNT(*) FROM workspace_grants g
                JOIN workspace_databases d ON d.database_id=g.database_id AND d.workspace_id=g.workspace_id
                WHERE g.workspace_id=? AND g.account_id=? AND g.can_read=1""",
                (workspace_id, row["account_id"])).fetchone()[0] if "account_id" in row.keys() else 0
        result.pop("account_id", None)
        return result

    @classmethod
    def _ensure_personal(cls, connection, account_id):
        cls._account(connection, account_id)
        row = connection.execute("SELECT * FROM workspaces WHERE owner_account_id=? AND kind='personal'", (account_id,)).fetchone()
        if row is None:
            workspace_id, now = str(uuid.uuid4()), int(time.time())
            connection.execute("INSERT INTO workspaces VALUES(?,?,'personal',?,?)",
                               (workspace_id, "Personal workspace", account_id, now))
            connection.execute("INSERT INTO workspace_members VALUES(?,?,'owner',?)", (workspace_id, account_id, now))
        else:
            workspace_id = row["workspace_id"]
        # Old sessions identify the original account that registered a SQLite
        # database. A PostgreSQL connection already has explicit ownership.
        # Never reassign an attached database from a team or another account.
        connection.execute("""INSERT INTO workspace_databases(database_id,workspace_id,owner_account_id,attached_at)
            SELECT d.database_id,?,?,? FROM databases d
            LEFT JOIN external_connections e ON e.connection_id=d.connection_id
            WHERE NOT EXISTS(SELECT 1 FROM workspace_databases wd WHERE wd.database_id=d.database_id)
              AND COALESCE(e.account_id,(SELECT s.account_id FROM sessions s
                  WHERE s.database_id=d.database_id AND s.account_id IS NOT NULL ORDER BY s.rowid LIMIT 1))=?""",
            (workspace_id, account_id, int(time.time()), account_id))
        return cls._membership(connection, account_id, workspace_id)

    @_serialized
    def ensure_personal(self, account_id):
        with self.repository._connection(write=True) as connection:
            return self._workspace(connection, self._ensure_personal(connection, account_id))

    ensure = ensure_personal

    @staticmethod
    def _invitation(row):
        return {key: row[key] for key in ("invitation_id", "workspace_id", "workspace_name", "email", "role",
                                          "invited_by", "created_at", "expires_at", "accepted_at", "revoked_at")}

    @_serialized
    def list_workspaces(self, account_id):
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            rows = connection.execute("""SELECT w.*,m.role,m.account_id FROM workspaces w
                JOIN workspace_members m USING(workspace_id) WHERE m.account_id=?
                ORDER BY CASE w.kind WHEN 'personal' THEN 0 ELSE 1 END,w.created_at,w.workspace_id""", (account_id,)).fetchall()
            email = self._account(connection, account_id)["email"]
            invitations = connection.execute("""SELECT i.*,w.name AS workspace_name FROM workspace_invitations i
                JOIN workspaces w USING(workspace_id) WHERE i.email=? COLLATE NOCASE
                AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
                ORDER BY i.created_at,i.invitation_id""", (email, int(time.time()))).fetchall()
            return {"workspaces": [self._workspace(connection, row) for row in rows],
                    "invitations": [self._invitation(row) for row in invitations]}

    @classmethod
    def _access(cls, connection, account_id, database_id, workspace_id=None):
        _integer(database_id)
        row = connection.execute("""SELECT w.workspace_id,w.name AS workspace_name,m.role,
                g.can_read,g.can_write,g.can_delete,g.can_structure,g.can_export
            FROM workspace_databases d JOIN workspaces w USING(workspace_id)
            JOIN workspace_members m ON m.workspace_id=w.workspace_id AND m.account_id=?
            LEFT JOIN workspace_grants g ON g.workspace_id=w.workspace_id AND g.account_id=m.account_id
                AND g.database_id=d.database_id
            WHERE d.database_id=?""", (account_id, database_id)).fetchone()
        if (row is None or row["role"] == "viewer"
                or (workspace_id is not None and row["workspace_id"] != workspace_id)
                or (row["role"] != "owner" and not row["can_read"])):
            raise PermissionError(_UNAVAILABLE)
        return {"workspace_id": row["workspace_id"], "workspace_name": row["workspace_name"], "role": row["role"],
                "permissions": {key: row["role"] == "owner" or bool(row["can_" + key]) for key in PERMISSIONS}}

    @_serialized
    def access(self, account_id, database_id):
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            return self._access(connection, account_id, database_id)

    @_serialized
    def get_workspace(self, account_id, workspace_id):
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            workspace = self._membership(connection, account_id, workspace_id)
            members = connection.execute("""SELECT m.account_id,m.role,m.joined_at,a.first_name,a.last_name,a.email
                FROM workspace_members m JOIN accounts a USING(account_id) WHERE m.workspace_id=?
                ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.joined_at,m.account_id""", (workspace_id,)).fetchall()
            databases = []
            if workspace["role"] != "viewer":
                for row in connection.execute("""SELECT d.database_id,d.database_name,d.connection_id
                    FROM workspace_databases wd JOIN databases d USING(database_id)
                    WHERE wd.workspace_id=? ORDER BY d.database_name COLLATE NOCASE,d.database_id""", (workspace_id,)):
                    try:
                        access = self._access(connection, account_id, row["database_id"], workspace_id)
                    except PermissionError:
                        continue
                    databases.append({"database_id": row["database_id"], "database": row["database_name"],
                                      "provider": "postgresql" if row["connection_id"] else "sqlite",
                                      "permissions": access["permissions"]})
            grants, invitations = [], []
            if workspace["role"] == "owner":
                for row in connection.execute("SELECT * FROM workspace_grants WHERE workspace_id=? ORDER BY account_id,database_id", (workspace_id,)):
                    grants.append({"account_id": row["account_id"], "database_id": row["database_id"],
                                   "permissions": {key: bool(row["can_" + key]) for key in PERMISSIONS}})
                invitations = [self._invitation(row) for row in connection.execute("""SELECT i.*,w.name AS workspace_name
                    FROM workspace_invitations i JOIN workspaces w USING(workspace_id)
                    WHERE i.workspace_id=? ORDER BY i.created_at DESC,i.invitation_id""", (workspace_id,))]
            result = self._workspace(connection, workspace)
            # _workspace has no member id on a single membership lookup.
            result["database_count"] = len(databases)
            return {"workspace": result, "members": [dict(row) for row in members], "databases": databases,
                    "grants": grants, "invitations": invitations}

    @_serialized
    def create_workspace(self, account_id, name):
        if (not isinstance(name, str) or not name.strip() or len(name.strip()) > 100
                or any(ord(char) < 32 for char in name)):
            raise ValueError("Use a workspace name with 1 to 100 characters.")
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            workspace_id, now = str(uuid.uuid4()), int(time.time())
            connection.execute("INSERT INTO workspaces VALUES(?,?,'team',?,?)", (workspace_id, name.strip(), account_id, now))
            connection.execute("INSERT INTO workspace_members VALUES(?,?,'owner',?)", (workspace_id, account_id, now))
            return self._workspace(connection, self._membership(connection, account_id, workspace_id))

    @_serialized
    def delete_workspace(self, account_id, workspace_id, name):
        """Remove a team while retaining its owner's databases and private history."""
        with self.repository._connection(write=True) as connection:
            workspace = self._membership(connection, account_id, workspace_id, owner=True)
            if workspace["kind"] != "team":
                raise ValueError("Your personal workspace cannot be deleted.")
            if not isinstance(name, str) or name != workspace["name"]:
                raise ValueError("Type the workspace name exactly to delete it.")
            personal = self._ensure_personal(connection, account_id)
            # End shared sessions so their pending confirmation tokens cannot
            # become usable again if the database is shared in a later team.
            # Owner sessions and every session's saved history remain intact.
            connection.execute("""UPDATE sessions SET ended_at=COALESCE(ended_at,?)
                WHERE account_id IS NOT NULL AND account_id<>? AND database_id IN
                    (SELECT database_id FROM workspace_databases WHERE workspace_id=?)""",
                (_now(), account_id, workspace_id))
            connection.execute("DELETE FROM workspace_grants WHERE workspace_id=?", (workspace_id,))
            connection.execute("""UPDATE workspace_databases SET workspace_id=?,attached_at=?
                WHERE workspace_id=?""", (personal["workspace_id"], int(time.time()), workspace_id))
            # Memberships and invitation secrets cascade with the team. No
            # database, connection, session, request or result rows are deleted.
            connection.execute("DELETE FROM workspaces WHERE workspace_id=?", (workspace_id,))
            return {"deleted": True, "workspace_id": workspace_id,
                    "personal_workspace_id": personal["workspace_id"]}

    @_serialized
    def invite(self, account_id, workspace_id, email, role="member"):
        _role(role)
        if not isinstance(email, str) or len(email.strip()) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()):
            raise ValueError("Provide a valid email address.")
        email = email.strip().lower()
        with self.repository._connection(write=True) as connection:
            workspace = self._membership(connection, account_id, workspace_id, owner=True)
            if workspace["kind"] != "team":
                raise ValueError("Create a team workspace before inviting people.")
            if connection.execute("""SELECT 1 FROM workspace_members m JOIN accounts a USING(account_id)
                WHERE m.workspace_id=? AND a.email=? COLLATE NOCASE""", (workspace_id, email)).fetchone():
                raise ValueError("That person already belongs to this workspace.")
            now, invitation_id = int(time.time()), str(uuid.uuid4())
            compact = secrets.token_hex(10).upper()
            token = "-".join(compact[offset:offset + 4] for offset in range(0, 20, 4))
            connection.execute("""UPDATE workspace_invitations SET revoked_at=? WHERE workspace_id=? AND email=? COLLATE NOCASE
                AND accepted_at IS NULL AND revoked_at IS NULL""", (now, workspace_id, email))
            connection.execute("""INSERT INTO workspace_invitations
                (invitation_id,token_hash,workspace_id,email,role,invited_by,created_at,expires_at)
                VALUES(?,?,?,?,?,?,?,?)""", (invitation_id, hashlib.sha256(token.encode()).hexdigest(), workspace_id,
                                            email, role, account_id, now, now + INVITATION_LIFETIME))
            result = self._invitation(connection.execute("""SELECT i.*,w.name AS workspace_name FROM workspace_invitations i
                JOIN workspaces w USING(workspace_id) WHERE invitation_id=?""", (invitation_id,)).fetchone())
            result["token"] = token
            return result

    @_serialized
    def accept_invitation(self, account_id, invitation_id, token=None):
        token = _invitation_code(token)
        with self.repository._connection(write=True) as connection:
            account = self._account(connection, account_id)
            now = int(time.time())
            invitation = connection.execute("""SELECT * FROM workspace_invitations WHERE invitation_id=?
                AND email=? COLLATE NOCASE AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?""",
                (_reference(invitation_id), account["email"], now)).fetchone()
            if (invitation is None or not isinstance(token, str) or not 20 <= len(token) <= 200
                    or not invitation["token_hash"] or not hmac.compare_digest(
                        invitation["token_hash"], hashlib.sha256(token.encode()).hexdigest())):
                raise PermissionError(_UNAVAILABLE)
            # A stale invitation must never overwrite an existing role.
            if connection.execute("SELECT 1 FROM workspace_members WHERE workspace_id=? AND account_id=?",
                                  (invitation["workspace_id"], account_id)).fetchone():
                raise ValueError("You already belong to this workspace.")
            connection.execute("INSERT INTO workspace_members VALUES(?,?,?,?)",
                               (invitation["workspace_id"], account_id, invitation["role"], now))
            connection.execute("UPDATE workspace_invitations SET accepted_at=? WHERE invitation_id=?", (now, invitation_id))
            return self._workspace(connection, self._membership(connection, account_id, invitation["workspace_id"]))

    @classmethod
    def _target_member(cls, connection, account_id, workspace_id, target_id):
        workspace = cls._membership(connection, account_id, workspace_id, owner=True)
        _integer(target_id)
        target = connection.execute("SELECT * FROM workspace_members WHERE workspace_id=? AND account_id=?",
                                    (workspace_id, target_id)).fetchone()
        if target is None:
            raise PermissionError(_UNAVAILABLE)
        if target["role"] == "owner" or target_id == workspace["owner_account_id"]:
            raise ValueError("The workspace owner cannot be removed or changed.")
        return target

    @_serialized
    def set_member_role(self, account_id, workspace_id, target_id, role):
        _role(role)
        with self.repository._connection(write=True) as connection:
            self._target_member(connection, account_id, workspace_id, target_id)
            connection.execute("UPDATE workspace_members SET role=? WHERE workspace_id=? AND account_id=?", (role, workspace_id, target_id))
            # Demotion is a revocation, not a suspension of hidden old grants.
            if role == "viewer":
                connection.execute("DELETE FROM workspace_grants WHERE workspace_id=? AND account_id=?", (workspace_id, target_id))
            return {"account_id": target_id, "role": role}

    @_serialized
    def remove_member(self, account_id, workspace_id, target_id):
        with self.repository._connection(write=True) as connection:
            self._target_member(connection, account_id, workspace_id, target_id)
            connection.execute("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?", (workspace_id, target_id))
            return {"removed": True}

    @_serialized
    def revoke_invitation(self, account_id, workspace_id, invitation_id):
        with self.repository._connection(write=True) as connection:
            self._membership(connection, account_id, workspace_id, owner=True)
            invitation = connection.execute("SELECT * FROM workspace_invitations WHERE workspace_id=? AND invitation_id=?",
                                            (workspace_id, _reference(invitation_id))).fetchone()
            if invitation is None:
                raise PermissionError(_UNAVAILABLE)
            if invitation["accepted_at"] is not None:
                raise ValueError("This invitation has already been accepted. Remove the member instead.")
            connection.execute("UPDATE workspace_invitations SET revoked_at=COALESCE(revoked_at,?) WHERE invitation_id=?",
                               (int(time.time()), invitation_id))
            return {"revoked": True}

    @_serialized
    def set_grant(self, account_id, workspace_id, target_id, database_id, permissions):
        permissions = _permissions(permissions)
        _integer(database_id)
        with self.repository._connection(write=True) as connection:
            member = self._target_member(connection, account_id, workspace_id, target_id)
            if member["role"] != "member":
                raise ValueError("Viewers can only see shared reports. Change their role to member to grant database access.")
            if connection.execute("SELECT 1 FROM workspace_databases WHERE workspace_id=? AND database_id=?",
                                  (workspace_id, database_id)).fetchone() is None:
                raise PermissionError(_UNAVAILABLE)
            connection.execute("""INSERT INTO workspace_grants VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(workspace_id,account_id,database_id) DO UPDATE SET can_read=excluded.can_read,
                can_write=excluded.can_write,can_delete=excluded.can_delete,can_structure=excluded.can_structure,can_export=excluded.can_export""",
                (workspace_id, target_id, database_id, *(int(permissions[key]) for key in PERMISSIONS)))
            return {"account_id": target_id, "database_id": database_id, "permissions": permissions}

    @_serialized
    def attach_database(self, account_id, workspace_id, database_id):
        _integer(database_id)
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            self._membership(connection, account_id, workspace_id, owner=True)
            current = connection.execute("SELECT * FROM workspace_databases WHERE database_id=?", (database_id,)).fetchone()
            if current is None or current["owner_account_id"] != account_id:
                raise PermissionError(_UNAVAILABLE)
            self._membership(connection, account_id, current["workspace_id"], owner=True)
            if current["workspace_id"] != workspace_id:
                connection.execute("DELETE FROM workspace_grants WHERE database_id=?", (database_id,))
                connection.execute("UPDATE workspace_databases SET workspace_id=?,attached_at=? WHERE database_id=?",
                                   (workspace_id, int(time.time()), database_id))
            return {"workspace_id": workspace_id, "database_id": database_id}

    @_serialized
    def open_database(self, account_id, workspace_id, database_id):
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            self._membership(connection, account_id, workspace_id)
            self._access(connection, account_id, database_id, workspace_id)
            account = self._account(connection, account_id)
            connection.execute("""INSERT INTO users(first_name,last_name,email) VALUES(?,?,?)
                ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name""",
                (account["first_name"], account["last_name"], account["email"]))
            user_id = connection.execute("SELECT user_id FROM users WHERE email=?", (account["email"],)).fetchone()[0]
            session_id = str(uuid.uuid4())
            connection.execute("INSERT INTO sessions(session_id,user_id,database_id,started_at,account_id) VALUES(?,?,?,?,?)",
                               (session_id, user_id, database_id, _now(), account_id))
            return self.repository._session(connection, session_id)

    @_serialized
    def shared_connection_config(self, account_id, session_id):
        """Return encrypted server-only config after fresh shared-session access.

        This is intentionally separate from Repository.external_connection:
        that existing API must remain restricted to the connection's owner.
        """
        with self.repository._connection(write=True) as connection:
            self._ensure_personal(connection, account_id)
            try:
                session = self.repository._session(connection, _reference(session_id), active_only=True)
            except RepositoryError:
                raise PermissionError(_UNAVAILABLE) from None
            if session["account_id"] != account_id:
                raise PermissionError(_UNAVAILABLE)
            self._access(connection, account_id, session["database_id"])
            encrypted = connection.execute("SELECT encrypted_config FROM external_connections WHERE connection_id=?",
                                           (session["connection_id"],)).fetchone()
            if encrypted is None:
                # The caller's access has already been checked. Keep missing
                # saved credentials distinct so the app can offer reconnect.
                raise RepositoryError("The saved PostgreSQL connection details are missing.")
            return encrypted[0]
