# Phase I implementation model

The application has two SQLite roles. A connected database contains the user's actual tables and rows. The Data Genie repository stores identity, schema metadata, sessions, requests, generated SQL and saved outcomes. The repository is a separate file; ordinary user table contents are not mirrored into it. A saved query result can contain returned user values.

## Entity mapping

| Conceptual entity | Implementation meaning |
| --- | --- |
| USER | A local identity identified by email, with first and last names stored separately. Names form the composite Name attribute. |
| SESSION | A start time, an optional end time, one user and exactly one connected database. Switching databases opens a new session, then ends the previous one after success. |
| DATABASE | A registered SQLite file and its display name. Reconnecting the same file reuses its database identity. |
| TABLE | A table belonging to a database. Dropping it retains its repository identity with IsDropped set, so history still refers to it. |
| COLUMN | A weak entity identified by its owning table and column name. SQLite's declared type is retained. |
| REQUEST | The text submitted in a session, submission time and status. An unrecognized request remains visible as rejected without a generated command. |
| SQL_COMMAND | A single generated or explicitly submitted SQL statement, its request, confirmation requirement and execution state. |
| DDL_COMMAND | CREATE, ALTER or DROP, with its DDL operation. |
| DML_COMMAND | INSERT, UPDATE or DELETE, with its DML operation and affected row count after execution. |
| SELECT_COMMAND | A read command, with whether it contains an aggregation. |
| RESULT | One persisted outcome for a successfully executed command: table, summary or message. Reopening it displays the saved outcome without rerunning SQL. |

Each command belongs to exactly one specialization. One request can yield several commands. Each command can target several tables, with read, write or define access recorded for each target. Each executed command produces at most one result. Pending, declined and failed commands have no result.

Column constraints are multivalued metadata. Primary keys, NOT NULL, UNIQUE, defaults and available schema constraints are inspected from SQLite. Foreign-key references connect a referencing column to a referenced column. Phase I join suggestions cover single-column foreign keys; composite-key relationships are not inferred as a single-column link.

## Stored and derived values

Session Duration is computed from StartTime and EndTime. Database TableCount is computed from current, non-dropped tables. A table's current RowCount is counted from the connected database when inspected. These values are not maintained as mutable copies of user data. Historical results remain snapshots, so an old result can differ from a new query after rows change.

Schema metadata is refreshed after a connection and after successful structural changes. Dropped table metadata remains for historical targets. Recreating a table with the same name represents a new live table; the earlier dropped table remains part of history.

## Session and command semantics

Starting a session registers the user and database and inspects structure. Inspecting structure reads metadata and the database. Neither action creates a request, command or result. Ending a session records EndTime. A session can be ended without having submitted a request.

A user can attach an existing file or create a new database before the session starts. The interactive file prompt accepts `.create PATH [--empty]`, an existing path, or Enter for the demo. New databases start with a small `notes` table unless the user explicitly chooses a blank database. This initial setup belongs to connection setup; subsequent table changes use normal recorded requests and confirmations. Creating refuses existing destination files. A failed create or attach leaves the previous session active.

Functions that retrieve, calculate or change user data create a request and its generated SQL commands. Command patterns are deliberately fixed; there is no LLM or remote inference service. A request that fails translation is rejected and retained. A SQL command that fails execution is retained without a result. Multi-command requests preserve command order; they do not imply a transaction spanning the entire request.

All generated writes require review, including every DELETE and DROP required by the conceptual design. Confirmation refers to a persisted command in its original session and database. Declining preserves the request and command and executes no SQL for that command; later pending steps in the same request are also declined. CLI batch mode declines writes by default; `--yes` explicitly authorizes writes for that invocation.

Read results are limited to 500 rows, and truncation is reported. The saved result contains the displayed result, not a complete backup of every matched row. Result replay never silently runs a fresh query.

## Nine functions

| # | Function | CLI access |
| --- | --- | --- |
| 1 | Start a session and connect | Startup identity prompts or `--name`, `--email`; attach with `--database PATH` or create with `--create PATH [--empty]`. `.connect` and `.create` open another session. |
| 2 | Inspect structure | `.schema` shows tables, columns, types, constraints and foreign-key links. |
| 3 | Create tables | A supported `create table ...` description or `.sql CREATE TABLE ...`. |
| 4 | Insert records | `insert into ...` or `.sql INSERT ...`, subject to SQLite type and constraint checks. |
| 5 | Search and retrieve | Supported filters, selected columns, sorting, grouping and simple joins; `.sql SELECT ...` for explicit SQL. |
| 6 | Update and delete records | Supported `update ...` and `delete from ...`; review the generated SQL before confirmation. |
| 7 | Alter or drop tables | `add column ...` and `drop table ...`; successful changes refresh stored metadata. |
| 8 | Analyze data | Counts, totals, averages, minima, maxima and grouped comparisons. |
| 9 | Review history and end | `.history`, `.history --operation DELETE`, `.sessions`, `.result ID`, then `.quit` or EOF. |

## Operational assumptions

The HTTP server binds to the loopback interface and authenticates local browser accounts with passwords. Accounts and hashed login tokens live in the repository alongside the Phase I entities. An optional account foreign key on SESSION separates authenticated sessions from legacy and CLI identities. Authorization uses the account ID, and registering an existing metadata email does not claim its old sessions. The CLI remains a trusted local-file interface. See the README for password storage, login expiry, and recovery limitations.

The CLI opens existing or newly created database files directly, so confirmed changes modify those files. Use a copy when experimenting with an existing database. Browser uploads operate on server-side copies, and browser-created databases live in managed application storage. Download or export the resulting database to retain those changes outside the application. Exports use a consistent SQLite snapshot.

SQLite remains the source of truth for constraints and transaction behavior. Its flexible type affinity differs from strict type systems. Fixed patterns cannot interpret arbitrary prose, and explicit SQL is available for requests outside the pattern vocabulary.
