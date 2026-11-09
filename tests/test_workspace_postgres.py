"""Disposable PostgreSQL workspace checks; opt in with GENIE_TEST_POSTGRES=1."""

import os
import unittest
from unittest.mock import patch

from backend import authentication, workbench
from backend.connections import PostgresConnector
from backend.workspaces import WorkspaceStore
from tests import test_postgres_integration as postgres_harness


@unittest.skipUnless(os.environ.get("GENIE_TEST_POSTGRES") == "1", "Opt in to the disposable PostgreSQL integration suite")
class WorkspacePostgresTests(unittest.TestCase):
    # Reuse the dedicated local cluster harness, without inheriting/rerunning
    # the connector suite's unrelated tests or connecting to a user's database.
    setUpClass = classmethod(postgres_harness.PostgresIntegrationTests.setUpClass.__func__)
    tearDownClass = classmethod(postgres_harness.PostgresIntegrationTests.tearDownClass.__func__)

    def setUp(self):
        postgres_harness.PostgresIntegrationTests.setUp(self)
        self.store = WorkspaceStore(workbench.get_repository())
        self.owner_id = self.account["account_id"]
        member = authentication.Accounts(workbench.get_repository()).register(
            "Workspace", "Member", "member@example.test", "member fixture password long enough")
        self.member_id = member["account_id"]
        self.workspace_id = self.store.create_workspace(self.owner_id, "PostgreSQL workspace")["workspace_id"]
        invitation = self.store.invite(self.owner_id, self.workspace_id, member["email"])
        self.store.accept_invitation(self.member_id, invitation["invitation_id"], invitation["token"])

    def tearDown(self):
        postgres_harness.PostgresIntegrationTests.tearDown(self)

    def share(self, changes=True, **permissions):
        owner_session = workbench.start_postgres_session(self.owner_id, {**self.payload, "allow_changes": changes})
        self.database_id = owner_session["database_id"]
        self.store.attach_database(self.owner_id, self.workspace_id, self.database_id)
        self.grant(**permissions)
        opened = self.store.open_database(self.member_id, self.workspace_id, self.database_id)
        self.assertEqual(opened["connection_id"], owner_session["connection_id"])
        self.member_session = opened["session_id"]
        return owner_session

    def grant(self, **permissions):
        self.store.set_grant(self.owner_id, self.workspace_id, self.member_id, self.database_id,
                             {"read": True, **permissions})

    def prepare(self, sql):
        pending = workbench.submit_request(self.member_session, sql, raw_sql=True)
        self.assertTrue(pending["matched"], pending)
        self.assertTrue(pending["requires_confirmation"], pending)
        return pending

    def confirm(self, pending):
        return workbench.confirm_command(self.member_session, pending["command_id"], pending["confirmation_token"])

    def rows(self):
        with self.psycopg.connect(self.url) as connection:
            return connection.execute(f'SELECT id,name,state FROM "{self.schema}".customers ORDER BY id').fetchall()

    def add_delete_trigger(self):
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'''CREATE FUNCTION "{self.schema}".delete_second() RETURNS trigger
                LANGUAGE plpgsql AS $$ BEGIN DELETE FROM "{self.schema}".customers WHERE id=2; RETURN NEW; END; $$''')
            connection.execute(f'''CREATE TRIGGER hidden_delete AFTER UPDATE ON "{self.schema}".customers
                FOR EACH ROW EXECUTE FUNCTION "{self.schema}".delete_second()''')

    def add_delete_domain(self):
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'''CREATE FUNCTION "{self.schema}".delete_from_domain(text) RETURNS boolean
                LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$ BEGIN
                DELETE FROM "{self.schema}".customers WHERE id=2; RETURN true; END; $$''')
            connection.execute(f'''CREATE DOMAIN "{self.schema}".hidden_delete_text AS text
                CHECK ("{self.schema}".delete_from_domain(VALUE))''')

    def domain_update(self):
        return f'''UPDATE customers SET state=CAST('Kansas' AS "{self.schema}".hidden_delete_text) WHERE id=1'''

    def domain_add_column(self):
        return f'''ALTER TABLE customers ADD COLUMN hidden "{self.schema}".hidden_delete_text DEFAULT 'Kansas' '''

    def test_shared_reads_and_confirmed_updates_change_the_same_remote_database(self):
        owner_session = self.share(write=True)
        result = workbench.submit_request(self.member_session, "SELECT id,name,amount FROM customers ORDER BY id", raw_sql=True)
        self.assertEqual(result["rows"][0], {"id": 1, "name": "Sample Iowa", "amount": "12.34"})
        pending = self.prepare("UPDATE customers SET state='Kansas' WHERE id=1")
        self.assertEqual(self.rows()[0][2], "Iowa")
        done = self.confirm(pending)
        self.assertEqual(done["changes"], 1)
        self.assertEqual(self.rows()[0][2], "Kansas")
        owner_result = workbench.submit_request(owner_session["session_id"], "SELECT state FROM customers WHERE id=1", raw_sql=True)
        self.assertEqual(owner_result["rows"], [{"state": "Kansas"}])
        owner_history = workbench.get_repository().history(owner_session["session_id"])
        self.assertNotIn(pending["request_id"], [row["request_id"] for row in owner_history])

    def test_write_permission_does_not_allow_delete_or_structure_changes(self):
        self.share(write=True)
        before = self.rows()
        for sql in ("DELETE FROM customers WHERE id=1", "DROP TABLE orders",
                    "ALTER TABLE customers ADD COLUMN secret TEXT", "CREATE TABLE forbidden(id INTEGER)"):
            with self.subTest(sql=sql), self.assertRaises(PermissionError):
                workbench.submit_request(self.member_session, sql, raw_sql=True)
        self.assertEqual(self.rows(), before)

    def test_all_workspace_permissions_cannot_override_read_only_connection(self):
        self.share(changes=False, write=True, delete=True, structure=True, export=True)
        self.assertEqual(len(workbench.submit_request(self.member_session, "show customers")["rows"]), 2)
        with self.assertRaisesRegex(PermissionError, "read-only"):
            workbench.submit_request(self.member_session, "UPDATE customers SET state='Kansas' WHERE id=1", raw_sql=True)
        self.assertEqual(self.rows()[0][2], "Iowa")

    def test_custom_trigger_cannot_smuggle_deletes_through_a_write_grant(self):
        self.share(write=True)
        self.add_delete_trigger()
        before = self.rows()
        with self.assertRaisesRegex(PermissionError, "database-side"):
            workbench.submit_request(self.member_session, "UPDATE customers SET state='Kansas' WHERE id=1", raw_sql=True)
        self.assertEqual(self.rows(), before)

    def test_new_trigger_between_preview_and_confirmation_blocks_execution(self):
        self.share(write=True)
        pending = self.prepare("UPDATE customers SET state='Kansas' WHERE id=1")
        self.add_delete_trigger()
        before = self.rows()
        with self.assertRaisesRegex(PermissionError, "database-side"):
            self.confirm(pending)
        self.assertEqual(self.rows(), before)
        command = workbench.get_repository().get_command(pending["command_id"], self.member_session)
        self.assertEqual(command["status"], "failed")

    def test_confirmation_catalog_check_uses_locked_execution_connection(self):
        self.share(write=True)
        pending = self.prepare("INSERT INTO orders(id,customer_id) SELECT id,id FROM customers WHERE id=1")
        original = PostgresConnector.check_workspace_effects
        checked_locks = []

        def observe(connector, sql, access, connection=None):
            if connection is not None:
                rows = connection.execute("""SELECT c.relname FROM pg_catalog.pg_locks l
                    JOIN pg_catalog.pg_class c ON c.oid=l.relation
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    WHERE l.pid=pg_catalog.pg_backend_pid() AND l.mode='RowExclusiveLock' AND l.granted
                    AND n.nspname=%s AND c.relname IN ('customers','orders')""", (self.schema,)).fetchall()
                checked_locks.append({row["relname"] for row in rows})
            return original(connector, sql, access, connection=connection)

        with patch.object(PostgresConnector, "check_workspace_effects", observe):
            self.confirm(pending)
        self.assertTrue(checked_locks)
        self.assertTrue(all(locked == {"customers", "orders"} for locked in checked_locks))
        with self.psycopg.connect(self.url) as connection:
            self.assertEqual(connection.execute(f'SELECT id,customer_id FROM "{self.schema}".orders').fetchall(), [(1, 1)])

    def test_permission_revocation_invalidates_pending_postgresql_write(self):
        self.share(write=True)
        pending = self.prepare("UPDATE customers SET state='Kansas' WHERE id=1")
        self.grant()
        with self.assertRaises(PermissionError):
            self.confirm(pending)
        self.assertEqual(self.rows()[0][2], "Iowa")

    def test_grants_apply_to_each_database_and_existing_postgresql_sessions(self):
        self.share(write=True)
        second_schema = self.schema + "_second"
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'CREATE SCHEMA "{second_schema}"')
            connection.execute(f'CREATE TABLE "{second_schema}".customers(id INTEGER PRIMARY KEY,name TEXT,state TEXT)')
            connection.execute(f'''INSERT INTO "{second_schema}".customers VALUES (1,'Second database','Missouri')''')
        try:
            second_owner = workbench.start_postgres_session(self.owner_id, {
                **self.payload, "schema_name": second_schema, "database_name": "Second PostgreSQL database",
                "allow_changes": True})
            second_id = second_owner["database_id"]
            self.assertNotEqual(second_id, self.database_id)
            self.store.attach_database(self.owner_id, self.workspace_id, second_id)
            with self.assertRaises(PermissionError):
                self.store.open_database(self.member_id, self.workspace_id, second_id)
            self.store.set_grant(self.owner_id, self.workspace_id, self.member_id, second_id, {"read": True})
            second_member = self.store.open_database(self.member_id, self.workspace_id, second_id)["session_id"]
            self.assertEqual(workbench.submit_request(second_member, "SELECT name,state FROM customers", raw_sql=True)["rows"],
                             [{"name": "Second database", "state": "Missouri"}])
            with self.assertRaises(PermissionError):
                workbench.submit_request(second_member, "UPDATE customers SET state='Nebraska' WHERE id=1", raw_sql=True)
            first_pending = self.prepare("UPDATE customers SET state='Kansas' WHERE id=1")
            self.grant()
            self.store.set_grant(self.owner_id, self.workspace_id, self.member_id, second_id,
                                 {"read": True, "write": True})
            with self.assertRaises(PermissionError):
                self.confirm(first_pending)
            second_pending = workbench.submit_request(second_member,
                "UPDATE customers SET state='Nebraska' WHERE id=1", raw_sql=True)
            self.assertTrue(second_pending["requires_confirmation"], second_pending)
            done = workbench.confirm_command(second_member, second_pending["command_id"], second_pending["confirmation_token"])
            self.assertEqual(done["changes"], 1)
            self.assertEqual(self.rows()[0][2], "Iowa")
            self.assertEqual(workbench.submit_request(second_owner["session_id"],
                "SELECT state FROM customers WHERE id=1", raw_sql=True)["rows"], [{"state": "Nebraska"}])
        finally:
            with self.psycopg.connect(self.url) as connection:
                connection.execute(f'DROP SCHEMA "{second_schema}" CASCADE')

    def test_custom_domain_cast_cannot_smuggle_deletes_through_a_write_grant(self):
        self.share(write=True)
        self.add_delete_domain()
        before = self.rows()
        with self.assertRaises(PermissionError):
            workbench.submit_request(self.member_session, self.domain_update(), raw_sql=True)
        self.assertEqual(self.rows(), before)

    def test_custom_domain_column_cannot_smuggle_deletes_through_a_structure_grant(self):
        self.share(structure=True)
        self.add_delete_domain()
        before = self.rows()
        with self.assertRaises(PermissionError):
            workbench.submit_request(self.member_session, self.domain_add_column(), raw_sql=True)
        self.assertEqual(self.rows(), before)
        with self.psycopg.connect(self.url) as connection:
            self.assertEqual(connection.execute('''SELECT count(*) FROM information_schema.columns
                WHERE table_schema=%s AND table_name='customers' AND column_name='hidden' ''', (self.schema,)).fetchone(), (0,))

    def test_confirmation_rechecks_custom_domain_expressions(self):
        self.share(write=True, structure=True)
        self.add_delete_domain()
        before = self.rows()
        for sql in (self.domain_update(), self.domain_add_column()):
            with self.subTest(sql=sql):
                # Model a command pending from before the custom-type policy was
                # installed. Preparing it must not execute its hidden DELETE.
                with patch.object(PostgresConnector, "check_workspace_effects", return_value=None):
                    pending = self.prepare(sql)
                self.assertEqual(self.rows(), before)
                with self.assertRaises(PermissionError):
                    self.confirm(pending)
                self.assertEqual(self.rows(), before)
                command = workbench.get_repository().get_command(pending["command_id"], self.member_session)
                self.assertEqual(command["status"], "failed")
        with self.psycopg.connect(self.url) as connection:
            self.assertEqual(connection.execute('''SELECT count(*) FROM information_schema.columns
                WHERE table_schema=%s AND table_name='customers' AND column_name='hidden' ''', (self.schema,)).fetchone(), (0,))

    def test_owner_can_review_and_confirm_a_custom_domain_with_database_side_writes(self):
        owner = self.share(write=True)
        self.add_delete_domain()
        pending = workbench.submit_request(owner["session_id"], self.domain_update(), raw_sql=True)
        self.assertTrue(pending["requires_confirmation"], pending)
        self.assertEqual(len(self.rows()), 2)
        workbench.confirm_command(owner["session_id"], pending["command_id"], pending["confirmation_token"])
        self.assertEqual(self.rows(), [(1, "Sample Iowa", "Kansas")])

    def test_custom_operator_cannot_smuggle_deletes_through_a_write_grant(self):
        self.share(write=True)
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'''CREATE FUNCTION "{self.schema}".delete_from_operator(text,text) RETURNS text
                LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$ BEGIN
                DELETE FROM "{self.schema}".customers WHERE id=2; RETURN $1 || $2; END; $$''')
            connection.execute(f'''CREATE OPERATOR "{self.schema}".|| (LEFTARG=text, RIGHTARG=text,
                FUNCTION="{self.schema}".delete_from_operator)''')
        before = self.rows()
        expression = f"name OPERATOR({self.schema}.||) ' changed'"
        sql = f"UPDATE customers SET name={expression} WHERE id=1"
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'UPDATE "{self.schema}".customers SET name={expression} WHERE id=1')
            self.assertEqual(connection.execute(f'SELECT count(*) FROM "{self.schema}".customers').fetchone(), (1,))
            connection.rollback()
        with self.assertRaises(PermissionError):
            workbench.submit_request(self.member_session, sql, raw_sql=True)
        with patch.object(PostgresConnector, "check_workspace_effects", return_value=None):
            pending = self.prepare(sql)
        with self.assertRaises(PermissionError):
            self.confirm(pending)
        self.assertEqual(self.rows(), before)

    def test_event_trigger_cannot_smuggle_deletes_through_a_structure_grant(self):
        self.share(structure=True)
        event_name = "workspace_ddl_" + self.schema
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'''CREATE FUNCTION "{self.schema}".delete_after_ddl() RETURNS event_trigger
                LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
                DELETE FROM "{self.schema}".customers WHERE id=2; END; $$''')
            connection.execute(f'''CREATE EVENT TRIGGER "{event_name}" ON ddl_command_end
                WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION "{self.schema}".delete_after_ddl()''')
        before = self.rows()
        try:
            # Verify the global fixture executes hidden DML, then roll it back.
            with self.psycopg.connect(self.url) as connection:
                connection.execute(f'ALTER TABLE "{self.schema}".customers ADD COLUMN event_probe TEXT')
                self.assertEqual(connection.execute(f'SELECT count(*) FROM "{self.schema}".customers').fetchone(), (1,))
                connection.rollback()
            sql = "ALTER TABLE customers ADD COLUMN event_probe TEXT"
            with self.assertRaises(PermissionError):
                workbench.submit_request(self.member_session, sql, raw_sql=True)
            with patch.object(PostgresConnector, "check_workspace_effects", return_value=None):
                pending = self.prepare(sql)
            with self.assertRaises(PermissionError):
                self.confirm(pending)
            self.assertEqual(self.rows(), before)
            with self.psycopg.connect(self.url) as connection:
                self.assertEqual(connection.execute('''SELECT count(*) FROM information_schema.columns
                    WHERE table_schema=%s AND table_name='customers' AND column_name='event_probe' ''',
                    (self.schema,)).fetchone(), (0,))
        finally:
            with self.psycopg.connect(self.url) as connection:
                connection.execute(f'DROP EVENT TRIGGER "{event_name}"')

    def test_cascading_foreign_key_changes_are_blocked_for_limited_member(self):
        self.share(delete=True)
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'ALTER TABLE "{self.schema}".orders DROP CONSTRAINT orders_customer_id_fkey')
            connection.execute(f'''ALTER TABLE "{self.schema}".orders ADD CONSTRAINT cascade_customer
                FOREIGN KEY(customer_id) REFERENCES "{self.schema}".customers(id) ON DELETE SET NULL''')
            connection.execute(f'INSERT INTO "{self.schema}".orders VALUES(1,1)')
        with self.assertRaisesRegex(PermissionError, "database-side"):
            workbench.submit_request(self.member_session, "DELETE FROM customers WHERE id=1", raw_sql=True)
        self.assertEqual(len(self.rows()), 2)
        with self.psycopg.connect(self.url) as connection:
            self.assertEqual(connection.execute(f'SELECT customer_id FROM "{self.schema}".orders').fetchall(), [(1,)])

    def test_insert_select_cannot_hide_deletes_inside_a_source_view(self):
        self.share(write=True)
        with self.psycopg.connect(self.url) as connection:
            connection.execute(f'''CREATE FUNCTION "{self.schema}".delete_from_source() RETURNS text
                LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$ BEGIN
                DELETE FROM "{self.schema}".customers WHERE id=2; RETURN 'View-generated customer'; END; $$''')
            connection.execute(f'''CREATE VIEW "{self.schema}".dangerous_source AS
                SELECT "{self.schema}".delete_from_source() AS name, 'Kansas'::text AS state''')
        before = self.rows()
        with self.assertRaisesRegex(PermissionError, "database-side"):
            workbench.submit_request(self.member_session,
                "INSERT INTO customers(name,state) SELECT name,state FROM dangerous_source", raw_sql=True)
        self.assertEqual(self.rows(), before)


if __name__ == "__main__":
    unittest.main()
