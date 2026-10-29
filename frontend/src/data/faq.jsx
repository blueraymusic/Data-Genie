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
        question: 'Do I need to know SQL?',
        search:
          'No. In Gemini AI mode, start with a request such as \u201cshow all customers from Missouri\u201d. The generated SQL appears beside your words so you can see how the request was interpreted.The Structure tab shows the tables and columns available in your database. Naming them in your request helps make your intent clear.',
        answer: (
          <>
            <p>
              No. In Gemini AI mode, start with a request such as “show all customers from
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
          'Choose Sign up to create a local account, or Log in if you already have one. Then create a new SQLite database, upload a SQLite file, connect PostgreSQL, or try the sample. A new SQLite database starts empty unless you select the example notes table. Use + New table beside Tables to add your own table, or describe it in the request bar.',
        answer: (
          <>
            <p>
              Choose <strong>Sign up</strong> to create a local account, or <strong>Log in</strong>{' '}
              if you already have one. Then create a new SQLite database, upload a SQLite file,
              connect PostgreSQL, or try the sample.
            </p>
            <p>
              A new SQLite database starts empty unless you select the example notes table. Use{' '}
              <strong>+ New table</strong> beside Tables to add your own table, or describe the
              table you want in the request bar.
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
          'Connect a local or hosted PostgreSQL database, including standard Supabase and Neon connections. In Databases choose PostgreSQL, paste the connection URL and choose a schema, usually public. Test connection checks access without changing data or saving credentials. Connect PostgreSQL saves the connection for your account. Install the optional Python connector dependencies using the README first.',
        answer: (
          <>
            <p>
              Choose <strong>Databases → PostgreSQL</strong>, paste your connection URL, and choose
              a schema, usually <code>public</code>. You can connect a local database or a hosted
              one, including standard PostgreSQL connections from Supabase and Neon.
            </p>
            <p>
              <strong>Test connection</strong> checks access without changing data or saving the
              credentials. <strong>Connect PostgreSQL</strong> saves the connection for your
              account. Install the optional Python connector dependencies using the README first.
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
          'Saved PostgreSQL connection settings are encrypted in the local application repository and belong to your account. A separate local encryption key is needed to reopen them. Saved connection URLs and passwords are not included in AI context; values you type in requests are sent. Query results are stored locally in History. Keep both the repository and its key if you back up or move the app.',
        answer: (
          <>
            <p>
              Saved PostgreSQL connection settings are encrypted in the local application repository
              and belong to your account. A separate local encryption key is needed to reopen them.
              Saved connection URLs and passwords are not included in AI context. Values you type
              into a request are included.
            </p>
            <p>
              Query results are saved locally in History. If you back up or move the app, keep both
              the repository and its key to restore saved connections.
            </p>
          </>
        ),
      },
      {
        question: 'Is this an MCP connector?',
        search:
          'The current version connects directly to PostgreSQL using its native database protocol. It does not include an MCP client or server. You do not need an MCP server to connect your PostgreSQL database to Data Genie.',
        answer: (
          <>
            <p>
              The current version connects directly to PostgreSQL using its native database
              protocol. It does not include an MCP client or server.
            </p>
            <p>You do not need an MCP server to connect your PostgreSQL database to Data Genie.</p>
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
        question: 'What does Gemini receive about my database?',
        search:
          'Gemini receives your request, the database structure, and up to eight recent turns from this conversation. Context includes your messages, assistant replies, clarification questions, SQL, execution status, and brief result summaries. Table rows, other conversations, file paths, and profile details are not sent. Values typed into a request are included. New conversation clears the context for future requests.',
        answer: (
          <>
            <p>
              Gemini receives your request and the database structure: table and column names, data
              types, and relevant key and constraint information. It also receives up to eight
              recent turns from this conversation, including your messages, assistant replies,
              clarification questions, SQL, execution status, and brief result summaries.
            </p>
            <p>
              Table rows, other conversations, file paths, and profile details are not sent. Values
              you type into a request are included. Use New conversation to clear the context for
              future requests; your saved History stays available.
            </p>
          </>
        ),
      },
      {
        question: 'Can I use Data Genie without AI?',
        search:
          'Yes. Choose Keywords in Account & preferences. This local mode supports specific commands such as \u201ccount customers\u201d and \u201cshow sales where amount > 50\u201d. It does not send the request to an AI provider.Gemini AI mode supports more flexible phrasing. If the AI service is unavailable, you can switch to Keywords; the app does not silently change modes.',
        answer: (
          <>
            <p>
              Yes. Choose <strong>Keywords</strong> in Account &amp; preferences. This local mode
              supports specific commands such as “count customers” and “show sales where amount &gt;
              50”. It does not send the request to an AI provider.
            </p>
            <p>
              Gemini AI mode supports more flexible phrasing. If the AI service is unavailable, you
              can switch to Keywords; the app does not silently change modes.
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
          'In AI mode you can continue the current conversation. After show all customers from Missouri, ask which ones are in Iowa. Recent requests and the database structure provide context. Keywords mode supports a narrower set of follow-ups. New conversation clears context for future requests and keeps saved History.',
        answer: (
          <>
            <p>
              Yes. In AI mode, try “show all customers from Missouri”, then “which ones are in
              Iowa”. Recent requests and the database structure provide context. Keywords mode
              supports a narrower set of follow-ups.
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
          'Check the table and column names in Structure, then make your request more specific. For example, \u201cshow customers where state is Missouri\u201d is clearer than \u201cshow people from there\u201d.Keywords mode uses a fixed command grammar, so follow the suggested examples. Use Gemini AI mode when you want to ask more freely.',
        answer: (
          <>
            <p>
              Check the table and column names in <strong>Structure</strong>, then make your request
              more specific. For example, “show customers where state is Missouri” is clearer than
              “show people from there”.
            </p>
            <p>
              Keywords mode uses a fixed command grammar, so follow the suggested examples. Use
              Gemini AI mode when you want to ask more freely.
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
        question: 'What is saved in History?',
        search:
          'Your request, translated SQL, status, and available result are saved locally. Search requests, filter by SQL operation and revisit SQLite and PostgreSQL sessions without a live database connection. Saved results contain up to 500 rows and are snapshots. Structure-only inspections stay in the conversation but are not stored in History. Run requests again for current data.',
        answer: (
          <>
            <p>
              Your request, translated SQL, status, and available result are saved in a separate
              local application database. You can search requests, filter by SQL operation, and look
              back through your sessions.
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
        question: 'How are my account and password stored?',
        search:
          'Your name, email, password hash, and login records are stored in the app\u2019s local SQLite repository, separate from the databases you query. Passwords are salted and hashed; the app does not store the original password.Log in to access your own databases and history. You can change your password in Account & preferences. Other browser logins are signed out when you do.Login expires after 30 minutes of inactivity or 12 hours in total. There is no email-based password recovery in this local version. History from before accounts were introduced stays on disk and is not automatically assigned by matching an email.',
        answer: (
          <>
            <p>
              Your name, email, password hash, and login records are stored in the app’s local
              SQLite repository, separate from the databases you query. Passwords are salted and
              hashed; the app does not store the original password.
            </p>
            <p>
              Log in to access your own databases and history. You can change your password in{' '}
              <strong>Account &amp; preferences</strong>. Other browser logins are signed out when
              you do.
            </p>
            <p>
              Login expires after 30 minutes of inactivity or 12 hours in total. There is no
              email-based password recovery in this local version. History from before accounts were
              introduced stays on disk and is not automatically assigned by matching an email.
            </p>
          </>
        ),
      },
    ],
  },
];
