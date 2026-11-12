# Data Genie

Ask your database questions in plain English, inspect the SQL, and follow up. Use SQLite or connect PostgreSQL. Reads run immediately; changes wait for your confirmation.

[Open Data Genie](https://data-genie.space/) · [Log in](https://data-genie.space/signin) · [Sign up](https://data-genie.space/signup) · [FAQ](https://data-genie.space/faq)

![Data Genie homepage](docs/images/homepage.jpg)

## What you can do

- Ask questions or run SQL directly.
- Manage tables and columns with a preview before changes.
- Work with a team, grant database access, and transfer ownership with recipient approval.
- Write reports, share approved findings, and download PDFs.
- Connect an agent through MCP or the HTTP API.

## Start locally

Use Node.js 22.12+ and Python 3.11+ for the full application.

```bash
git clone --branch dev https://github.com/blueraymusic/Data-Genie.git
cd Data-Genie
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm install
npm run build
npm start
```

Open the address printed by the server and create an account. Hosted and local accounts are separate. For live frontend updates, keep the server running and run `npm run dev` in another terminal.

## Find your guide

| Part | Guide |
| --- | --- |
| Using the app, teams, and reports | [User documentation](docs/README.md) |
| React UI and local development | [Frontend](frontend/README.md) |
| Python services and HTTP API | [Backend](backend/README.md) |
| Hosted MCP, OAuth, and the local bridge | [Agent connections](agents/README.md) |
| Terraform, deployment, and hosting | [Azure](azure/README.md) |
| Running checks | [Tests](tests/README.md) |
| Credentials and reporting vulnerabilities | [Security](SECURITY.md) |

Browser-based MCP clients use `https://data-genie.space/mcp`, then sign in and choose a workspace and permissions. Scripts can use workspace-scoped API keys. See the [connection steps](docs/agents.md).

Built with React, Vite, Python, and SQLite. Local databases, accounts, and secrets are excluded from Git.
