"""Contract checks for CLI session lifecycle, review and history behavior."""

from contextlib import closing
import io
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import cli


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.console = cli.Console("Ada", "Lovelace", "ada@example.com", output=self.output,
                                   interactive=False)
        self.console.session_id = 12

    def test_noninteractive_write_declines_without_yes(self):
        pending = {"matched": True, "sql": "DELETE FROM notes", "operation": "write",
                   "command_id": 8, "confirmation_token": "review", "requires_confirmation": True}
        with patch.object(cli.workbench, "submit_request", return_value=pending, create=True), \
             patch.object(cli.workbench, "confirm_command", create=True) as confirm, \
             patch.object(cli.workbench, "decline_command", create=True) as decline:
            self.console.submit("delete from notes")
        confirm.assert_not_called()
        decline.assert_called_once_with(12, 8, "review")
        self.assertIn("SQL: DELETE FROM notes", self.output.getvalue())
        self.assertIn("did not run", self.output.getvalue())

    def test_explicit_yes_confirms_each_command(self):
        self.console.assume_yes = True
        commands = [{"command_id": value, "confirmation_token": f"token-{value}",
                     "sql": "INSERT INTO notes VALUES (1)", "requires_confirmation": True}
                    for value in (8, 9)]
        with patch.object(cli.workbench, "submit_request", return_value={"commands": commands}, create=True), \
             patch.object(cli.workbench, "confirm_command", return_value={"changes": 1}, create=True) as confirm:
            self.console.submit("insert into notes id=1 then insert into notes id=2")
        self.assertEqual(confirm.call_count, 2)
        self.assertEqual(confirm.call_args_list[0].args, (12, 8, "token-8"))
        self.assertEqual(confirm.call_args_list[1].args, (12, 9, "token-9"))

    def test_interactive_confirmation_defaults_to_decline(self):
        self.console.interactive = True
        self.console.input = lambda prompt: ""
        pending = {"command_id": 8, "confirmation_token": "review", "requires_confirmation": True}
        with patch.object(cli.workbench, "submit_request", return_value=pending, create=True), \
             patch.object(cli.workbench, "decline_command", create=True) as decline:
            self.console.submit("delete from notes")
        decline.assert_called_once_with(12, 8, "review")

    def test_declining_first_step_skips_stale_later_commands(self):
        self.console.interactive = True
        prompts = []
        self.console.input = lambda prompt: prompts.append(prompt) or "no"
        commands = [{"command_id": value, "confirmation_token": f"token-{value}",
                     "requires_confirmation": True} for value in (8, 9)]
        with patch.object(cli.workbench, "submit_request", return_value={"commands": commands}), \
             patch.object(cli.workbench, "decline_command") as decline, \
             patch.object(cli.workbench, "confirm_command") as confirm:
            self.console.submit("create table notes then insert into notes id=1")
        self.assertEqual(len(prompts), 1)
        decline.assert_called_once_with(12, 8, "token-8")
        confirm.assert_not_called()

    def test_stored_result_is_displayed_without_reexecuting(self):
        history = [{"text": "show notes", "commands": [{"command_id": 8,
                    "sql": "SELECT body FROM notes", "operation": "read",
                    "result": {"result_type": "table", "payload": {"rows": [{"body": "Saved answer"}]}}}]}]
        with patch.object(cli.workbench, "history_for_session", return_value=history, create=True), \
             patch.object(cli.workbench, "submit_request", create=True) as submit:
            self.console.handle(".result 8")
        submit.assert_not_called()
        self.assertIn("Saved answer", self.output.getvalue())

    def test_result_from_an_earlier_session_is_displayed(self):
        history = [{"commands": [{"command_id": 8, "result": {"payload": {"rows": [{"saved": "previous session"}]}}}]}]
        with patch.object(cli.workbench, "history_for_session", side_effect=[[], history]) as stored, \
             patch.object(cli.workbench, "list_user_sessions", return_value=[{"session_id": 5}]):
            self.console.handle(".result 8")
        self.assertEqual(stored.call_args_list[1].kwargs, {"history_session_id": 5})
        self.assertIn("previous session", self.output.getvalue())

    def test_history_passes_search_and_filters(self):
        with patch.object(cli.workbench, "history_for_session", return_value=[], create=True) as history:
            self.console.handle(".history --operation DELETE --session 5 notes")
        history.assert_called_once_with(12, search="notes", operation="DELETE", history_session_id="5")

    def test_switch_validates_new_session_before_ending_old(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "next.sqlite3"
            path.touch()
            calls = []
            with patch.object(cli.workbench, "end_session", side_effect=lambda sid: calls.append(("end", sid)), create=True), \
                 patch.object(cli.workbench, "start_session", side_effect=lambda *a, **kw: calls.append(("start", kw["path"])) or
                              {"session_id": 13, "database": "next.sqlite3"}, create=True):
                self.console.handle(f".connect {path}")
            self.assertEqual(calls, [("start", path.resolve()), ("end", 12)])
            self.assertEqual(self.console.session_id, 13)

    def test_failed_attach_keeps_current_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.sqlite3"
            path.write_text("not a database")
            with patch.object(cli.workbench, "start_session", side_effect=ValueError("Not a SQLite file")), \
                 patch.object(cli.workbench, "end_session") as end:
                with self.assertRaisesRegex(ValueError, "Not a SQLite"):
                    self.console.handle(f".connect {path}")
            end.assert_not_called()
            self.assertEqual(self.console.session_id, 12)

    def test_create_switch_preserves_current_session_when_creation_fails(self):
        with patch.object(cli.workbench, "create_database_session", side_effect=ValueError("File already exists"), create=True), \
             patch.object(cli.workbench, "end_session") as end:
            with self.assertRaisesRegex(ValueError, "already exists"):
                self.console.handle(".create existing.sqlite3")
        end.assert_not_called()
        self.assertEqual(self.console.session_id, 12)

    def test_metadata_does_not_create_request(self):
        with patch.object(cli.workbench, "schema_for_session", return_value={"database": "test", "tables": []}, create=True), \
             patch.object(cli.workbench, "submit_request", create=True) as submit:
            self.console.handle(".schema")
        submit.assert_not_called()


class MainTests(unittest.TestCase):
    def test_eof_still_ends_session(self):
        with patch.object(cli.workbench, "start_session", return_value={"session_id": 12, "database": "demo"}, create=True), \
             patch.object(cli.workbench, "end_session", create=True) as end:
            code = cli.main(["--name", "Ada Lovelace", "--email", "ada@example.com"],
                            input_fn=self.answer,
                            output=io.StringIO())
        self.assertEqual(code, 0)
        end.assert_called_once_with(12)

    @staticmethod
    def answer(prompt):
        if prompt.startswith("SQLite"):
            return ""
        raise EOFError

    def test_noninteractive_requires_identity(self):
        output = io.StringIO()
        code = cli.main(["--execute", "show notes"], output=output)
        self.assertEqual(code, 1)
        self.assertIn("--name and --email", output.getvalue())

    def test_empty_requires_explicit_creation(self):
        output = io.StringIO()
        code = cli.main(["--empty", "--name", "Ada Lovelace", "--email", "ada@example.com", "--execute", ".schema"],
                        output=output)
        self.assertEqual(code, 1)
        self.assertIn("--empty requires --create", output.getvalue())

    def test_error_still_ends_session(self):
        with patch.object(cli.workbench, "start_session", return_value={"session_id": 12, "database": "demo"}, create=True), \
             patch.object(cli.workbench, "end_session", create=True) as end, \
             patch.object(cli.workbench, "submit_request", side_effect=ValueError("Invalid command"), create=True):
            code = cli.main(["--name", "Ada Lovelace", "--email", "ada@example.com", "--execute", "show notes"],
                            output=io.StringIO())
        self.assertEqual(code, 1)
        end.assert_called_once_with(12)

    def test_rejected_batch_request_returns_failure(self):
        output = io.StringIO()
        with patch.object(cli.workbench, "start_session", return_value={"session_id": 12, "database": "demo"}), \
             patch.object(cli.workbench, "end_session") as end, \
             patch.object(cli.workbench, "submit_request", return_value={"matched": False, "message": "No matching command pattern"}):
            code = cli.main(["--name", "Ada Lovelace", "--email", "ada@example.com", "--execute", "unknown request"],
                            output=output)
        self.assertEqual(code, 1)
        self.assertIn("No matching command pattern", output.getvalue())
        end.assert_called_once_with(12)


class RealConsoleTests(unittest.TestCase):
    """Exercise the public CLI against the real service using only temp files."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="data-genie-cli-test-")
        self.root = Path(self.directory.name)
        self.database = self.root / "source.sqlite3"
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("CREATE TABLE seed(id INTEGER PRIMARY KEY)")
        self.repository_patch = patch.object(cli.workbench, "REPOSITORY_PATH", self.root / "repository.sqlite3")
        self.repository_patch.start()
        self.arguments = ["--database", str(self.database), "--name", "CLI Tester", "--email", "cli@example.com"]

    def tearDown(self):
        self.repository_patch.stop()
        self.directory.cleanup()

    def test_batch_create_insert_history_replay_export_and_end(self):
        exported = self.root / "export.sqlite3"
        output = io.StringIO()
        code = cli.main(self.arguments + ["--yes", "--execute",
                        "create table notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) then insert into notes body='First note'",
                        "--execute", "show notes", "--execute", ".schema", "--execute", ".history",
                        "--execute", f".export {exported}"],
                        output=output)
        self.assertEqual(code, 0, output.getvalue())
        self.assertIn("1 row(s) affected", output.getvalue())
        for path in (self.database, exported):
            with closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute("SELECT body FROM notes").fetchall(), [("First note",)])
        sessions = cli.workbench.list_user_sessions("cli@example.com")
        self.assertTrue(sessions[0]["ended_at"])
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute("UPDATE notes SET body='Changed since result'")
        replay = io.StringIO()
        code = cli.main(self.arguments + ["--execute", ".result 3"], output=replay)
        self.assertEqual(code, 0, replay.getvalue())
        self.assertIn("First note", replay.getvalue())
        self.assertNotIn("Changed since result", replay.getvalue())

    def test_declined_multi_command_request_never_changes_source(self):
        output = io.StringIO()
        console = cli.Console("CLI", "Tester", "cli@example.com", output=output,
                              input_fn=lambda prompt: "n", interactive=True)
        console.start(self.database)
        session_id = console.session_id
        try:
            console.submit("create table notes (id INTEGER PRIMARY KEY, body TEXT) then insert into notes body='Declined'")
            history = cli.workbench.history_for_session(session_id)
            self.assertEqual([command["status"] for command in history[0]["commands"]], ["declined", "declined"])
            self.assertTrue(all(command["result"] is None for command in history[0]["commands"]))
        finally:
            console.close()
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("seed",)])

    def test_startup_creates_a_database_with_starter_table(self):
        created = self.root / "created.sqlite3"
        output = io.StringIO()
        code = cli.main(["--create", str(created), "--name", "CLI Tester", "--email", "cli@example.com",
                         "--execute", ".schema"], output=output)
        self.assertEqual(code, 0, output.getvalue())
        with closing(sqlite3.connect(created)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").fetchall(), [("notes",)])
        self.assertTrue(cli.workbench.list_user_sessions("cli@example.com")[0]["ended_at"])

    def test_startup_creates_a_blank_database_when_requested(self):
        created = self.root / "blank.sqlite3"
        output = io.StringIO()
        code = cli.main(["--create", str(created), "--empty", "--name", "CLI Tester", "--email", "cli@example.com",
                         "--execute", ".schema"], output=output)
        self.assertEqual(code, 0, output.getvalue())
        with closing(sqlite3.connect(created)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [])

    def test_interactive_database_prompt_accepts_create_command(self):
        for blank in (False, True):
            with self.subTest(blank=blank):
                created = self.root / ("blank from prompt.sqlite3" if blank else "starter from prompt.sqlite3")
                selected = f'.create "{created}"' + (" --empty" if blank else "")
                answers = iter([selected, ".schema", ".quit"])
                output = io.StringIO()
                code = cli.main(["--name", "CLI Tester", "--email", "cli@example.com"],
                                input_fn=lambda prompt: next(answers), output=output)
                self.assertEqual(code, 0, output.getvalue())
                self.assertTrue(created.exists())
                with closing(sqlite3.connect(created)) as connection:
                    tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
                self.assertEqual(tables, [] if blank else [("notes",)])
                self.assertNotIn("Error:", output.getvalue())

    def test_create_command_switches_to_new_blank_database(self):
        created = self.root / "new database.sqlite3"
        console = cli.Console("CLI", "Tester", "cli@example.com", output=io.StringIO())
        console.start(self.database)
        original_session_id = console.session_id
        try:
            console.handle(f'.create "{created}" --empty')
            self.assertNotEqual(console.session_id, original_session_id)
            self.assertTrue(cli.workbench.get_repository().get_session(original_session_id)["ended_at"])
            self.assertEqual(cli.workbench.schema_for_session(console.session_id)["tables"], [])
        finally:
            console.close()
        self.assertTrue(created.exists())

    def test_missing_database_suggests_creation_without_creating_a_file(self):
        missing = self.root / "missing.sqlite3"
        output = io.StringIO()
        code = cli.main(["--database", str(missing), "--name", "CLI Tester", "--email", "cli@example.com",
                         "--execute", ".schema"], output=output)
        self.assertEqual(code, 1)
        self.assertIn("--create PATH", output.getvalue())
        self.assertFalse(missing.exists())

    def test_invalid_real_attachment_keeps_the_previous_session_active(self):
        console = cli.Console("CLI", "Tester", "cli@example.com", output=io.StringIO())
        console.start(self.database)
        original_session_id = console.session_id
        invalid = self.root / "invalid.sqlite3"
        invalid.write_text("not a SQLite file")
        try:
            with self.assertRaises(ValueError):
                console.handle(f".connect {invalid}")
            self.assertEqual(console.session_id, original_session_id)
            self.assertIsNone(cli.workbench.get_repository().get_session(original_session_id)["ended_at"])
            self.assertEqual(cli.workbench.schema_for_session(original_session_id)["tables"][0]["name"], "seed")
        finally:
            console.close()


if __name__ == "__main__":
    unittest.main()
