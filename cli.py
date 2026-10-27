"""Interactive Phase I interface for the shared Data Genie session service."""

import argparse
import json
from pathlib import Path
import shlex
import sqlite3
import sys

import workbench


HELP = """Type a supported request, or use a command:
  .schema                    Inspect tables, columns, constraints and foreign keys
  .history [text]            Search stored requests and SQL; view results
  .history --operation DELETE [--session ID] [text]
  .sessions                  List your earlier sessions
  .result COMMAND_ID         Display a stored command result again
  .sql SQL                   Submit one SQL statement
  .connect PATH              Attach an existing SQLite file in a new session
  .create PATH [--empty]     Create a new database and start a session
  .export PATH               Save a consistent SQLite copy to a new destination
  .help                      Show this help
  .quit                      Save the session end time and exit

Examples:
  show notes
  insert into notes title='My note', body='Meeting notes'
  show sales where units > 2 sort by revenue desc
  average revenue by product_id in sales
  create table tasks (id INTEGER PRIMARY KEY, body TEXT NOT NULL)
  insert into tasks body='Meeting notes'
  delete from tasks where id=1

Generated writes are previewed and require confirmation.
"""


def _cell(value):
    if value is None:
        return "NULL"
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, ensure_ascii=False, default=str)
    return str(value).replace("\r", "\\r").replace("\n", "\\n").replace("\t", "\\t")


def print_table(rows, output):
    """Print dictionaries as a readable table without third-party packages."""
    if not rows:
        print("(No rows.)", file=output)
        return
    columns = list(dict.fromkeys(key for row in rows for key in row))
    rendered = [[_cell(row.get(key)) for key in columns] for row in rows]
    widths = [min(48, max(len(str(key)), *(len(row[i]) for row in rendered)))
              for i, key in enumerate(columns)]

    def line(values):
        cells = []
        for value, width in zip(values, widths):
            value = str(value)
            if len(value) > width:
                value = value[:width - 3] + "..."
            cells.append(value.ljust(width))
        return " | ".join(cells)

    print(line(columns), file=output)
    print("-+-".join("-" * width for width in widths), file=output)
    for row in rendered:
        print(line(row), file=output)
    print(f"{len(rows)} row(s)", file=output)


def _commands(response):
    return response.get("commands") or [response]


def _command_id(command):
    return command.get("command_id", command.get("id"))


def _result_payload(command):
    result = command.get("result")
    if isinstance(result, dict):
        payload = result.get("payload")
        return payload if isinstance(payload, dict) else result
    return command


