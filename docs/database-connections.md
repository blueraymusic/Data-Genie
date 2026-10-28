# Database connections

Data Genie supports local SQLite files and live PostgreSQL databases, including standard PostgreSQL connections from Supabase and Neon. The current connector uses PostgreSQL's native database protocol. It does not include an MCP client or server, and you do not need an MCP server to connect.

## Connect

Install `requirements-postgres.txt` in a Python 3.10+ virtual environment and restart the app with that environment's Python. Choose **PostgreSQL** on the Databases page, paste a URL containing the username and password, and choose a schema (usually `public`). **Test connection** checks access without saving credentials or changing data. **Connect PostgreSQL** saves the connection for your account.

Remote hosts use certificate-verified SSL by default. Provider URLs can specify `sslmode=require` or `sslmode=verify-full`; SSL can be disabled only for loopback hosts. `channel_binding` is preserved, including the `require` value supplied by [Neon's connection strings](https://neon.com/blog/postgres-needs-better-connection-security-defaults). `sslrootcert=system` enables full verification with system certificates. File-based libpq options and arbitrary connection parameters are not accepted.

## Live changes and exports

PostgreSQL is a live connection. Reads query that server; confirmed edits are saved there directly and can be seen by other apps using the same database. There is no download or upload step to save changes. The local demo works the same way, against its own local PostgreSQL database.

To edit, add a connection with **Allow changes after I confirm them** checked. Then ask for a change, review the SQL, and use its confirmation button. An existing read-only connection keeps its original setting. Your PostgreSQL user's permissions still apply, and ending a Data Genie session does not undo confirmed changes.

**Download CSV** exports the rows currently loaded in a result, in their displayed order. **Download SQLite file** applies only to SQLite connections. Data Genie does not export a full PostgreSQL backup or provide automatic undo; keep full database backups separately.

## Work with data

- Schema discovery includes readable tables and views, columns, primary keys, unique/check constraints, and foreign keys. Each connection uses one schema.
- Schema row counts are estimates and display `~`; query results and explicit counts come from actual reads.
- The same Ask, Structure, History, sorting, CSV export, and follow-up flows work with either provider. Gemini receives the correct SQL dialect and schema, without database credentials or result rows.
- Connections are read-only unless **Allow changes after I confirm them** is checked when connecting. Reads run in database-enforced read-only transactions. Changing permissions requires adding a new connection.
- Enabled changes support INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, and DROP TABLE through the usual stored confirmation tokens. Preparing a PostgreSQL write never executes it, even in a rolled-back preview. PostgreSQL write previews do not provide an exact affected-row count. Constraints are finally checked when a confirmed command runs.
- PostgreSQL operations use five-second statement and two-second lock timeouts. Results are fetched in bounded pages. SQL parsing restricts requests to the connected schema and supported data operations/functions; roles, server functions, temporary tables, file operations, and transactions cannot be changed through chat.
- PostgreSQL data stays on its server. History stores result snapshots locally; run a request again for current data. SQLite download is offered only for SQLite connections.

## Saved credentials

Connection settings are authenticated and encrypted in the local repository with Fernet. The separate `data_genie_repository.sqlite3.key` file is readable only by its owner. Keep the repository and key together when moving or backing up the app. Losing the key requires reconnecting. Both files are ignored by Git. Session, schema, and test responses never include the connection URL or password.

## Verify

For a ready-to-use local database (PostgreSQL must be installed):

```bash
.venv/bin/python scripts/postgres_demo.py start
.venv/bin/python scripts/postgres_demo.py url
```

Paste that URL into **Databases → PostgreSQL**, keep schema `public`, test, and connect. Try “show all customers from Missouri”, then “which ones are in Iowa”. The isolated demo has its own dedicated user and password, listens only on loopback port 55432, and stores its settings under ignored `db/postgres-demo/`. Re-running `start` preserves your data. Use `.venv/bin/python scripts/postgres_demo.py stop` when finished.

For automated checks:

```bash
.venv/bin/python -B -m unittest
GENIE_TEST_POSTGRES=1 .venv/bin/python -B -m unittest tests.test_postgres_integration
```

The integration suite requires `initdb` and `postgres` on PATH. It creates a disposable cluster on a random loopback port and removes it afterward. It covers schema and relationships, reads, follow-ups, pagination, encrypted persistence, account ownership, read-only enforcement, confirmed/declined writes, and table creation/renaming. It never connects to your existing databases.
