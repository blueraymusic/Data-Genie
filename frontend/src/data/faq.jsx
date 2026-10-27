export const faqGroups = [
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      {
        question: 'What can I do with Data Genie?',
        search:
          'Ask questions about a SQLite database, find and count records, add or update data, and create or change tables. Data Genie translates your request into SQL and shows the result alongside it.Reads run immediately. Changes wait for your confirmation, and your requests stay in History.',
        answer: (
          <>
            <p>
              Ask questions about a SQLite database, find and count records, add or update data, and
              create or change tables. Data Genie translates your request into SQL and shows the
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
          'Choose Sign up to create a local account, or Log in if you already have one. Then create a new database, upload an existing SQLite file, or try the sample with customers, products, and sales.A new database starts empty unless you select the example notes table. Use + New beside Tables to add your own table, or describe the table you want in the request bar.',
        answer: (
          <>
            <p>
              Choose <strong>Sign up</strong> to create a local account, or <strong>Log in</strong>{' '}
              if you already have one. Then create a new database, upload an existing SQLite file,
              or try the sample with customers, products, and sales.
            </p>
            <p>
              A new database starts empty unless you select the example notes table. Use{' '}
              <strong>+ New</strong> beside Tables to add your own table, or describe the table you
              want in the request bar.
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
        question: 'Will my original file change?',
        search:
          'In the browser, Data Genie works on a copy of your uploaded file. Confirmed changes affect that working copy, while your original upload stays unchanged.Download your updated SQLite file from Account & preferences. If you use the separate command-line tool, it works directly on the database path you give it.',
        answer: (
          <>
            <p>
              In the browser, Data Genie works on a copy of your uploaded file. Confirmed changes
              affect that working copy, while your original upload stays unchanged.
            </p>
            <p>
              Download your updated SQLite file from <strong>Account &amp; preferences</strong>. If
              you use the separate command-line tool, it works directly on the database path you
              give it.
            </p>
          </>
        ),
      },
      {
        question: 'What does Gemini receive about my database?',
        search:
          'Gemini receives your request and the database structure: table and column names, data types, and relevant key and constraint information. This helps it generate SQL for the database you are actually using.Data Genie does not automatically send your table rows, saved history, file paths, or profile to Gemini. Any values you type into a request are included in that request.',
        answer: (
          <>
            <p>
              Gemini receives your request and the database structure: table and column names, data
              types, and relevant key and constraint information. This helps it generate SQL for the
              database you are actually using.
            </p>
            <p>
              Data Genie does not automatically send your table rows, saved history, file paths, or
              profile to Gemini. Any values you type into a request are included in that request.
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
          'Data Genie validates the SQL first. Read requests run immediately. For a change, it checks the statement against a temporary copy and presents the SQL for review before changing your working database.Use the confirmation button, labelled with the action such as Add records, to proceed, or choose Don\u2019t run to decline. Finish that decision before sending another request.',
        answer: (
          <>
            <p>
              Data Genie validates the SQL first. Read requests run immediately. For a change, it
              checks the statement against a temporary copy and presents the SQL for review before
              changing your working database.
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
          'You see the SQL and a preview of the change. For a delete, the confirmation shows the number of rows affected. To drop a table, you must also type its name before confirming.Declining leaves your database unchanged. The declined request stays in History without an executed result.',
        answer: (
          <>
            <p>
              You see the SQL and a preview of the change. For a delete, the confirmation shows the
              number of rows affected. To drop a table, you must also type its name before
              confirming.
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
          'There is currently no automatic undo. History records what happened; it does not restore deleted rows or earlier table definitions.Keep your original database or download a copy before making changes you may want to reverse.',
        answer: (
          <>
            <p>
              There is currently no automatic undo. History records what happened; it does not
              restore deleted rows or earlier table definitions.
            </p>
            <p>
              Keep your original database or download a copy before making changes you may want to
              reverse.
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
          'Your request, translated SQL, status, and available result are saved in a separate local application database. You can search requests, filter by SQL operation, and look back through your sessions.Saved results contain up to 500 rows. If a result is larger, the app marks the saved preview as truncated.',
        answer: (
          <>
            <p>
              Your request, translated SQL, status, and available result are saved in a separate
              local application database. You can search requests, filter by SQL operation, and look
              back through your sessions.
            </p>
            <p>
              Saved results contain up to 500 rows. If a result is larger, the app marks the saved
              preview as truncated.
            </p>
          </>
        ),
      },
      {
        question: 'What happens when I end a session?',
        search:
          'The session\u2019s end time is recorded, and you return to the database chooser. Ending a database session does not erase your working file or saved requests, and it keeps you logged in.Reopen a saved database to start a new session. Choose End session & sign out in the user menu to log out as well.',
        answer: (
          <>
            <p>
              The session’s end time is recorded, and you return to the database chooser. Ending a
              database session does not erase your working file or saved requests, and it keeps you
              logged in.
            </p>
            <p>
              Reopen a saved database to start a new session. Choose{' '}
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