class Console:
    def __init__(self, first_name, last_name, email, *, input_fn=input, output=None,
                 assume_yes=False, interactive=True):
        self.first_name = first_name
        self.last_name = last_name
        self.email = email
        self.input = input_fn
        self.output = output or sys.stdout
        self.assume_yes = assume_yes
        self.interactive = interactive
        self.session_id = None

    def say(self, message):
        print(message, file=self.output)

    def start(self, path=None):
        if path is not None and not Path(path).expanduser().is_file():
            raise ValueError(f"Database file does not exist: {path}. Use --create PATH or .create PATH to create it.")
        session = workbench.start_session(self.first_name, self.last_name, self.email,
                                       path=path, use_demo=path is None)
        return self._activate(session)

    def create(self, path, *, starter=True):
        session = workbench.create_database_session(self.first_name, self.last_name, self.email,
                                                    path=path, starter=starter)
        return self._activate(session)

    def _activate(self, session):
        previous_session_id = self.session_id
        self.session_id = session["session_id"]
        if previous_session_id is not None and previous_session_id != self.session_id:
            workbench.end_session(previous_session_id)
            self.say(f"Session {previous_session_id} ended.")
        database = session.get("database", "SQLite database")
        if isinstance(database, dict):
            database = database.get("name", database.get("database_name", str(database)))
        self.say(f"Session {self.session_id} connected to {database}.")
        return session

    def close(self):
        if self.session_id is not None:
            session_id, self.session_id = self.session_id, None
            workbench.end_session(session_id)
            self.say(f"Session {session_id} ended.")

    def display_result(self, command, *, show_sql=True):
        payload = _result_payload(command)
        sql = payload.get("sql") or command.get("sql") or command.get("sql_text")
        if sql and show_sql:
            self.say(f"SQL: {sql}")
        message = payload.get("message") or payload.get("answer") or payload.get("output_text")
        if message:
            self.say(str(message))
        rows = payload.get("rows")
        if rows is not None and (rows or command.get("operation") in ("read", "SELECT")):
            print_table(rows, self.output)
        changes = payload.get("changes")
        if changes is not None and not rows and not message:
            self.say(f"{changes} row(s) affected.")
        if payload.get("truncated"):
            self.say("Result limit reached; only the first 500 rows are shown and stored.")
        if command.get("error"):
            self.say(f"Error: {command['error']}")

    def submit(self, text, *, raw_sql=False):
        if self.session_id is None:
            raise ValueError("No active session. Use .connect PATH or .create PATH.")
        response = workbench.submit_request(self.session_id, text, raw_sql=raw_sql)
        if not response.get("matched", True):
            raise ValueError(response.get("error") or response.get("message") or response.get("answer") or "Request rejected.")
        commands = _commands(response)
        for index, command in enumerate(commands):
            if command.get("status") in ("blocked", "failed", "rejected") and not command.get("requires_confirmation"):
                self.display_result(command)
                continue
            self.display_result(command)
            if not command.get("requires_confirmation"):
                continue
            command_id = _command_id(command)
            token = command.get("confirmation_token")
            confirmed = self.assume_yes
            if not confirmed and self.interactive:
                confirmed = self.input("Run this command? [y/N] ").strip().lower() in {"y", "yes"}
            if confirmed:
                result = workbench.confirm_command(self.session_id, command_id, token)
                self.display_result(result, show_sql=False)
            else:
                workbench.decline_command(self.session_id, command_id, token)
                self.say(f"Command {command_id} declined; it did not run.")
                if index + 1 < len(commands):
                    self.say("The remaining commands in this request were also declined.")
                break

    def schema(self):
        schema = workbench.schema_for_session(self.session_id)
        self.say(f"Database: {schema.get('database', '')}")
        for table in schema.get("tables", []):
            if not isinstance(table, dict):
                self.say(str(table))
                continue
            self.say(f"\n{table.get('name', table.get('table_name', 'table'))} "
                     f"({table.get('row_count', '?')} rows)")
            columns = []
            for column in table.get("columns", []):
                constraints = column.get("constraints", [])
                if column.get("constraint_details"):
                    constraints = ", ".join(
                        detail["constraint_type"] + (f" ({detail['definition']})" if detail.get("definition") else "")
                        for detail in column["constraint_details"])
                elif isinstance(constraints, list):
                    constraints = ", ".join(map(str, constraints))
                columns.append({"column": column.get("name", column.get("column_name")),
                                "type": column.get("type", column.get("data_type")),
                                "constraints": constraints})
            print_table(columns, self.output)
            for foreign_key in table.get("foreign_keys", table.get("references", [])):
                if isinstance(foreign_key, dict) and "referenced_table_name" in foreign_key:
                    self.say(f"Foreign key: {foreign_key['column_name']} -> "
                             f"{foreign_key['referenced_table_name']}.{foreign_key.get('referenced_column_name') or '(primary key)'} "
                             f"(on update {foreign_key.get('on_update', 'NO ACTION')}; "
                             f"on delete {foreign_key.get('on_delete', 'NO ACTION')})")
                else:
                    self.say("Foreign key: " + _cell(foreign_key))
        if not schema.get("tables"):
            self.say("(No tables.)")

    def history(self, argument=""):
        parts = shlex.split(argument)
        search, operation, history_session_id = [], None, None
        while parts:
            token = parts.pop(0)
            if token in {"--operation", "--session"}:
                if not parts:
                    raise ValueError(f"{token} requires a value.")
                value = parts.pop(0)
                if token == "--operation":
                    operation = value.upper()
                else:
                    history_session_id = value
            else:
                search.append(token)
        history = workbench.history_for_session(self.session_id, search=" ".join(search),
                                             operation=operation, history_session_id=history_session_id)
        rows = []
        for request in history:
            commands = request.get("commands", [])
            if not commands:
                rows.append({"request": request.get("request_id"), "command": "",
                             "status": request.get("status"), "request text": request.get("text", ""),
                             "SQL": "", "result": ""})
            for command in commands:
                payload = _result_payload(command)
                result = command.get("result")
                summary = ""
                if result:
                    summary = payload.get("message") or payload.get("answer") or payload.get("output_text")
                    if not summary:
                        summary = (f"{len(payload['rows'])} stored row(s)" if "rows" in payload
                                   else f"{payload.get('changes', 0)} row(s) affected")
                rows.append({"request": request.get("request_id"), "command": _command_id(command),
                             "status": command.get("status", request.get("status")),
                             "request text": request.get("text", ""),
                             "SQL": command.get("sql", command.get("sql_text", "")), "result": summary})
        print_table(rows, self.output)

    def result(self, command_id):
        if not command_id:
            raise ValueError("Use .result COMMAND_ID.")

        def histories():
            yield workbench.history_for_session(self.session_id)
            for session in workbench.list_user_sessions(self.email):
                if session["session_id"] != self.session_id:
                    yield workbench.history_for_session(self.session_id, history_session_id=session["session_id"])

        for history in histories():
            for request in history:
                for command in request.get("commands", []):
                    if str(_command_id(command)) == str(command_id):
                        if not command.get("result"):
                            self.say(f"Command {command_id} has no stored result ({command.get('status', 'not executed')}).")
                        else:
                            self.display_result(command)
                        return
        self.say(f"No command {command_id} appears in your history.")

    def handle(self, text):
        """Return False when the caller should stop reading commands."""
        text = text.strip()
        if not text:
            return True
        command, _, argument = text.partition(" ")
        argument = argument.strip()
        if command in {".quit", ".exit"}:
            return False
        if command == ".help":
            self.say(HELP)
        elif command == ".connect":
            if not argument:
                raise ValueError("Use .connect PATH.")
            self.start(_path_argument(argument))
        elif command == ".create":
            path, starter = _creation_argument(argument)
            self.create(path, starter=starter)
        elif self.session_id is None:
            raise ValueError("No active session. Use .connect PATH or .create PATH.")
        elif command == ".schema":
            self.schema()
        elif command == ".history":
            self.history(argument)
        elif command == ".sessions":
            print_table(workbench.list_user_sessions(self.email), self.output)
        elif command == ".result":
            self.result(argument)
        elif command == ".export":
            if not argument:
                raise ValueError("Use .export PATH.")
            destination = workbench.export_database(self.session_id, Path(argument).expanduser().resolve())
            self.say(f"Database copy saved to {destination}.")
        elif command == ".sql":
            if not argument:
                raise ValueError("Use .sql followed by one SQL statement.")
            self.submit(argument, raw_sql=True)
        elif command.startswith("."):
            raise ValueError(f"Unknown command {command}. Type .help for available commands.")
        else:
            self.submit(text)
        return True


