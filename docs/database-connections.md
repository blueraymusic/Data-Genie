# Database connections

Data Genie supports local SQLite files and live PostgreSQL databases, including standard PostgreSQL connections from Supabase and Neon. The current connector uses PostgreSQL's native database protocol. It does not include an MCP client or server, and you do not need an MCP server to connect.

## Connect on the hosted site

Open [Data Genie](https://data-genie-blueray321.azurewebsites.net/), [sign up](https://data-genie-blueray321.azurewebsites.net/signup) or [log in](https://data-genie-blueray321.azurewebsites.net/signin), then open [Databases](https://data-genie-blueray321.azurewebsites.net/databases). Choose **PostgreSQL**, paste a URL containing the username, password, host, and database name, and choose a schema (usually `public`). **Test connection** checks access without saving credentials or changing data. **Connect PostgreSQL** saves the connection for your account.

The hosted site already includes the connector. It needs a public PostgreSQL hostname and `sslmode=verify-full` (the default for external hosts). A database listening only on your laptop, a private network, or a cloud-metadata address cannot be reached through the hosted connector. If your provider restricts incoming connections, its network rules must also permit the Data Genie app's outbound addresses; testing a URL does not change those rules.

## Connect from a local installation

With Python 3.10+, install the optional connector and start the app:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-postgres.txt
npm install
npm run build
npm start
```

Open the local address printed by the server and use **Databases → PostgreSQL**. Local installations can connect to a local PostgreSQL server as well as public servers. Their accounts and saved connections are separate from the hosted site.

Use `npm start` to run the server with the project's `.venv` when it exists. Running `python -m backend.server` with another Python may leave PostgreSQL support unavailable even though the packages are installed in `.venv`.

## Reopen and switch

**Change** in the sidebar or **Databases** in the main navigation shows saved SQLite databases and PostgreSQL connections. The current database is marked **Current**. Choose **Open** beside another one to switch; the previous session ends only after the new database opens successfully.

Data Genie saves PostgreSQL connection settings, not a running PostgreSQL server. If the server is offline, the saved connection stays listed and you can start the database and choose **Try again**, or open another database. A missing encryption key or connection record offers **Enter connection details** to add a fresh connection. Existing History stays saved. Resolve any pending change before switching databases.

External hosts default to certificate-verified SSL. A local Data Genie installation also accepts `sslmode=require`; hosted Data Genie requires `sslmode=verify-full`. SSL can be disabled only for loopback connections in local mode. `channel_binding` is preserved, including the `require` value supplied by [Neon's connection strings](https://neon.com/blog/postgres-needs-better-connection-security-defaults). `sslrootcert=system` selects full verification with system certificates. File-based libpq options and arbitrary connection parameters are not accepted.

## Live changes and exports

PostgreSQL is a live connection. Reads query that server; confirmed edits are saved there directly and can be seen by other apps using the same database. There is no download or upload step to save changes. The local demo works the same way, against its own local PostgreSQL database.

To edit, add a connection with **Allow changes after I confirm them** checked. Then ask for a change, review the SQL, and use its confirmation button. An existing read-only connection keeps its original setting. Your PostgreSQL user's permissions still apply, and ending a Data Genie session does not undo confirmed changes.

**Download CSV** exports the rows currently loaded in a result, in their displayed order. **Download SQLite file** applies only to SQLite connections. Data Genie does not export a full PostgreSQL backup or provide automatic undo; keep full database backups separately.

## Work with data

- Schema discovery includes readable tables and views, columns, primary keys, unique/check constraints, and foreign keys. Each connection uses one schema.
- Schema row counts are estimates and display `~`; query results and explicit counts come from actual reads.
- The same [Workspace](https://data-genie-blueray321.azurewebsites.net/app), Structure, [History](https://data-genie-blueray321.azurewebsites.net/history), sorting, CSV export, and follow-up flows work with either provider. Gemini receives the correct SQL dialect and schema, without saved database credentials or result rows. Values typed into requests are part of the AI context.
- Connections are read-only unless **Allow changes after I confirm them** is checked when connecting. Reads run in database-enforced read-only transactions. Changing permissions requires adding a new connection.
- Enabled changes support INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE, and DROP TABLE through the usual stored confirmation tokens. Preparing a PostgreSQL write never executes it, even in a rolled-back preview. PostgreSQL write previews do not provide an exact affected-row count. Constraints are finally checked when a confirmed command runs.
- PostgreSQL operations use five-second statement and two-second lock timeouts. Results are fetched in bounded pages. SQL parsing restricts requests to the connected schema and supported data operations/functions; roles, server functions, temporary tables, file operations, and transactions cannot be changed through chat.
- PostgreSQL data stays on its server. History stores result snapshots in the Data Genie installation you use; run a request again for current data. SQLite download is offered only for SQLite connections.

## Saved credentials

Connection settings are authenticated and encrypted with Fernet in the Data Genie repository and belong to your account. In a local installation without `GENIE_CONNECTION_KEY`, the separate `data_genie_repository.sqlite3.key` file is readable only by its owner. Hosted Azure uses the Terraform-managed `GENIE_CONNECTION_KEY` app setting instead of that local key file. Keep the repository and the key source together when backing up or moving an installation. Losing the key requires reconnecting; it does not recover the password from PostgreSQL. Repository files and local key files are ignored by Git. Session, schema, and test responses do not return the saved connection URL or password.

The hosted installation durably saves accounts, History, SQLite copies, and encrypted connection settings in Azure SQL. Desktop data is separate and is not uploaded automatically. See [hosted storage and limits](azure-free-hosting.md#storage-and-free-tier-limits) and the [live FAQ](https://data-genie-blueray321.azurewebsites.net/faq).

## Verify

For a ready-to-use database with a **local Data Genie installation** (PostgreSQL and the optional connector must be installed):

```bash
.venv/bin/python scripts/postgres_demo.py start
.venv/bin/python scripts/postgres_demo.py url
```

Paste that URL into the local app's **Databases → PostgreSQL**, keep schema `public`, test, and connect. In Ask, try “show all customers from Missouri”, then “which ones are in Iowa”. Without AI, use the SQL tab, for example `SELECT * FROM customers WHERE state = 'Iowa';`. Structure provides forms to add, rename, or delete tables and columns; every change still requires confirmation. The isolated demo has its own dedicated user and password, listens only on loopback port 55432, and stores its settings under ignored `db/postgres-demo/`. It cannot be connected through the hosted site. Re-running `start` preserves your data. Use `.venv/bin/python scripts/postgres_demo.py stop` when finished.

For automated checks:

```bash
.venv/bin/python -B -m unittest
GENIE_TEST_POSTGRES=1 .venv/bin/python -B -m unittest tests.test_postgres_integration
```

The integration suite requires `initdb` and `postgres` on PATH. It creates a disposable cluster on a random loopback port and removes it afterward. It covers schema and relationships, reads, follow-ups, pagination, encrypted persistence, account ownership, read-only enforcement, confirmed/declined writes, and table creation/renaming. It never connects to your existing databases.
