# Phase I implementation model

This document maps the Phase I entities to the current implementation. Use the [hosted app](https://data-genie.space/), its [FAQ](https://data-genie.space/faq), or the [README](../README.md) for getting started.

A connected SQLite database or live PostgreSQL database contains the user's tables and rows. A separate SQLite application repository stores accounts, identity, schema metadata, sessions, requests, generated SQL, encrypted connection settings, and saved outcomes. Ordinary connected-table contents are not mirrored into that repository, but a saved query result contains the returned values.

In the Azure installation, SQLite runs on temporary scratch disk and Azure SQL stores bounded snapshots of the application state for recovery. Azure SQL is internal persistence here; it is not an additional database connector offered in the browser. See [Azure storage and limits](azure-free-hosting.md#storage-and-free-tier-limits).

## Entity mapping

| Conceptual entity | Implementation meaning |
| --- | --- |
| USER | A Phase I metadata identity identified by email, with first and last names stored separately. Password accounts are separate records; browser authorization uses account IDs, not email matching alone. |
| SESSION | A start time, an optional end time, one metadata user and exactly one connected database. Browser sessions also belong to an account. Switching databases opens the new database successfully before ending the previous session. |
| DATABASE | A registered SQLite file or saved PostgreSQL connection and its display name. Reopening a saved database reuses its database identity. |
| TABLE | A table belonging to a database. Dropping it retains its repository identity with IsDropped set, so history still refers to it. |
| COLUMN | A weak entity identified by its owning table and column name. The provider's declared type is retained. |
| REQUEST | The text submitted in a session, submission time and status. An unrecognized request remains visible as rejected without a generated command. |
| SQL_COMMAND | A single generated or explicitly submitted SQL statement, its request, confirmation requirement and execution state. |
| DDL_COMMAND | CREATE, ALTER or DROP, with its DDL operation. |
| DML_COMMAND | INSERT, UPDATE or DELETE, plus SQLite REPLACE, with its DML operation and affected row count after execution. |
| SELECT_COMMAND | A read command, with whether it contains an aggregation. |
| RESULT | One persisted outcome for a successfully executed command: table, summary or message. Reopening it displays the saved outcome without rerunning SQL. |

Each command belongs to exactly one specialization. One request can yield several commands. Each command can target several tables, with read, write or define access recorded for each target. Each executed command produces at most one result. Pending, declined and failed commands have no result.

Column constraints are multivalued metadata. Primary keys, NOT NULL, UNIQUE, defaults, available schema constraints, and foreign keys are inspected from the connected provider. PostgreSQL discovery includes readable tables and views within one selected schema. Foreign-key references connect a referencing column to a referenced column. Keyword join suggestions cover single-column foreign keys; composite-key relationships are not inferred as a single-column link.

## Stored and derived values

Session Duration is computed from StartTime and EndTime. Database TableCount is computed from current, non-dropped tables, including readable PostgreSQL views. SQLite RowCount is counted when inspected; PostgreSQL schema counts are estimates from server statistics and are marked `~`. An explicit count request reads current data. These values are not maintained as mutable copies of user rows. Historical results remain snapshots, so an old result can differ from a new query after rows change.

Schema metadata is refreshed after a connection and after successful structural changes. Dropped table metadata remains for historical targets. Recreating a table with the same name represents a new live table; the earlier dropped table remains part of history.

## Session and command semantics

Starting a session registers the metadata identity and database and inspects structure. Browser users must first create an account or log in. Inspecting structure reads metadata and the database. Structure-only requests and table inventories do not create stored requests, commands or results in History. Ending a session records EndTime and keeps the browser login and saved History. A session can be ended without having submitted a request.

In the browser, [Databases](https://data-genie.space/databases) offers SQLite upload, an empty new SQLite database, an optional example `notes` table, a sample database, and PostgreSQL. In the separate local CLI, the file prompt accepts `.create PATH [--empty]`, an existing path, or Enter for the demo. CLI creation includes the `notes` starter unless `--empty` is supplied. This initial setup belongs to connection setup; subsequent table changes use normal recorded requests and confirmations. Creating refuses existing destination files. A failed create or attach leaves the previous session active.

Functions that retrieve, calculate or change user data create a request and its SQL commands. Browser users ask Data Genie AI in Ask, enter SQL in the SQL tab, or use the forms in Structure to add, rename, or delete tables and columns. The SQL parser validates explicit statements; all writes still require confirmation. Data Genie sends the configured AI service the current database structure, SQL dialect, and recent conversation context. The local CLI and legacy API retain Keywords with supported local patterns and narrower follow-ups. A request that fails translation is rejected and retained without inventing a query. A SQL command that fails execution is retained without a result. Multi-command requests preserve command order; they do not imply a transaction spanning the entire request.

All generated writes require review, including every DELETE and DROP required by the conceptual design. Confirmation refers to a persisted command in its original session and database. SQLite write previews use a temporary copy; PostgreSQL preparation never executes the write. PostgreSQL connections also start read-only and must have changes enabled before a write can be prepared. Declining preserves the request and command and executes no SQL for that command; later pending steps in the same request are also declined. CLI batch mode declines writes by default; `--yes` explicitly authorizes writes for that invocation.

A saved read result contains at most 500 rows, and truncation is reported. Keyword previews normally start with 50 rows, and the browser can fetch additional result pages from current data where supported. Loaded pages do not rewrite the saved result. History replay shows the stored snapshot without rerunning SQL; it is not a complete database backup.

The workspace keeps a recent cache of 50 requests plus unresolved changes, renders eight latest requests or batches of ten earlier requests, and mounts older completed results only when opened. The full saved record remains in History, which requests 20 records per page. The history API applies its limit before loading command/result payloads; callers can also retrieve one request or include pending requests outside a page. AI conversation context remains separately bounded to eight turns and excludes result-row payloads.

## Nine functions

The browser exposes these flows through [Workspace](https://data-genie.space/app), its Structure tab, [History](https://data-genie.space/history), and [Databases](https://data-genie.space/databases). The CLI access below is for local SQLite files:

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

The local development HTTP server binds to loopback. The hosted installation uses the WSGI adapter behind HTTPS. Both authenticate browser accounts with passwords; accounts and hashed login tokens live in that installation's repository alongside the Phase I entities. An optional account foreign key on SESSION separates authenticated sessions from legacy and CLI identities. Authorization uses the account ID, and registering an existing metadata email does not claim its old sessions. The CLI remains a trusted local-file interface and does not log in to the hosted app. See [Security](../SECURITY.md) for password storage, login expiry, and recovery limitations.

The CLI opens existing or newly created SQLite files directly, so confirmed changes modify those files. Browser uploads operate on server-side copies, and browser-created databases live in managed application storage. Download or export the resulting SQLite database to retain those changes outside the application. Exports use a consistent SQLite snapshot. PostgreSQL connections operate on the live server: confirmed changes are saved there directly. CSV exports are result copies, not PostgreSQL backups.

The connected database enforces its constraints and transaction behavior. SQLite's flexible type affinity differs from PostgreSQL's types and permissions. Keywords cannot interpret arbitrary prose; Data Genie AI supports broader language but its SQL still passes validation and the confirmation flow. Neither History nor ending a session provides automatic undo.
