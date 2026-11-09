"""Workspace isolation, invitations, grants and private shared-db sessions."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest

from backend.repository import Repository, RepositoryError
from backend.workspaces import WorkspaceStore, PERMISSIONS, INVITATION_LIFETIME


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repository = Repository(Path(self.directory.name) / "repository.sqlite3")
        self.store = WorkspaceStore(self.repository)
        self.owner = self.account("owner@example.com")
        self.member = self.account("member@example.com")
        self.viewer = self.account("viewer@example.com")
        self.outsider = self.account("outsider@example.com")
        self.database_number = 0

    def account(self, email):
        with self.repository._connection(write=True) as connection:
            return connection.execute("""INSERT INTO accounts(first_name,last_name,email,password_hash,created_at)
                VALUES('Test','User',?,'!test',?)""", (email, int(time.time()))).lastrowid

    def database(self, account_id=None):
        self.database_number += 1
        path = Path(self.directory.name) / f"customers{self.database_number}.sqlite3"
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT)")
        connection.execute("INSERT INTO customers(name) VALUES('Private customer')")
        connection.commit()
        connection.close()
        return self.repository.start_session("CLI", "User", f"cli{self.database_number}@example.com",
                                             path, path.name, account_id=account_id)

    def team(self):
        return self.store.create_workspace(self.owner, "Design studio")["workspace_id"]

    def join(self, workspace_id, account_id=None, role="member"):
        account_id = self.member if account_id is None else account_id
        with self.repository._connection() as connection:
            email = connection.execute("SELECT email FROM accounts WHERE account_id=?", (account_id,)).fetchone()[0]
        invitation = self.store.invite(self.owner, workspace_id, email, role)
        self.store.accept_invitation(account_id, invitation["invitation_id"], invitation["token"])
        return invitation

    def share(self):
        session, workspace_id = self.database(self.owner), self.team()
        self.store.attach_database(self.owner, workspace_id, session["database_id"])
        self.join(workspace_id)
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {"read": True})
        return session, workspace_id

    def test_personal_backfill_is_lazy_idempotent_and_preserves_sessions(self):
        session = self.database(self.owner)
        request_id = self.repository.create_request(session["session_id"], "show customers")
        first = self.store.ensure_personal(self.owner)
        second = WorkspaceStore(Repository(self.repository.path)).ensure_personal(self.owner)
        self.assertEqual(first["workspace_id"], second["workspace_id"])
        self.assertEqual(first["kind"], "personal")
        self.assertIs(first["personal"], True)
        self.assertIs(self.store.list_workspaces(self.owner)["workspaces"][0]["personal"], True)
        team = self.store.create_workspace(self.owner, "Team serialization")
        self.assertIs(team["personal"], False)
        self.assertIs(self.store.get_workspace(self.owner, team["workspace_id"])["workspace"]["personal"], False)
        self.assertEqual(first["database_count"], 1)
        self.assertEqual(self.repository.get_request(request_id)["session_id"], session["session_id"])
        self.assertEqual(len(self.repository.list_sessions(account_id=self.owner)), 1)
        self.assertTrue(all(self.store.access(self.owner, session["database_id"])["permissions"].values()))

    def test_concurrent_backfill_creates_only_one_personal_workspace(self):
        self.database(self.owner)
        def ensure(_):
            return WorkspaceStore(Repository(self.repository.path)).ensure_personal(self.owner)["workspace_id"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(ensure, range(8)))
        self.assertEqual(len(set(ids)), 1)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM workspace_databases").fetchone()[0], 1)

    def test_cli_databases_remain_unassigned_and_legacy_original_owner_is_stable(self):
        cli = self.database()
        owner = self.database(self.owner)
        self.repository.start_session("Other", "User", "other@example.com", owner["path"], owner["database"], account_id=self.outsider)
        self.store.ensure_personal(self.outsider)
        self.store.ensure_personal(self.owner)
        with self.assertRaises(PermissionError):
            self.store.access(self.outsider, owner["database_id"])
        with self.repository._connection() as connection:
            self.assertIsNone(connection.execute("SELECT 1 FROM workspace_databases WHERE database_id=?", (cli["database_id"],)).fetchone())
        self.assertEqual(self.repository.get_session(cli["session_id"])["account_id"], None)

    def test_invitation_requires_secret_and_email_and_consumes_once(self):
        workspace_id = self.team()
        invitation = self.store.invite(self.owner, workspace_id, " MEMBER@EXAMPLE.COM ", "member")
        self.assertEqual(invitation["expires_at"] - invitation["created_at"], INVITATION_LIFETIME)
        for account_id, token in [(self.member, None), (self.member, "wrong" * 10), (self.outsider, invitation["token"])]:
            with self.assertRaises(PermissionError):
                self.store.accept_invitation(account_id, invitation["invitation_id"], token)
        joined = self.store.accept_invitation(self.member, invitation["invitation_id"], invitation["token"])
        self.assertEqual(joined["role"], "member")
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.member, invitation["invitation_id"], invitation["token"])
        with self.repository._connection() as connection:
            row = dict(connection.execute("SELECT * FROM workspace_invitations WHERE invitation_id=?", (invitation["invitation_id"],)).fetchone())
        self.assertNotIn(invitation["token"], json.dumps(row))
        self.assertIsNotNone(row["accepted_at"])

    def test_invitation_can_be_accepted_after_invited_person_registers(self):
        workspace_id = self.team()
        invitation = self.store.invite(self.owner, workspace_id, "new@example.com", "viewer")
        account_id = self.account("new@example.com")
        joined = self.store.accept_invitation(account_id, invitation["invitation_id"], invitation["token"])
        self.assertEqual(joined["workspace_id"], workspace_id)
        self.assertEqual(joined["role"], "viewer")

    def test_invitation_inbox_never_reveals_secret_or_other_email_invites(self):
        workspace_id = self.team()
        invitation = self.store.invite(self.owner, workspace_id, "member@example.com")
        inbox = self.store.list_workspaces(self.member)["invitations"]
        self.assertEqual([row["invitation_id"] for row in inbox], [invitation["invitation_id"]])
        serialized = json.dumps(inbox + self.store.get_workspace(self.owner, workspace_id)["invitations"])
        self.assertNotIn(invitation["token"], serialized)
        self.assertNotIn("token_hash", serialized)
        self.assertEqual(self.store.list_workspaces(self.outsider)["invitations"], [])

    def test_expired_revoked_and_replaced_invites_cannot_be_accepted(self):
        workspace_id = self.team()
        expired = self.store.invite(self.owner, workspace_id, "member@example.com")
        with self.repository._connection(write=True) as connection:
            connection.execute("UPDATE workspace_invitations SET expires_at=? WHERE invitation_id=?",
                               (int(time.time()) - 1, expired["invitation_id"]))
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.member, expired["invitation_id"], expired["token"])
        revoked = self.store.invite(self.owner, workspace_id, "member@example.com")
        self.store.revoke_invitation(self.owner, workspace_id, revoked["invitation_id"])
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.member, revoked["invitation_id"], revoked["token"])
        replaced = self.store.invite(self.owner, workspace_id, "member@example.com")
        current = self.store.invite(self.owner, workspace_id, "member@example.com", "viewer")
        with self.assertRaises(PermissionError):
            self.store.accept_invitation(self.member, replaced["invitation_id"], replaced["token"])
        self.assertEqual(self.store.accept_invitation(self.member, current["invitation_id"], current["token"])["role"], "viewer")

    def test_acceptance_is_atomic_under_concurrency(self):
        workspace_id = self.team()
        invitation = self.store.invite(self.owner, workspace_id, "member@example.com")
        def accept(_):
            try:
                self.store.accept_invitation(self.member, invitation["invitation_id"], invitation["token"])
                return True
            except PermissionError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(accept, range(2))), [False, True])

    def test_members_need_individual_read_grants_and_cannot_see_ungranted_databases(self):
        session, workspace_id = self.share()
        second = self.database(self.owner)
        self.store.attach_database(self.owner, workspace_id, second["database_id"])
        access = self.store.access(self.member, session["database_id"])
        self.assertEqual(access["permissions"], {key: key == "read" for key in PERMISSIONS})
        with self.assertRaises(PermissionError):
            self.store.access(self.member, second["database_id"])
        detail = self.store.get_workspace(self.member, workspace_id)
        self.assertEqual([row["database_id"] for row in detail["databases"]], [session["database_id"]])
        self.assertEqual(detail["grants"], [])
        self.assertEqual(detail["invitations"], [])
        self.assertEqual(next(row for row in self.store.list_workspaces(self.member)["workspaces"]
                              if row["workspace_id"] == workspace_id)["database_count"], 1)
        self.assertNotIn(session["path"], json.dumps(detail))

    def test_viewers_cannot_open_raw_data_even_with_stale_database_grants(self):
        session, workspace_id = self.share()
        self.join(workspace_id, self.viewer, "viewer")
        with self.assertRaises(ValueError):
            self.store.set_grant(self.owner, workspace_id, self.viewer, session["database_id"], {"read": True})
        with self.repository._connection(write=True) as connection:
            connection.execute("INSERT INTO workspace_grants VALUES(?,?,?,1,1,1,1,1)", (workspace_id, self.viewer, session["database_id"]))
        with self.assertRaises(PermissionError):
            self.store.access(self.viewer, session["database_id"])
        with self.assertRaises(PermissionError):
            self.store.open_database(self.viewer, workspace_id, session["database_id"])
        self.assertEqual(self.store.get_workspace(self.viewer, workspace_id)["databases"], [])

    def test_removed_members_and_revoked_grants_lose_existing_session_access_immediately(self):
        session, workspace_id = self.share()
        opened = self.store.open_database(self.member, workspace_id, session["database_id"])
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {})
        with self.assertRaises(PermissionError):
            self.store.access(self.member, opened["database_id"])
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {"read": True})
        self.store.remove_member(self.owner, workspace_id, self.member)
        with self.assertRaises(PermissionError):
            self.store.access(self.member, opened["database_id"])
        with self.assertRaises(PermissionError):
            self.store.get_workspace(self.member, workspace_id)
        with self.repository._connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM workspace_grants WHERE account_id=?", (self.member,)).fetchone()[0], 0)

    def test_demotion_discards_grants_and_promotion_does_not_restore_them(self):
        session, workspace_id = self.share()
        self.store.set_member_role(self.owner, workspace_id, self.member, "viewer")
        with self.assertRaises(PermissionError):
            self.store.access(self.member, session["database_id"])
        self.store.set_member_role(self.owner, workspace_id, self.member, "member")
        with self.assertRaises(PermissionError):
            self.store.access(self.member, session["database_id"])

    def test_workspace_owners_cannot_be_removed_demoted_or_regranted(self):
        session, workspace_id = self.share()
        for operation in [lambda: self.store.remove_member(self.owner, workspace_id, self.owner),
                          lambda: self.store.set_member_role(self.owner, workspace_id, self.owner, "viewer"),
                          lambda: self.store.set_grant(self.owner, workspace_id, self.owner, session["database_id"], {})]:
            with self.assertRaises(ValueError):
                operation()
        self.assertEqual(self.store.get_workspace(self.owner, workspace_id)["workspace"]["role"], "owner")

    def test_nonowners_cannot_manage_members_invites_grants_or_database_attachment(self):
        session, workspace_id = self.share()
        for caller in (self.member, self.outsider):
            for operation in [lambda: self.store.invite(caller, workspace_id, "another@example.com"),
                              lambda: self.store.remove_member(caller, workspace_id, self.member),
                              lambda: self.store.set_member_role(caller, workspace_id, self.member, "viewer"),
                              lambda: self.store.set_grant(caller, workspace_id, self.member, session["database_id"], {"read": True}),
                              lambda: self.store.attach_database(caller, workspace_id, session["database_id"])]:
                with self.assertRaises(PermissionError):
                    operation()

    def test_database_move_requires_owning_both_workspaces_and_database_and_revokes_grants(self):
        session, workspace_id = self.share()
        own_team = self.store.create_workspace(self.member, "Member's team")["workspace_id"]
        with self.assertRaises(PermissionError):
            self.store.attach_database(self.member, own_team, session["database_id"])
        personal = self.store.ensure_personal(self.owner)["workspace_id"]
        self.store.attach_database(self.owner, personal, session["database_id"])
        with self.assertRaises(PermissionError):
            self.store.access(self.member, session["database_id"])
        self.assertEqual(self.store.get_workspace(self.owner, workspace_id)["databases"], [])
        self.store.attach_database(self.owner, workspace_id, session["database_id"])
        with self.assertRaises(PermissionError):
            self.store.access(self.member, session["database_id"])

    def test_shared_database_sessions_use_same_data_but_private_history(self):
        session, workspace_id = self.share()
        owner_request = self.repository.create_request(session["session_id"], "Private owner question")
        opened = self.store.open_database(self.member, workspace_id, session["database_id"])
        self.assertNotEqual(opened["session_id"], session["session_id"])
        self.assertEqual(opened["account_id"], self.member)
        self.assertEqual(opened["database_id"], session["database_id"])
        self.assertEqual(opened["path"], session["path"])
        self.assertEqual(self.repository.history(opened["session_id"]), [])
        self.assertEqual(self.repository.conversation(opened["session_id"]), [])
        member_request = self.repository.create_request(opened["session_id"], "Private member question")
        self.assertEqual([row["request_id"] for row in self.repository.history(opened["session_id"])], [member_request])
        self.assertEqual([row["request_id"] for row in self.repository.history(session["session_id"])], [owner_request])
        self.assertEqual([row["session_id"] for row in self.repository.list_sessions(account_id=self.member)], [opened["session_id"]])
        # This is a shared database, not a copied or detached SQLite file.
        connection = sqlite3.connect(opened["path"])
        connection.execute("INSERT INTO customers(name) VALUES('Added in shared database')")
        connection.commit()
        connection.close()
        connection = sqlite3.connect(session["path"])
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0], 2)
        connection.close()

    def test_shared_postgresql_config_is_encrypted_owned_session_and_access_checked(self):
        encrypted = "encrypted-config-not-plaintext-credentials"
        session = self.repository.create_external_session(self.owner, "Production", encrypted)
        workspace_id = self.team()
        self.store.attach_database(self.owner, workspace_id, session["database_id"])
        self.join(workspace_id)
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {"read": True})
        opened = self.store.open_database(self.member, workspace_id, session["database_id"])
        self.assertEqual(opened["connection_id"], session["connection_id"])
        with self.assertRaises(RepositoryError):
            self.repository.external_connection(session["connection_id"], self.member)
        self.assertEqual(self.store.shared_connection_config(self.member, opened["session_id"]), encrypted)
        with self.assertRaises(PermissionError):
            self.store.shared_connection_config(self.member, session["session_id"])
        self.assertNotIn(encrypted, json.dumps(self.store.get_workspace(self.member, workspace_id)))
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {})
        with self.assertRaises(PermissionError):
            self.store.shared_connection_config(self.member, opened["session_id"])
        self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], {"read": True})
        self.repository.end_session(opened["session_id"])
        with self.assertRaises(PermissionError):
            self.store.shared_connection_config(self.member, opened["session_id"])
        resumed = self.store.open_database(self.member, workspace_id, session["database_id"])
        self.assertEqual(self.store.shared_connection_config(self.member, resumed["session_id"]), encrypted)

    def test_invalid_permission_keys_and_types_do_not_modify_existing_grant(self):
        session, workspace_id = self.share()
        for permissions in ({"read": 1}, {"read": "false"}, {"read": True, "admin": True},
                            {"write": True}, None, [True], {"read": True, "export": 0}):
            with self.assertRaises(ValueError):
                self.store.set_grant(self.owner, workspace_id, self.member, session["database_id"], permissions)
        self.assertEqual(self.store.access(self.member, session["database_id"])["permissions"], {key: key == "read" for key in PERMISSIONS})
        for role in ("owner", "admin", None, True):
            with self.assertRaises(ValueError):
                self.store.set_member_role(self.owner, workspace_id, self.member, role)

    def test_unauthorized_resource_errors_do_not_confirm_existence(self):
        session, workspace_id = self.share()
        messages = []
        for operation in [lambda: self.store.get_workspace(self.outsider, workspace_id),
                          lambda: self.store.get_workspace(self.outsider, "unknown-workspace"),
                          lambda: self.store.access(self.outsider, session["database_id"]),
                          lambda: self.store.access(self.outsider, 99999)]:
            with self.assertRaises(PermissionError) as error:
                operation()
            messages.append(str(error.exception))
        self.assertEqual(len(set(messages)), 1)

    def test_personal_workspace_cannot_be_used_to_invite_people(self):
        personal = self.store.ensure_personal(self.owner)["workspace_id"]
        with self.assertRaises(ValueError):
            self.store.invite(self.owner, personal, "member@example.com")


if __name__ == "__main__":
    unittest.main()
