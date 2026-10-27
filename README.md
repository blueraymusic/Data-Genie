# Data Genie

Ask your SQLite database questions in plain English. See the SQL and results, then ask a follow-up. Reads run immediately; changes always wait for your confirmation.

![Data Genie homepage in light mode](docs/images/homepage.jpg)

## The workspace

- Upload a SQLite file, create an empty database, or explore the sample.
- Ask questions using Gemini or use Keywords mode without an API key.
- Browse tables and columns, and review SQL before confirming changes.
- Sort, copy, or export results as CSV, and revisit saved requests in History.

![Workspace showing a request, its SQL translation, and matching customers](docs/images/workspace.jpg)

Built with React, Vite, Python, and SQLite. Screenshots use sample data.

## Run locally

You'll need Python 3.9+ and Node.js 22.12+.

```bash
git clone https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
npm install
npm run build
python3 -B server.py
```

Open [localhost:8000](http://localhost:8000), sign up, and choose a database.

For live frontend updates, leave the Python server running and start Vite in another terminal:

```bash
npm run dev
```

Open the URL Vite prints. It forwards API requests to the Python server.

## Optional Gemini setup

Copy `.env.example` to `.env` and add your `GEMINI_API_KEY`. The model is configured with `GEMINI_MODEL` in the same file. Without a key, choose Keywords in Account & preferences.

Gemini receives the database structure and recent conversation context, including request text, SQL, and clarifications. Result rows are not sent to the model.

## Checks

```bash
npm test
python3 -B -m unittest
```

Accounts and history are stored locally, with hashed passwords. Local databases and API keys are excluded from Git. See [SECURITY.md](SECURITY.md) for security details.
