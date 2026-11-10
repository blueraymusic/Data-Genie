# Data Genie

Ask your database questions in plain English. Use a SQLite file or connect PostgreSQL, see the SQL and results, then ask a follow-up. Reads run immediately; changes always wait for your confirmation.

[Open Data Genie](https://data-genie.space/) · [Log in](https://data-genie.space/signin) · [Sign up](https://data-genie.space/signup) · [FAQ](https://data-genie.space/faq) · [Contact us](https://data-genie.space/contact)

![Data Genie homepage in light mode](docs/images/homepage.jpg)

## The workspace

- Upload a SQLite file, connect PostgreSQL, create an empty database, or explore the sample.
- Ask questions using Data Genie AI, or write SQL without an API key. The SQL tab includes examples.
- Add, rename, or delete tables and columns in Structure, with a SQL preview before each change.
- Sort, copy, or export results as CSV, and revisit saved requests in History.
- Create a team, invite teammates with a private code, and grant or revoke access per database.
- Write reports from a blank page or template, or draft with Data Genie AI. Owners share approved reports; viewers see only shared reports.
- Attach PDFs or images to an Ask request for extra context.

Choose **Create team workspace** on the database screen, name it, then add a database in the new workspace. Existing databases stay in your personal workspace. Invitations use a private code you share yourself; Data Genie does not send email.

See the [workspace guide](docs/user-guide.md) for examples and [workspaces and access](docs/workspaces.md) for sharing. Account, Teams, and saved History are available without a database connection.

![Workspace showing a request, its SQL translation, and matching customers](docs/images/workspace.jpg)

Built with React, Vite, Python, and SQLite. Screenshots use sample data.

## Folders

```text
frontend/   React pages, components, styles, and Vite configuration
backend/    Python services, database connectors, and server
azure/      Terraform, deployment pipeline, and cloud requirements
tests/      Python tests; React tests live beside the frontend
scripts/    Local startup, demo data, and deployment helpers
docs/       Guides, design notes, and screenshots
backup/     Private local recovery copies, excluded from Git
db/         Local accounts, history, and working databases, excluded from Git
```

## Run locally

You'll need Python 3.9+ and Node.js 22.12+.

```bash
git clone --branch dev https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
npm install
npm run build
npm start
```

For local development, open the address printed by `npm start`, sign up, and choose a database.

`npm start` uses the project's `.venv` when available. `npm run dev` starts the frontend only; keep the server running too.

If port 8000 is busy, run `npm start -- 8001`.

For live frontend updates, start Vite in another terminal:

```bash
npm run dev
```

Open the URL Vite prints. It forwards API requests to the Python server.

## Optional AI setup

Copy `.env.example` to `.env` and add your `GEMINI_API_KEY`. The model is configured with `GEMINI_MODEL` in the same file. Without a key, use the SQL tab or the forms in Structure. Neither sends requests to AI.

Data Genie sends the configured AI service your database structure and recent conversation context, including request text, SQL, and clarifications. Result rows are not sent automatically. Files attached to Ask and source notes explicitly submitted for an AI report are sent to the configured AI service. Attachments are limited to two files and 4 MB combined, and are not saved in History.

Microsoft sign-in is also optional. See the [Microsoft sign-in setup](docs/microsoft-sign-in.md) to add **Continue with Microsoft** alongside the existing password accounts.

## Connect PostgreSQL

The hosted app includes the connector. For local setup, install the optional packages using the [database connections guide](docs/database-connections.md).

Choose **Databases → PostgreSQL**, paste your connection URL, and test it. **Connection options** holds the optional name and schema, which defaults to `public`. Connections start read-only. Enable **Allow changes after I confirm them** to review and confirm edits to the live database. Saved connection settings are encrypted.

Confirmed edits are saved in PostgreSQL directly; no download or upload is needed. CSV downloads are copies of result rows. This is a direct PostgreSQL connector; an MCP client or server is not included yet.

See [database connections](docs/database-connections.md) for setup, a local sample database, and testing.

## Host on Azure

The [Azure deployment guide](docs/azure-free-hosting.md) covers Terraform variables, the Azure DevOps pipeline, and storage limits. Hosted accounts and data are separate from local installations; existing local data is not uploaded automatically.

## Checks

```bash
npm test
python3 -B -m unittest
```

Accounts and history stay with the Data Genie installation, with hashed passwords. Local databases and API keys are excluded from Git. See [SECURITY.md](SECURITY.md) for security details.
