export const faqGroups = [
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      {
        question: 'What can I do with Data Genie?',
        search:
          'Ask questions about SQLite or PostgreSQL, find and count records, add or update data, and create or change tables. Data Genie translates your request into SQL and shows the result alongside it. Reads run immediately. Changes wait for your confirmation, and your requests stay in History.',
        answer: (
          <>
            <p>
              Ask questions about SQLite or PostgreSQL, find and count records, add or update data,
              and create or change tables. Data Genie translates your request into SQL and shows the
              result alongside it.
            </p>
            <p>
              Reads run immediately. Changes wait for your confirmation, and your requests stay in
              History.
            </p>
          </>
        ),
      },
      {
        question: 'Can I try Data Genie without an account?',
        search:
          'Yes. The homepage demo, workspace tour and interactive examples use sample data without an account. Try follow-ups, SQL explanations, sample approvals and history filters. These examples never connect to or change your database. Sign up or log in to use your own SQLite or PostgreSQL database.',
        answer: (
          <>
            <p>
              Yes. The homepage demo, workspace tour and interactive examples use sample data. Try
              follow-ups, SQL explanations, approvals and history filters without an account.
            </p>
            <p>
              These examples never connect to or change your database. Sign up or log in when you
              want to work with your own SQLite or PostgreSQL database.
            </p>
          </>
        ),
      },
      {
        question: 'How can I contact Data Genie?',
        search:
          'Open Contact us to ask a question, report a problem, or share feedback. The form prepares an email draft for you to review and send in your own email app. Copy message is available if you prefer to paste it into webmail. No message is sent automatically. You do not need an account.',
        answer: (
          <>
            <p>
              Open <a href="/contact">Contact us</a> to ask a question, report a problem, or share
              feedback. You do not need an account.
            </p>
            <p>
              The form prepares an email draft for you to review and send. Use{' '}
              <strong>Copy message</strong> if you prefer webmail. No message is sent automatically.
            </p>
          </>
        ),
      },
      {
        question: 'Do I need to know SQL?',
        search:
          'No. In Data Genie AI mode, start with a request such as \u201cshow all customers from Missouri\u201d. The generated SQL appears beside your words so you can see how the request was interpreted. The Structure tab shows the tables and columns available in your database. Naming them in your request helps make your intent clear.',
        answer: (
          <>
            <p>
              No. In Data Genie AI mode, start with a request such as “show all customers from
              Missouri”. The generated SQL appears beside your words so you can see how the request
              was interpreted.
            </p>
            <p>
              The Structure tab shows the tables and columns available in your database. Naming them
              in your request helps make your intent clear.
            </p>
          </>
        ),
      },
      {
        question: 'How do I get my first database?',
        search:
          'Choose Sign up to create an account, or Log in if you already have one. Then create a new SQLite database, upload a SQLite file, connect PostgreSQL, or try the sample. A new SQLite database starts empty unless you select the example notes table. Use + New table beside Tables to add your own table, or describe it in the request bar.',
        answer: (
          <>
            <p>
              Choose <strong>Sign up</strong> to create an account, or <strong>Log in</strong> if
              you already have one. Then create a new SQLite database, upload a SQLite file, connect
              PostgreSQL, or try the sample.
            </p>
            <p>
              A new SQLite database starts empty unless you select the example notes table. Use{' '}
              <strong>+ New table</strong> beside Tables to add your own table, or describe the
              table you want in the request bar.
            </p>
          </>
        ),
      },
      {
        question: 'Can I create and share reports?',
        search:
          'In Teams open Reports and New report. Write from a blank page, use a template, or draft with Data Genie AI from source notes you supply. Members can edit their own drafts. Owners review and share reports with workspace members and viewers. Viewers see only shared reports, not database rows, chats or SQL. Anyone allowed to read a saved report can Download PDF. Only the creator can Delete an active report while a Member or Owner. Anyone who can view an archived report can delete it, with confirmation. Reports are saved snapshots, not live dashboards.',
        answer: (
          <>
            <p>
              Open <strong>Teams → Reports → New report</strong>. Write from a blank page, use a
              template, or draft with Data Genie AI from notes you supply. Members can edit their
              own drafts; the owner reviews and shares them. Viewers see only shared reports.
              Reports are saved snapshots, not live dashboards.
            </p>
            <p>
              Anyone who can read a saved report can choose <strong>Download PDF</strong>, including
              viewers. Only its creator can delete an active report, while they are a Member or
              Owner. Anyone who can view an archived report can delete it, including reports
              retained from a deleted author. Deletion is permanent and asks for confirmation.
            </p>
          </>
        ),
      },
      {
        question: 'Can I attach a PDF or image to a question?',
        search:
          'Attach PDF or image in Ask. Up to two PDF PNG JPEG WebP files and 4 MB combined. Sent to the configured AI service with that request only, not saved in History or reused automatically. Generated SQL and summaries can include information from the file. Database permissions and confirmations still apply.',
        answer: (
          <p>
            Choose <strong>Attach PDF or image</strong> in Ask, then type your request. You can
            attach two PDF, PNG, JPEG, or WebP files up to 4 MB combined. Files go to the configured
            AI service with that request and are not saved in History or automatically reused. SQL
            and summaries may include information from them. Permissions and change confirmations
            still apply.
          </p>
        ),
      },
      {
        question: 'How do I revoke someone’s database access?',
        search:
          'Teams People and access choose person and database Revoke access. Ends existing database sessions and invalidates their pending confirmations. Removing a member clears grants so rejoining restores no permissions. Shared report snapshots must be unshared separately.',
        answer: (
          <p>
            In <strong>People &amp; access</strong>, choose the person and database, then{' '}
            <strong>Revoke access</strong>. Existing database sessions end and pending changes
            cannot be confirmed. Removing a member clears their grants; rejoining does not restore
            them. Shared report snapshots must be unshared separately.
          </p>
        ),
      },
      {
        question: 'Can I share a database with my team?',
        search:
          'Choose Create team workspace on Choose your database or Databases, enter a New workspace name and choose Create workspace. No database connection is needed first. The new team opens in Teams; creating it keeps the current database connection and does not move that database. Add a database in Databases, then invite teammates in People & access as Members or Viewers. Members need explicit permission for each database; joining alone does not grant access. Viewers can read only reports shared by the owner and cannot open raw databases. Shared database changes affect the same underlying data, while each person keeps private chats and History.',
        answer: (
          <>
            <p>
              Choose <strong>Create team workspace</strong> on the database screen, enter a{' '}
              <strong>New workspace name</strong>, then choose <strong>Create workspace</strong>.
              You do not need to open a database first. The new team opens in <strong>Teams</strong>
              ; your current database stays connected and is not moved.
            </p>
            <p>
              Add a database in <strong>Databases</strong>, then use{' '}
              <strong>People &amp; access</strong> to invite teammates as <strong>Members</strong>{' '}
              or <strong>Viewers</strong>.
            </p>
            <p>
              Members need permission for each database; joining alone does not grant access.
              Viewers can read only reports shared by the owner and cannot open raw databases.
              Confirmed changes affect the same shared data, while each person keeps private chats
              and History.
            </p>
          </>
        ),
      },
      {
        question: 'What happens if I delete a team workspace?',
        search:
          'Only the owner can delete a team workspace. In Teams choose Delete workspace and type its exact name. The databases return to the owner’s Personal workspace. Memberships, invitations and database grants are removed, and members’ shared sessions end. Database files, external PostgreSQL data and the owner’s private History are preserved. Deleting a workspace does not drop tables or undo changes. The Personal workspace cannot be deleted.',
        answer: (
          <>
            <p>
              Only the owner can delete a team workspace. In <strong>Teams</strong>, choose{' '}
              <strong>Delete workspace</strong> and type its exact name. The databases return to the
              owner’s <strong>Personal workspace</strong>.
            </p>
            <p>
              Sharing ends: memberships, invitations and database grants are removed, and members’
              shared sessions end. Database files, external PostgreSQL data and the owner’s private
              History are preserved. Deletion does not drop tables or undo changes. Your Personal
              workspace cannot be deleted.
            </p>
          </>
        ),
      },
      {
        question: 'How do workspace invitation codes work?',
        search:
          'The workspace owner enters a teammate account email and creates an invitation, then shares the private code or link with that person. Data Genie does not send invitation emails. The recipient signs in or signs up with the invited email, opens Teams, enters the code in their invitation and chooses Join workspace. Invitations expire after seven days. Codes are shown once and replacing an invitation invalidates its old code.',
        answer: (
          <>
            <p>
              The workspace owner creates an invitation using the teammate’s account email, then
              shares its private code or link with that person. Data Genie does not send invitation
              emails.
            </p>
            <p>
              The recipient signs in or creates an account using the invited email, opens{' '}
              <strong>Teams</strong>, enters the code in their invitation and chooses{' '}
              <strong>Join workspace</strong>. A private link can fill in the code for them.
            </p>
            <p>
              Invitations expire after seven days. Codes are shown once. Replacing an invitation
              invalidates its old code, so keep the new code private.
            </p>
          </>
        ),
      },
      {
        question: 'What if two teammates edit the same database?',
        search:
          'Each person has private chats, History and confirmations while using the same shared database. Before applying a confirmed change, Data Genie checks whether the previewed tables or dependencies changed. A stale change is refused; prepare the request again to review current data. The app holds short locks only while checking and applying a change, never while you review it. Large changes can exceed its bounded preview checks and need database transaction tools.',
        answer: (
          <>
            <p>
              You share the same database, with separate chats, History and confirmations. Before
              applying a change, Data Genie checks whether its previewed tables or dependencies
              changed. If they did, the change is refused and you must prepare the request again.
            </p>
            <p>
              Short locks protect the check and update. A lock is not held while you review a
              confirmation. Operations exceeding the app’s preview limits need your database’s
              transaction tools.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'postgresql',
    title: 'PostgreSQL connections',
    items: [
      {
        question: 'Why won’t my saved PostgreSQL connection open?',
        search:
          'A saved connection stores settings, not a running PostgreSQL server. Start the database server and choose Try again if it is offline. A missing key or saved connection record offers Enter connection details. Start Data Genie with npm start to use the project .venv and installed connector packages. A failed open keeps your current database and saved History.',
        answer: (
          <>
            <p>
              A saved connection stores settings, not a running PostgreSQL server. If the database
              is offline, start it and choose <strong>Try again</strong>. Missing saved details or
              an encryption key offer <strong>Enter connection details</strong>.
            </p>
            <p>
              Start Data Genie with <code>npm start</code> to use its project environment and
              installed connector packages. A failed open keeps your current database and saved
              History.
            </p>
          </>
        ),
      },
      {
        question: 'How do I switch to another saved database?',
        search:
          'Choose Change in the sidebar or Databases in the main navigation. Your saved databases lists SQLite files and PostgreSQL connections. The current database is marked Current. Open another saved database to switch. Confirm or decline pending changes first. The previous session ends only after the new database opens successfully.',
        answer: (
          <>
            <p>
              Choose <strong>Change</strong> in the sidebar or <strong>Databases</strong> in the
              main navigation. Your saved databases lists SQLite databases and PostgreSQL
              connections, with the current one marked <strong>Current</strong>.
            </p>
            <p>
              Choose <strong>Open</strong> beside another database. Confirm or decline pending
              changes first. The previous session ends only after the new database opens
              successfully.
            </p>
          </>
        ),
      },
      {
        question: 'How do I connect PostgreSQL?',
        search:
          'Connect a local or hosted PostgreSQL database, including standard Supabase and Neon connections. In Databases choose PostgreSQL and paste the connection URL. Schema defaults to public. Expand Connection options to change Schema or add an optional Connection name. Test connection checks access without changing data or saving credentials. Connect PostgreSQL saves the connection for your account. For a local installation, follow the README link to install the optional connector dependencies first. The hosted site includes the connector.',
        answer: (
          <>
            <p>
              Choose <strong>Databases → PostgreSQL</strong> and paste your connection URL. The
              schema defaults to <code>public</code>. Expand <strong>Connection options</strong> to
              change <strong>Schema</strong> or add an optional <strong>Connection name</strong>.
              You can use standard PostgreSQL connections from Supabase and Neon.
            </p>
            <p>
              A hosted Data Genie installation requires a public PostgreSQL address and verified
              TLS. Private and loopback addresses are blocked. Use the local installation to connect
              to a database running on your laptop.
            </p>
            <p>
              <strong>Test connection</strong> checks access without changing data or saving the
              credentials. <strong>Connect PostgreSQL</strong> saves the connection for your
              account. For a local installation, follow the README link to install the optional
              connector dependencies first. The hosted site includes the connector.
            </p>
          </>
        ),
      },
      {
        question: 'Do changes in Data Genie affect my PostgreSQL database?',
        search:
          'Yes. PostgreSQL is a live connection. After you enable changes, review the generated SQL and confirm it, the change is saved directly in the connected database. Other apps using that database can see it. No download or upload is needed to save edits. Ending a session does not reverse them. The local demo only changes the demo database on your computer.',
        answer: (
          <>
            <p>
              Yes. This is a live connection. If changes are enabled, Data Genie shows the SQL for
              review and waits for your confirmation. Confirmed edits are saved directly in the
              connected PostgreSQL database, where other apps can see them too.
            </p>
            <p>
              No download or upload is needed to save edits. Ending a session does not reverse them.
              If you use the local PostgreSQL demo, edits affect that demo on your computer.
            </p>
          </>
        ),
      },
      {
        question: 'Why is my PostgreSQL connection read-only?',
        search:
          'Connections are read-only by default. To edit, add a connection with Allow changes after I confirm them checked. An existing read-only connection keeps its original setting. You must still confirm each change, and the PostgreSQL user must have permission to perform it. You can add, update or delete records and create, alter or drop tables in the selected schema.',
        answer: (
          <>
            <p>
              Connections start read-only. To edit, add a connection with{' '}
              <strong>Allow changes after I confirm them</strong> checked. An existing read-only
              connection keeps its original setting.
            </p>
            <p>
              You can add, update or delete records and create, alter or drop tables in the selected
              schema. Each change still needs confirmation, and your PostgreSQL user must have
              permission to perform it.
            </p>
          </>
        ),
      },
      {
        question: 'Can I download my PostgreSQL database?',
        search:
          'PostgreSQL data stays on its server and confirmed changes are saved there directly. Download CSV exports the rows currently loaded in a result, not a full database backup. Full PostgreSQL backups are handled outside Data Genie. Download SQLite file is only available for SQLite databases.',
        answer: (
          <>
            <p>
              PostgreSQL data stays on its server, and confirmed changes are saved there directly.
              There is no database file to download from Data Genie for this connection.
            </p>
            <p>
              <strong>Download CSV</strong> exports the rows currently loaded in a result. Full
              PostgreSQL backups are handled outside Data Genie.{' '}
              <strong>Download SQLite file</strong> is only available for SQLite databases.
            </p>
          </>
        ),
      },
      {
        question: 'Why do some table counts start with ~?',
        search:
          'A tilde ~ marks an estimated PostgreSQL table row count from database statistics. It may lag behind changes. A dash means no estimate is available. Ask count customers for an actual count of that table.',
        answer: (
          <>
            <p>
              A <code>~</code> marks an estimated row count from PostgreSQL statistics, which may
              lag behind changes. A dash means no estimate is available.
            </p>
            <p>Ask “count customers”, using your table’s name, for an actual count.</p>
          </>
        ),
      },
      {
        question: 'Where are my connection details stored?',
        search:
          'Saved PostgreSQL connection settings are encrypted in the application repository where Data Genie runs and belong to your account. A separate encryption key is needed to reopen them. Saved connection URLs and passwords are not included in AI context; values you type in requests are sent. Query results are stored in History where Data Genie runs. Keep both the repository and its key if you back up or move the app.',
        answer: (
          <>
            <p>
              Saved PostgreSQL connection settings are encrypted in the application repository where
              Data Genie runs and belong to your account. A separate encryption key is needed to
              reopen them. Saved connection URLs and passwords are not included in AI context.
              Values you type into a request are included.
            </p>
            <p>
              Query results are saved in History where the app runs. If you back up or move the app,
              keep both the repository and its key to restore saved connections.
            </p>
          </>
        ),
      },
      {
        question: 'Is this an MCP connector?',
        search:
          'PostgreSQL connects directly using its native database protocol. Agents can use the hosted MCP endpoint https://data-genie.space/mcp with browser OAuth sign-in and workspace consent, the HTTP API with an agent key, or the optional local stdio bridge.',
        answer: (
          <>
            <p>
              PostgreSQL connects directly using its native database protocol. You do not need an
              MCP server to connect a database.
            </p>
            <p>
              For a remote MCP connection, enter <code>https://data-genie.space/mcp</code> in a
              client that supports custom servers with OAuth. Sign in to Data Genie, choose a
              workspace and allowed actions, then approve the connection. You can revoke it in{' '}
              <strong>Account → Agents &amp; API</strong>. The local bridge and HTTP API remain
              available for scripts using agent keys.
            </p>
            <p>
              <a
                href="https://github.com/blueraymusic/Data-Genie/blob/dev/docs/agents.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the agent setup guide
              </a>
              .
            </p>
          </>
        ),
      },
      {
        question: 'What can an agent do with my account?',
        search:
          'Agent key scopes permissions expire revoke read databases query prepare change manual confirmation create blank SQLite database private report draft AI report generate viewer shared reports only no publishing invitations permissions.',
        answer: (
          <>
            <p>
              You choose the actions and one workspace when creating a key. Agents can read
              permitted data, prepare SQL changes, create blank SQLite databases if you are the
              owner, and draft reports. Keys cannot override your current role or database
              permissions.
            </p>
            <p>
              SQL changes wait for your confirmation in the site. Reports stay private drafts until
              an owner shares them. Agents cannot invite people, grant access, publish reports, or
              confirm changes through the API. Viewers can read shared reports only.
            </p>
            <p>
              Keys expire and can be revoked in Account. Changing your password revokes your agent
              keys too. AI drafting sends only the notes explicitly supplied and uses your account’s
              existing allowance.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'your-data',
    title: 'Your data & AI',
    items: [
      {
        question: 'Which database files can I upload?',
        search:
          'Upload a valid SQLite database with a .db, .sqlite, or .sqlite3 extension, up to 25 MB. Renaming a spreadsheet or another file type does not turn it into a SQLite database.',
        answer: (
          <>
            <p>
              Upload a valid SQLite database with a <code>.db</code>, <code>.sqlite</code>, or{' '}
              <code>.sqlite3</code> extension, up to 25 MB. Renaming a spreadsheet or another file
              type does not turn it into a SQLite database.
            </p>
          </>
        ),
      },
      {
        question: 'Will my original SQLite file change?',
        search:
          'In the browser, Data Genie works on a copy of your uploaded SQLite file. Confirmed changes affect that working copy, while the file you uploaded from your computer stays unchanged. Download your updated SQLite file from Account & preferences. PostgreSQL connections edit the live database after confirmation. The separate command-line tool works directly on the database path you give it.',
        answer: (
          <>
            <p>
              In the browser, Data Genie works on a copy of your uploaded SQLite file. Confirmed
              changes affect that working copy, while the file you uploaded from your computer stays
              unchanged.
            </p>
            <p>
              Download your updated SQLite file from <strong>Account &amp; preferences</strong>.
              PostgreSQL connections edit the live database after confirmation. The separate
              command-line tool works directly on the database path you give it.
            </p>
          </>
        ),
      },
      {
        question: 'What does Data Genie AI receive about my database?',
        search:
          'Data Genie sends the configured AI service your request, the database structure, and up to eight recent turns from this conversation. Context includes your messages, assistant replies, clarification questions, SQL, execution status, and brief result summaries. Table rows are not sent automatically. Attached files and source notes for AI reports are sent when you submit them. Other conversations, file paths, and profile details are not sent. Values typed into a request are included. New conversation clears the context for future requests.',
        answer: (
          <>
            <p>
              Data Genie sends the configured AI service your request and the database structure:
              table and column names, data types, and relevant key and constraint information. It
              also receives up to eight recent turns from this conversation, including your
              messages, assistant replies, clarification questions, SQL, execution status, and brief
              result summaries.
            </p>
            <p>
              Table rows are not sent automatically. Files attached to Ask and source notes for AI
              reports are sent when you submit them. Other conversations, file paths, and profile
              details are not sent. Values you type into a request are included. Use New
              conversation to clear the context for future requests; your saved History stays
              available.
            </p>
          </>
        ),
      },
      {
        question: 'Can I use Data Genie without AI?',
        search:
          'Yes. Open the SQL tab to enter standard SQLite or PostgreSQL statements. Examples cover previewing rows, counts, filters and creating tables. The parser checks statements before running them, and changes need confirmation. Structure has forms for editing tables and columns. Neither SQL nor Structure uses AI. Set your default workspace view in Account & preferences.',
        answer: (
          <>
            <p>
              Yes. Open the <strong>SQL</strong> tab and enter a statement such as{' '}
              <code>SELECT COUNT(*) FROM customers;</code>. Examples help with common queries and
              use the syntax for your connected database. The parser checks statements first;
              changes still wait for confirmation.
            </p>
            <p>
              <strong>Structure</strong> also has forms for editing tables and columns. Neither
              option uses AI. You can set your default workspace view in{' '}
              <strong>Account &amp; preferences</strong>.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'requests-and-changes',
    title: 'Requests & changes',
    items: [
      {
        question: 'Can I preview rows while browsing Structure?',
        search:
          'Choose Sample rows on a table in Structure. Hide sample rows closes the preview, and reopening it reuses the loaded rows. Refresh sample rows fetches current data while the preview is open. Changing sessions or refreshing the schema clears cached samples. Copy results and Download CSV follow your database download permission in sample previews too.',
        answer: (
          <>
            <p>
              Yes. Choose <strong>Sample rows</strong> on a table in <strong>Structure</strong>. Use{' '}
              <strong>Hide sample rows</strong> to close the preview. Opening it again reuses the
              loaded rows; <strong>Refresh sample rows</strong> fetches current data while the
              preview is open.
            </p>
            <p>
              Changing sessions or refreshing the schema clears the samples. Copy and CSV controls
              follow your database’s download permission here too.
            </p>
          </>
        ),
      },
      {
        question: 'Can I edit tables and columns without typing a request?',
        search:
          'Yes. In Structure create a table, rename or delete a table, or add, rename or delete a column or attribute. Choose its type when adding a column. Review the SQL and confirm the change, or choose Don’t run. Read-only connections do not allow editing. Deleting a column removes its values and deleting a table removes its rows. Existing column types and constraints are shown for inspection; the forms do not convert existing data types.',
        answer: (
          <>
            <p>
              Yes. Open <strong>Structure</strong> to create, rename, or delete a table. Each table
              also has controls to add a column, rename a column, or delete one. Choose a data type
              when adding a column.
            </p>
            <p>
              Review the SQL, then confirm or choose <strong>Don’t run</strong>. Read-only
              connections cannot be edited. Deleting a column removes its values; deleting a table
              removes its rows. These changes have no automatic undo.
            </p>
            <p>
              Existing types and constraints are shown for inspection. The forms do not convert
              existing data types; advanced changes can be entered in SQL where your database
              supports them.
            </p>
          </>
        ),
      },
      {
        question: 'When does a request actually run?',
        search:
          'Data Genie validates the SQL first. Read requests run immediately. Changes wait for review and confirmation. SQLite changes are checked against a temporary copy. PostgreSQL previews do not execute writes; confirmed changes run on the live database, where permissions and constraints still apply. Use the confirmation button to proceed or Don’t run to decline. Finish that decision before sending another request.',
        answer: (
          <>
            <p>
              Data Genie validates the SQL first. Read requests run immediately. Changes wait for
              review and confirmation. SQLite changes are checked against a temporary copy.
              PostgreSQL previews do not execute writes; confirmed changes run on the live database,
              where permissions and constraints still apply.
            </p>
            <p>
              Use the confirmation button, labelled with the action such as{' '}
              <strong>Add records</strong>, to proceed, or choose <strong>Don’t run</strong> to
              decline. Finish that decision before sending another request.
            </p>
          </>
        ),
      },
      {
        question: 'What happens before a delete or a dropped table?',
        search:
          'You see the SQL and a preview of the change. SQLite previews show affected-row counts when available. PostgreSQL write previews do not provide an exact affected-row count. To drop a table, type its name before confirming. Declining leaves your database unchanged and the request stays in History.',
        answer: (
          <>
            <p>
              You see the SQL and a preview of the change. SQLite previews show affected-row counts
              when available. PostgreSQL write previews do not provide an exact affected-row count.
              To drop a table, you must also type its name before confirming.
            </p>
            <p>
              Declining leaves your database unchanged. The declined request stays in History
              without an executed result.
            </p>
          </>
        ),
      },
      {
        question: 'Can I undo a confirmed change?',
        search:
          'There is no automatic undo. History records what happened; it does not restore deleted rows or earlier table definitions. Download a SQLite copy before changes you may want to reverse. For PostgreSQL, use a separate database backup outside Data Genie; CSV exports are not full backups.',
        answer: (
          <>
            <p>
              There is currently no automatic undo. History records what happened; it does not
              restore deleted rows or earlier table definitions.
            </p>
            <p>
              For SQLite, download a copy before making changes you may want to reverse. For
              PostgreSQL, keep a separate database backup outside Data Genie; CSV exports are not
              full backups.
            </p>
          </>
        ),
      },
      {
        question: 'Can I ask a follow-up without repeating the table name?',
        search:
          'In Ask you can continue the current conversation. After show all customers from Missouri, ask which ones are in Iowa. Recent requests and the database structure provide context. SQL statements are explicit queries and do not use conversation context. New conversation clears context for future requests and keeps saved History.',
        answer: (
          <>
            <p>
              Yes. In AI mode, try “show all customers from Missouri”, then “which ones are in
              Iowa”. Recent requests and the database structure provide context. Statements in the
              SQL tab are explicit queries and do not use conversation context.
            </p>
            <p>
              Choose <strong>New conversation</strong> to clear context for future requests. Your
              saved History stays available.
            </p>
          </>
        ),
      },
      {
        question: 'What if my request is not understood?',
        search:
          'Check the table and column names in Structure, then make your request more specific. For example, show customers where state is Missouri is clearer than show people from there. Use SQL to write an explicit statement, or Structure to edit tables and columns with forms. These options do not need AI.',
        answer: (
          <>
            <p>
              Check the table and column names in <strong>Structure</strong>, then make your request
              more specific. For example, “show customers where state is Missouri” is clearer than
              “show people from there”.
            </p>
            <p>
              For an explicit query, switch to <strong>SQL</strong> and start from one of its
              examples. To edit tables or columns without a prompt, use <strong>Structure</strong>.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'history-and-sessions',
    title: 'History & sessions',
    items: [
      {
        question: 'How do I navigate a long conversation or history?',
        search:
          'Ask and SQL show recent requests in small batches. Show earlier requests opens older cached requests and Jump to latest returns to current work. All saved requests are available in History, with search, operation filters and pages of older or newer results. Choose Search to apply typed words or SQL. Choosing an operation applies immediately and returns to the first page without submitting your search draft. Clear filters beside Search resets search and operation. Emptying the search field removes its applied search immediately. SQL keeps its editor and Run SQL button at the bottom while results scroll above. Pending changes remain visible for review.',
        answer: (
          <>
            <p>
              Ask and SQL show recent requests in small batches. Choose{' '}
              <strong>Show earlier requests</strong> or <strong>Jump to latest</strong> to move
              around. The SQL editor and Run button stay at the bottom while results scroll above.
            </p>
            <p>
              Open <strong>History</strong> for the full saved record. Type your words or SQL and
              choose <strong>Search</strong>. Choosing an operation applies it immediately and
              returns to the first page; search text you have not submitted stays in the field.
            </p>
            <p>
              <strong>Clear filters</strong> beside Search resets the search and operation. Emptying
              the search field removes its applied search immediately. Use the newer and older page
              controls to move through results. Completed details stay collapsed until opened;
              pending changes remain available for review.
            </p>
          </>
        ),
      },
      {
        question: 'Where is my data stored on the hosted site?',
        search:
          'The hosted Azure installation stores accounts, history, uploaded SQLite working copies and encrypted PostgreSQL connection settings on the server, with durable state in Azure SQL. Your laptop installation is separate: sign up on the hosted site and upload only the SQLite files you want to move. The small hosted installation supports 64 MiB of total application state and 256 files. SQL can pause after inactivity or when its free allowance is exhausted. If the first login takes time, choose Retry connection, then submit the form yourself. Connection retries keep the form details and do not replay a request.',
        answer: (
          <>
            <p>
              On the hosted site, accounts, History, SQLite working copies and encrypted connection
              settings are stored on the server, with durable state in Azure SQL. They are not
              stored only in your browser or on your laptop.
            </p>
            <p>
              A laptop installation has separate accounts and data. Sign up on the hosted site and
              upload only the SQLite files you want to move. PostgreSQL connections continue to work
              directly on the connected database.
            </p>
            <p>
              This small deployment supports 64 MiB of total application state and 256 files across
              all accounts. Azure SQL can pause after inactivity or if its free allowance is
              exhausted. Keep downloaded copies of important SQLite databases.
            </p>
            <p>
              The first connection after inactivity may take a moment. If login reports a connection
              problem, choose <strong>Retry connection</strong>, then submit the form yourself. The
              check keeps your entered details and does not repeat your request.
            </p>
          </>
        ),
      },
      {
        question: 'What is saved in History?',
        search:
          'Your request, translated SQL, status, and available result are saved where Data Genie runs. Search requests, filter by SQL operation and revisit SQLite and PostgreSQL sessions without a live database connection. Saved results contain up to 500 rows and are snapshots. Structure-only inspections stay in the conversation but are not stored in History. Run requests again for current data.',
        answer: (
          <>
            <p>
              Your request, translated SQL, status, and available result are saved in a separate
              application database where Data Genie runs. You can search requests, filter by SQL
              operation, and look back through your sessions.
            </p>
            <p>
              Saved results contain up to 500 rows and are snapshots, rather than a live view of
              SQLite or PostgreSQL. Run the request again for current data.
            </p>
            <p>
              History is available without opening a database. Structure-only inspections stay in
              the conversation but are not stored in History.
            </p>
          </>
        ),
      },
      {
        question: 'How do I sort, copy or export results?',
        search:
          'Click a column heading to sort the rows currently loaded in the result. Copy results copies those rows and Download CSV saves them in their displayed order. Show more loads another page when available. CSV is a result export, not a complete database backup.',
        answer: (
          <>
            <p>
              Click a column heading to sort the rows currently loaded in the result.{' '}
              <strong>Copy results</strong> copies those rows, and <strong>Download CSV</strong>{' '}
              saves them in their displayed order.
            </p>
            <p>
              Use <strong>Show more</strong> to load another page when available. A CSV contains
              result rows; it is not a complete database backup.
            </p>
          </>
        ),
      },
      {
        question: 'What happens when I end a session?',
        search:
          'The session’s end time is recorded, and you return to the database chooser. Ending a session keeps your saved database connection and History, does not reverse confirmed changes, and keeps you logged in. Reopen a saved SQLite database or PostgreSQL connection to start a new session. Choose End session & sign out to log out too.',
        answer: (
          <>
            <p>
              The session’s end time is recorded, and you return to the database chooser. Ending a
              session keeps your saved database connection and History. It does not reverse
              confirmed changes, and it keeps you logged in.
            </p>
            <p>
              Reopen a saved SQLite database or PostgreSQL connection to start a new session. Choose{' '}
              <strong>End session &amp; sign out</strong> in the user menu to log out as well.
            </p>
          </>
        ),
      },
      {
        question: 'Can I log in with Microsoft?',
        search:
          'When enabled on this installation, Continue with Microsoft appears on Log in and Sign up. It supports Microsoft accounts alongside Data Genie passwords. To connect Microsoft to an existing password account, log in first and use Connect Microsoft in Account & preferences. A matching email does not automatically connect accounts. Microsoft-only accounts manage their password with Microsoft. Logging out of Data Genie does not log you out of Microsoft everywhere.',
        answer: (
          <>
            <p>
              When enabled, <strong>Continue with Microsoft</strong> appears on Log in and Sign up.
              Email and password login stays available.
            </p>
            <p>
              To add it to an existing account, log in with your Data Genie password, then choose{' '}
              <strong>Connect Microsoft</strong> in <strong>Account &amp; preferences</strong>. A
              matching email never connects accounts automatically.
            </p>
            <p>
              Microsoft-only accounts manage their password with Microsoft. Signing out of Data
              Genie ends your Data Genie login; it does not sign you out of Microsoft everywhere.
            </p>
          </>
        ),
      },
      {
        question: 'Can I transfer ownership without deleting my account?',
        search:
          'Transfer workspace ownership Teams Workspace settings recipient existing member accepts declines cancel request seven days separate from account deletion databases PostgreSQL saved connections transferred current password Microsoft fresh sign in.',
        answer: (
          <>
            <p>
              Yes. In <strong>Teams → Workspace settings → Transfer ownership</strong>, select an
              existing member, type the workspace name, and confirm your password. Invite them to
              the workspace first if needed. Your account stays active and you remain the owner
              while the request is pending.
            </p>
            <p>
              The recipient sees the request in <strong>Teams → Ownership requests</strong>. They
              review the databases and saved connections, then accept or decline. Only acceptance
              moves ownership and the databases; you then become a Member. You can cancel before
              acceptance, and requests expire after seven days. Notifications are in Data Genie, not
              email.
            </p>
          </>
        ),
      },
      {
        question: 'What happens when I delete my account?',
        search:
          'Account preferences Sign-in security Delete account separate ownership transfer. Finish transfers in Teams before deleting. Owned database copies credentials private history invitations agent access and pending transfers removed. Reports archive remaining members can delete visible reports. No remaining members workspace cascades. Password email DELETE Microsoft fresh sign in five minutes.',
        answer: (
          <>
            <p>
              Open <strong>Account &amp; preferences → Delete account</strong> to review the impact.
              Confirm your email, type <strong>DELETE</strong>, and enter your current password.
              Microsoft-only accounts require a new sign-in within five minutes.
            </p>
            <p>
              Deletion removes your remaining owned Data Genie database copies, connections, private
              history, invitations, logins, pending transfer requests, and agent access. To keep a
              workspace and its databases, complete a separate ownership transfer in Teams first; a
              pending request does not transfer ownership.
            </p>
            <p>
              Reports remain available to their existing audience, attributed to{' '}
              <strong>Deleted account</strong>. Teams with remaining members become read-only
              archives; anyone who can view an archived report can delete it. A workspace without
              remaining members is deleted with its reports. Private drafts are not made public.
              External PostgreSQL servers are never dropped by account deletion.
            </p>
          </>
        ),
      },
      {
        question: 'Can I change my name or profile photo?',
        search:
          'Open Account & preferences, General, then Edit profile. Update your name or choose a PNG, JPEG or WebP photo up to 5 MB and Save changes. Photos are cropped and resized on your device before upload and saved with your account. Remove photo returns to initials. Email cannot be changed here because it is used for sign-in and workspace invitations.',
        answer: (
          <>
            <p>
              Open <strong>Account &amp; preferences → General → Edit profile</strong>. Update your
              name or choose a PNG, JPEG, or WebP photo up to 5 MB, then choose{' '}
              <strong>Save changes</strong>.
            </p>
            <p>
              Your photo is cropped to a square and resized on your device before upload. It is
              stored with your account. Choose <strong>Remove photo</strong> and save to use your
              initials again. Email stays unchanged because it is used for sign-in and workspace
              invitations.
            </p>
          </>
        ),
      },
      {
        question: 'How are my account and password stored?',
        search:
          'Your name, email, password hash, and login records are stored in this Data Genie installation, separate from the databases you query. Passwords are salted and hashed; the app does not store the original password. Log in to access your own databases and history. You can change your password in Account & preferences. Other browser logins are signed out when you do. Login expires after 30 minutes of inactivity or 12 hours in total. There is no email-based password recovery in this version. History from before accounts were introduced stays on disk and is not automatically assigned by matching an email.',
        answer: (
          <>
            <p>
              Your name, email, password hash, and login records are stored where Data Genie runs,
              separate from the databases you query. Passwords are salted and hashed; the app does
              not store the original password.
            </p>
            <p>
              Log in to access your own databases and history. You can change your password in{' '}
              <strong>Account &amp; preferences</strong>. Other browser logins are signed out when
              you do.
            </p>
            <p>
              Login expires after 30 minutes of inactivity or 12 hours in total. There is no
              email-based password recovery in this version. History from before accounts were
              introduced stays on disk and is not automatically assigned by matching an email.
            </p>
          </>
        ),
      },
    ],
  },
];
