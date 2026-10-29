# App audit — October 28, 2026

Reviewed the React pages, account and session flows, database switching, SQL execution, history, results, exports, startup scripts, and public help text. Checks use isolated data rather than the user's databases.

## Fixed

- Account and History no longer require an open database. Saved history can be read after a session ends or its source becomes unavailable, while ownership checks still apply.
- History and Structure stop loading after a failed request and recover through retry or refresh. Cancelled requests cannot replace newer results with stale errors.
- Authenticated visitors are redirected away from sign-in URLs. Old login responses cannot overwrite newer login state or clear a newer browser cookie.
- Reusing a historical request identifies the current database as its destination. Reuse is disabled until a database is open.
- SQLite integers beyond JavaScript's safe range remain exact strings. Duplicate SQL column labels are numbered so joined values are preserved.
- Decimal and large-integer strings sort numerically without rounding. PostgreSQL decimal strings can be charted while exact values remain visible; values outside the safe plotting range stay in a table.
- Summary results expose their underlying rows through **View result data**, including copy and CSV export.
- Long SQLite statements can be interrupted, with timed-out writes rolled back.
- A committed table change remains marked executed if its subsequent schema refresh fails. The saved result explains that the structure needs refreshing.
- Escape returns focus to the account menu button. Mobile navigation remains available on Account and History, including without a database connection.
- Workspace navigation stays selected on Structure and SQL review pages, including URLs with fragments. Invalid URL fragments no longer crash navigation.
- The startup launcher forwards the requested port, reports occupied or invalid ports accurately, and exits cleanly on Ctrl-C.
- Explicitly empty environment variables take precedence over `.env`, so an empty AI key actually disables the local-file key.
- Public help text reflects live PostgreSQL edits, saved snapshots, and the scope of History.

## Verification

215 backend tests and 45 frontend tests pass, including account, SQL confirmation, conversation, pagination, and real PostgreSQL integration checks. The production frontend build passes. The npm advisory scan reported no known vulnerabilities in production or development packages.

Browser checks cover desktop and a 390-pixel mobile layout with a temporary account and sample databases. History remains readable after its source file is removed; Account opens without a database; incomplete input is rejected; valid queries run; mobile navigation and forms stay within the viewport. Live Gemini API calls and hosted database accounts are outside this verification; provider responses are covered through fixtures and the PostgreSQL adapter is exercised against a disposable local server.
