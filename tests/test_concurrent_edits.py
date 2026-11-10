"""Independent team sessions must not confirm changes against a stale preview."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import sqlite3
import tempfile
from threading import Barrier
import time
import unittest
from unittest.mock import patch

from backend import preview_guard, workbench
from backend.workspaces import WorkspaceStore
from tests import test_workspace_postgres as postgres_harness


class ConcurrentEditTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="genie-concurrent-edits-")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        repository_patch = patch.object(workbench, "REPOSITORY_PATH", root / "repository.sqlite3")
        repository_patch.start()
        self.addCleanup(repository_patch.stop)
        self.path = root / "shared.sqlite3"
        with sqlite3.connect(self.path, factory=workbench.Conn) as connection:
            connection.executescript("""
                CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,balance INTEGER,state TEXT);
                INSERT INTO customers VALUES(1,'Private Ada',10,'Iowa'),(2,'Private Grace',20,'Missouri');
                CREATE TABLE rates(id INTEGER PRIMARY KEY,amount INTEGER);
                INSERT INTO rates VALUES(1,5);
            """)
        self.repository = workbench.get_repository()
        with self.repository._connection(write=True) as connection:
            self.owner, self.member = [connection.execute(
                "INSERT INTO accounts(first_name,last_name,email,password_hash,created_at) VALUES('Test','User',?,'!test',?)",
                (email, int(time.time())),
            ).lastrowid for email in ("owner@example.test", "member@example.test")]
        self.owner_session = workbench.start_session("Owner", "Fixture", "owner@example.test", path=self.path, account_id=self.owner)["session_id"]
        service = WorkspaceStore(self.repository)
        workspace = service.create_workspace(self.owner, "Shared fixture")["workspace_id"]
        database_id = self.repository.get_session(self.owner_session)["database_id"]
        service.attach_database(self.owner, workspace, database_id)
        invitation = service.invite(self.owner, workspace, "member@example.test")
        service.accept_invitation(self.member, invitation["invitation_id"], invitation["token"])
        service.set_grant(self.owner, workspace, self.member, database_id,
                          {"read": True, "write": True, "delete": True, "structure": True})
        self.member_session = service.open_database(self.member, workspace, database_id)["session_id"]

    def prepare(self, session_id, sql):
        result = workbench.submit_request(session_id, sql, raw_sql=True)
        self.assertTrue(result["matched"], result)
        return result

    def confirm(self, session_id, pending):
        return workbench.confirm_command(session_id, pending["command_id"], pending["confirmation_token"])

    def rows(self, sql="SELECT id,balance,state FROM customers ORDER BY id"):
        with sqlite3.connect(self.path, factory=workbench.Conn) as connection:
            return [tuple(row) for row in connection.execute(sql)]

    def test_teammates_update_invalidates_pending_update_and_delete(self):
        for operation in ("UPDATE customers SET balance=99 WHERE id=1", "DELETE FROM customers WHERE id=1"):
            with self.subTest(operation=operation):
                pending = self.prepare(self.owner_session, operation)
                changed = self.prepare(self.member_session, "UPDATE customers SET balance=balance+1 WHERE id=1")
                self.confirm(self.member_session, changed)
                before = self.rows()
                with self.assertRaisesRegex(preview_guard.StalePreview, "database changed.*Prepare"):
                    self.confirm(self.owner_session, pending)
                self.assertEqual(self.rows(), before)
                self.assertEqual(self.repository.get_command(pending["command_id"])["status"], "failed")

    def test_new_matching_rows_and_schema_changes_invalidate_delete(self):
        for change in ("INSERT INTO customers VALUES(3,'New teammate',30,'Iowa')",
                       "ALTER TABLE customers ADD COLUMN note TEXT"):
            with self.subTest(change=change):
                pending = self.prepare(self.owner_session, "DELETE FROM customers WHERE state='Iowa'")
                other = self.prepare(self.member_session, change)
                self.confirm(self.member_session, other)
                before = self.rows()
                with self.assertRaises(preview_guard.StalePreview):
                    self.confirm(self.owner_session, pending)
                self.assertEqual(self.rows(), before)

    def test_read_dependencies_are_guarded_but_unrelated_tables_can_change(self):
        pending = self.prepare(self.owner_session, "UPDATE customers SET balance=(SELECT amount FROM rates WHERE id=1) WHERE id=1")
        other = self.prepare(self.member_session, "UPDATE rates SET amount=7 WHERE id=1")
        self.confirm(self.member_session, other)
        with self.assertRaises(preview_guard.StalePreview):
            self.confirm(self.owner_session, pending)
        independent = self.prepare(self.owner_session, "UPDATE customers SET balance=12 WHERE id=1")
        other = self.prepare(self.member_session, "UPDATE rates SET amount=8 WHERE id=1")
        self.confirm(self.member_session, other)
        self.confirm(self.owner_session, independent)
        self.assertEqual(self.rows()[0][1], 12)

    def test_two_simultaneous_confirmations_accept_only_the_first_current_preview(self):
        first = self.prepare(self.owner_session, "UPDATE customers SET balance=100 WHERE id=1")
        second = self.prepare(self.member_session, "UPDATE customers SET balance=200 WHERE id=1")
        barrier = Barrier(2)

        def confirm(session, pending):
            barrier.wait(timeout=5)
            try:
                self.confirm(session, pending)
                return "executed"
            except preview_guard.StalePreview:
                return "stale"

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(confirm, self.owner_session, first), pool.submit(confirm, self.member_session, second)]
            self.assertCountEqual([future.result(timeout=10) for future in futures], ["executed", "stale"])
        self.assertIn(self.rows()[0][1], (100, 200))

    def test_confirmation_holds_database_write_lock_between_check_and_mutation(self):
        pending = self.prepare(self.owner_session, "UPDATE customers SET balance=100 WHERE id=1")
        verify = preview_guard.verify

        def attempt_racing_write(*args):
            verify(*args)
            with sqlite3.connect(self.path, timeout=0, factory=workbench.Conn) as external:
                with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                    external.execute("UPDATE customers SET balance=200 WHERE id=1")

        with patch.object(preview_guard, "verify", side_effect=attempt_racing_write):
            self.confirm(self.owner_session, pending)
        self.assertEqual(self.rows()[0][1], 100)

    def test_history_reload_never_silently_rebases_a_stale_confirmation(self):
        pending = self.prepare(self.owner_session, "DELETE FROM customers WHERE id=1")
        other = self.prepare(self.member_session, "UPDATE customers SET state='Kansas' WHERE id=1")
        self.confirm(self.member_session, other)
        restored = workbench.history_for_session(self.owner_session)
        command = next(command for request in restored for command in request["commands"] if command["command_id"] == pending["command_id"])
        self.assertIn("database changed", command["preview_error"])
        with self.assertRaises(preview_guard.StalePreview):
            self.confirm(self.owner_session, pending)

    def test_hidden_rowids_are_guarded_and_without_rowid_tables_still_work(self):
        with sqlite3.connect(self.path, factory=workbench.Conn) as connection:
            connection.executescript("""
                CREATE TABLE loose(value TEXT);
                INSERT INTO loose VALUES('same');
                CREATE TABLE keyed(id TEXT PRIMARY KEY,value TEXT) WITHOUT ROWID;
                INSERT INTO keyed VALUES('one','before');
            """)
        workbench.schema_for_session(self.owner_session)
        pending = self.prepare(self.owner_session, "DELETE FROM loose WHERE rowid=1")
        with sqlite3.connect(self.path, factory=workbench.Conn) as connection:
            connection.executescript("DELETE FROM loose; INSERT INTO loose(rowid,value) VALUES(2,'same');")
        with self.assertRaises(preview_guard.StalePreview):
            self.confirm(self.owner_session, pending)
        current = self.prepare(self.owner_session, "UPDATE keyed SET value='after' WHERE id='one'")
        self.confirm(self.owner_session, current)
        self.assertEqual(self.rows("SELECT value FROM keyed"), [("after",)])

    def test_legacy_pending_writes_fail_closed_and_guards_store_no_database_rows(self):
        pending = self.prepare(self.owner_session, "UPDATE customers SET balance=99 WHERE id=1")
        with self.repository._connection(write=True) as connection:
            payload = connection.execute("SELECT guard_json FROM command_preview_guards").fetchone()[0]
            self.assertNotIn("Private Ada", payload)
            self.assertNotIn("Iowa", payload)
            connection.execute("DELETE FROM command_preview_guards WHERE command_id=?", (pending["command_id"],))
        with self.assertRaisesRegex(preview_guard.StalePreview, "no saved confirmation preview"):
            self.confirm(self.owner_session, pending)
        self.assertEqual(self.rows()[0][1], 10)

    def test_preview_work_is_bounded_and_does_not_modify_real_rows(self):
        with patch.object(preview_guard, "MAX_ROWS", 1):
            result = workbench.submit_request(self.owner_session, "UPDATE customers SET balance=99 WHERE id=1", raw_sql=True)
        self.assertFalse(result["matched"])
        self.assertIn("safe confirmation preview limit", result["message"])
        self.assertEqual(self.rows()[0][1], 10)

    def test_own_compound_steps_advance_without_rebasing_other_accounts(self):
        own = workbench.submit_request(self.owner_session,
            "update customers set balance=11 where id=1 then update customers set balance=12 where id=1")
        self.assertTrue(own["matched"], own)
        unrelated_pending = self.prepare(self.member_session, "DELETE FROM customers WHERE id=1")
        self.confirm(self.owner_session, own["commands"][0])
        self.confirm(self.owner_session, own["commands"][1])
        self.assertEqual(self.rows()[0][1], 12)
        with self.assertRaises(preview_guard.StalePreview):
            self.confirm(self.member_session, unrelated_pending)


@unittest.skipUnless(os.environ.get("GENIE_TEST_POSTGRES") == "1", "Opt in to disposable PostgreSQL checks")
class PostgresConcurrentEditTests(unittest.TestCase):
    setUpClass = postgres_harness.WorkspacePostgresTests.__dict__["setUpClass"]
    tearDownClass = postgres_harness.WorkspacePostgresTests.__dict__["tearDownClass"]
    setUp = postgres_harness.WorkspacePostgresTests.setUp
    tearDown = postgres_harness.WorkspacePostgresTests.tearDown
    share = postgres_harness.WorkspacePostgresTests.share
    grant = postgres_harness.WorkspacePostgresTests.grant
    prepare = postgres_harness.WorkspacePostgresTests.prepare
    confirm = postgres_harness.WorkspacePostgresTests.confirm
    rows = postgres_harness.WorkspacePostgresTests.rows

    def confirm_owner(self, session, pending):
        return workbench.confirm_command(session, pending["command_id"], pending["confirmation_token"])

    def test_teammates_update_invalidates_pending_update_and_delete(self):
        owner = self.share(write=True, delete=True)["session_id"]
        for operation in ("UPDATE customers SET state='Kansas' WHERE id=1", "DELETE FROM customers WHERE id=1"):
            with self.subTest(operation=operation):
                pending = self.prepare(operation)
                changed = workbench.submit_request(owner, "UPDATE customers SET amount=amount+1 WHERE id=1", raw_sql=True)
                self.assertTrue(changed["matched"], changed)
                self.confirm_owner(owner, changed)
                before = self.rows()
                with self.assertRaises(preview_guard.StalePreview):
                    self.confirm(pending)
                self.assertEqual(self.rows(), before)

    def test_external_data_and_schema_changes_invalidate_preview(self):
        self.share(write=True, delete=True)
        for external_sql in (f'UPDATE "{self.schema}".customers SET amount=22 WHERE id=1',
                             f'ALTER TABLE "{self.schema}".customers ADD COLUMN note TEXT'):
            with self.subTest(sql=external_sql):
                pending = self.prepare("DELETE FROM customers WHERE id=1")
                with self.psycopg.connect(self.url) as connection:
                    connection.execute(external_sql)
                before = self.rows()
                with self.assertRaises(preview_guard.StalePreview):
                    self.confirm(pending)
                self.assertEqual(self.rows(), before)

    def test_simultaneous_account_confirmations_cannot_overwrite_each_other(self):
        owner = self.share(write=True)["session_id"]
        first = self.prepare("UPDATE customers SET amount=100 WHERE id=1")
        second = workbench.submit_request(owner, "UPDATE customers SET amount=200 WHERE id=1", raw_sql=True)
        self.assertTrue(second["matched"], second)
        barrier = Barrier(2)

        def confirm(session, pending):
            barrier.wait(timeout=5)
            try:
                self.confirm_owner(session, pending)
                return "executed"
            except preview_guard.StalePreview:
                return "stale"

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(confirm, self.member_session, first), pool.submit(confirm, owner, second)]
            self.assertCountEqual([future.result(timeout=10) for future in futures], ["executed", "stale"])

    def test_compound_steps_advance_only_their_own_locked_post_write_state(self):
        owner = self.share(write=True, delete=True, structure=True)["session_id"]
        plans = [{"sql": sql, "summary": "Fixture batch", "visualization": "table"} for sql in [
            "CREATE TABLE scratch (id INTEGER PRIMARY KEY,title TEXT)", "INSERT INTO scratch VALUES(1,'a')",
            "UPDATE scratch SET title='b' WHERE id=1", "SELECT * FROM scratch",
        ]]
        with patch.object(workbench.gemini_provider, "generate_plans", return_value=plans):
            own = workbench.submit_request(owner, "create and populate scratch", interpreter="gemini")
        self.assertTrue(own["matched"], own)
        for command in own["commands"]:
            result = self.confirm_owner(owner, command)
        self.assertEqual(result["rows"], [{"id": 1, "title": "b"}])
        pending = self.prepare("UPDATE customers SET state='Kansas' WHERE id=1")
        pair = workbench.submit_request(owner,
            "update customers set state='Ohio' where id=1 then update customers set state='Maine' where id=1")
        self.assertTrue(pair["matched"], pair)
        self.confirm_owner(owner, pair["commands"][0])
        self.confirm_owner(owner, pair["commands"][1])
        with self.assertRaises(preview_guard.StalePreview):
            self.confirm(pending)

    def test_external_writer_cannot_slip_between_check_and_mutation(self):
        self.share(write=True)
        pending = self.prepare("UPDATE customers SET amount=100 WHERE id=1")
        verify = preview_guard.verify

        def attempt_racing_write(*args):
            verify(*args)
            with self.psycopg.connect(self.url) as external:
                external.execute("SET lock_timeout='50ms'")
                with self.assertRaises(self.psycopg.errors.LockNotAvailable):
                    external.execute(f'UPDATE "{self.schema}".customers SET amount=200 WHERE id=1')

        with patch.object(preview_guard, "verify", side_effect=attempt_racing_write):
            self.confirm(pending)


if __name__ == "__main__":
    unittest.main()