def _path_argument(argument):
    if argument.startswith(("'", '"')):
        parts = shlex.split(argument)
        if len(parts) != 1:
            raise ValueError("Use a single file path, quoted when it contains spaces.")
        argument = parts[0]
    return Path(argument).expanduser().resolve()


def _creation_argument(argument):
    starter = True
    if argument.endswith(" --empty"):
        argument = argument[:-len(" --empty")].rstrip()
        starter = False
    if not argument or argument == "--empty":
        raise ValueError("Use .create PATH [--empty].")
    return _path_argument(argument), starter


def argument_parser():
    parser = argparse.ArgumentParser(description="Data Genie: a local SQLite command-line assistant.")
    database_choice = parser.add_mutually_exclusive_group()
    database_choice.add_argument("--database", type=Path, help="Attach an existing SQLite file (edits apply to this original file).")
    database_choice.add_argument("--create", type=Path, metavar="PATH", help="Create a new SQLite file, starting with a notes table.")
    parser.add_argument("--empty", action="store_true", help="With --create, create a blank database without a starter table.")
    parser.add_argument("--name", help="Your full name; prompted when omitted in interactive mode.")
    parser.add_argument("--email", help="Your email; identifies your stored sessions and history.")
    parser.add_argument("--repository", type=Path, help="Separate SQLite repository file for structure and history.")
    parser.add_argument("--execute", action="append", metavar="REQUEST", help="Run a request or dot command; repeatable.")
    parser.add_argument("--yes", action="store_true", help="Explicitly confirm generated writes for this invocation.")
    return parser


def main(argv=None, *, input_fn=input, output=None):
    args = argument_parser().parse_args(argv)
    output = output or sys.stdout
    console = None
    interactive = args.execute is None
    creating = args.create is not None
    starter = not args.empty
    try:
        if args.empty and args.create is None:
            raise ValueError("--empty requires --create PATH.")
        if args.repository:
            workbench.REPOSITORY_PATH = args.repository.expanduser().resolve()
        if interactive:
            if args.name:
                first_name, _, last_name = args.name.strip().partition(" ")
            else:
                first_name = input_fn("First name: ").strip()
                last_name = input_fn("Last name: ").strip()
            email = (args.email or input_fn("Email: ")).strip()
            database = args.create if args.create is not None else args.database
            if database is None:
                selected = input_fn("SQLite file path to attach (Enter for demo; .create PATH creates a new file): ").strip()
                parts = selected.split(maxsplit=1)
                if parts and parts[0] == ".create":
                    database, starter = _creation_argument(parts[1] if len(parts) > 1 else "")
                    creating = True
                else:
                    database = _path_argument(selected) if selected else None
        else:
            if not args.name or not args.email:
                raise ValueError("--execute requires --name and --email.")
            first_name, _, last_name = args.name.strip().partition(" ")
            email = args.email.strip()
            database = args.create if args.create is not None else args.database
        if not first_name or not email:
            raise ValueError("A name and email are required.")
        console = Console(first_name, last_name.strip(), email, input_fn=input_fn,
                          output=output, assume_yes=args.yes, interactive=interactive)
        if database is not None:
            database = database.expanduser().resolve()
        if creating:
            console.create(database, starter=starter)
        else:
            console.start(database)
        if interactive:
            console.say("Type .help for commands. Writes to a selected file change that original file.")
            while True:
                try:
                    if not console.handle(input_fn("genie> ")):
                        break
                except (ValueError, sqlite3.Error, OSError) as exc:
                    console.say(f"Error: {exc}")
        else:
            for request in args.execute:
                if not console.handle(request):
                    break
        return 0
    except (EOFError, KeyboardInterrupt):
        print("\nLeaving Data Genie.", file=output)
        return 0
    except (ValueError, sqlite3.Error, OSError) as exc:
        print(f"Error: {exc}", file=output)
        return 1
    finally:
        if console is not None:
            try:
                console.close()
            except (ValueError, sqlite3.Error, OSError) as exc:
                print(f"Error ending session: {exc}", file=output)


if __name__ == "__main__":
    raise SystemExit(main())
