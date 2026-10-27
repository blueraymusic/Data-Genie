# Data Genie

Ask your SQLite database questions in plain English, see the SQL and results, and follow up like a conversation. Reads run immediately. Changes wait for your confirmation.

The app uses React, Vite, and a Python backend. Accounts, databases, and history stay on your computer.

## Run it

You'll need Python 3.9+ and Node.js 22.12+.

```bash
npm install
npm run build
python3 -B server.py
```

Open [localhost:8000](http://localhost:8000), create an account, and upload a SQLite file, create a database, or try the sample.

For live frontend updates, keep the Python server running and run this in another terminal:

```bash
npm run dev
```

Open the URL Vite prints.

## Gemini

Create a local `.env` using `.env.example` and add your Gemini API key. Gemini receives the database structure and recent request context, without result rows. Without a key, use Keywords mode in Account & preferences.

## Tests

```bash
npm test
python3 -B -m unittest
```
