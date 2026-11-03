# Using Data Genie

[Open Data Genie](https://data-genie-blueray321.azurewebsites.net/) · [FAQ](https://data-genie-blueray321.azurewebsites.net/faq)

Sign up or log in, then choose a database. You can create an empty SQLite database, upload a SQLite file, try the sample, or connect PostgreSQL. Hosted accounts and laptop accounts are separate.

## Choose how to work

| View | Use it for |
| --- | --- |
| **Ask** | Describe a request in plain English using Data Genie AI, then inspect its SQL and result. |
| **SQL** | Write one SQL statement directly, without an AI service or API key. |
| **Structure** | Inspect tables and columns, or use forms to change their structure. |
| **History** | Search saved requests and reopen their SQL and result snapshots. |

## Ask in plain English

In the sample database, start with **show all customers**, then ask **which ones are in Iowa**. Data Genie uses the database structure and recent conversation to interpret follow-ups. If it needs more detail, answer its question in the same conversation.

Press **Enter** to ask or **Shift + Enter** for a new line. **New conversation** clears the context for future requests and keeps saved History.

Data Genie AI sends your request, database structure, and recent conversation facts to the configured AI service. Result rows and saved connection credentials are not sent. Values you type into a request are included. If AI is unavailable, open SQL or Structure to continue.

## Run SQL

The SQL editor and **Run SQL** button stay at the bottom while results scroll above. Use **Ctrl/⌘ + Enter** to run; plain Enter adds a line. **Examples** fills the editor without running anything, and **Syntax help** explains the connected database's syntax.

For the sample database:

```sql
SELECT name, state
FROM customers
WHERE state = 'Missouri';
```

Use one statement at a time. A trailing semicolon is optional. Reads run immediately. Writes are prepared for review and require confirmation. PostgreSQL statements must use the connected schema, and read-only connections cannot prepare writes.

![SQL results above the bottom editor](images/sql-workspace.jpg)

## Edit tables and columns

Open **Structure**. **Create table** starts a table with a generated `id` primary key. Then use **Add column** and choose its name and type. Each table also has **Rename table** and **Delete table**; each column has **Rename** and **Delete** where supported.

The forms prepare SQL rather than applying changes immediately. Review the pending change, then confirm it or choose **Don’t run**. Dropping a table also requires typing its name. Database constraints can prevent a change. Existing data types and constraints are shown for inspection; the forms do not convert existing column types.

The Structure toolbar stays available while scrolling. Use **Jump to table** to move directly to a table. The last completed change stays collapsed so it does not bury the table controls.

## Navigate long conversations and History

- Ask and SQL initially show eight recent requests. **Show earlier requests** opens older batches, and **Jump to latest** returns to current work. Older completed results stay collapsed until opened; pending confirmations remain available.
- The workspace caches the latest 50 requests plus unresolved changes. Open **View all in History** for the full saved record; leaving the recent cache does not delete a request.
- History loads 20 requests per page. Its search and page controls stay available while scrolling. **Next** opens older requests, **Previous** returns toward newer ones, and **Newest** returns to the first page.
- Search your words or SQL. Expand **Session & operation** to choose a session or SQL operation. Open an entry's details to load its SQL and saved result. **Use request** prepares it in the current database; it does not silently rerun it.

Saved results are snapshots, with up to 500 rows. Run a request again for current data. Additional result pages read current data without changing the saved snapshot. CSV exports contain the rows currently loaded in the result.

## Know where changes are saved

SQLite uploads use a server-side working copy; download the updated SQLite file from Account to keep a copy outside Data Genie. PostgreSQL is a live connection: confirmed edits affect that database directly, and other applications can see them. Ending a session does not undo a change.

There is no automatic undo. Keep backups before changes you may need to reverse. If a write reports that its outcome could not be saved, check History and the connected database before retrying it.

See [database connections](database-connections.md), [security and privacy](../SECURITY.md), and [Azure hosting](azure-free-hosting.md) for setup and deployment details.
