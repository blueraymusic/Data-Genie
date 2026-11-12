# Backend and API

[Main README](../README.md) · [Frontend](../frontend/README.md) · [Agents](../agents/README.md) · [Tests](../tests/README.md)

The Python backend handles accounts, workspace access, database connections, SQL previews, history, reports, and agent access. SQLite metadata is kept separate from the databases a user connects.

## Run

From the repository root, install the full runtime and build the UI:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm install
npm run build
npm start
```

`npm start` uses `.venv` when available. To choose another backend port, run `npm start -- 8001`. Core local SQLite features also work without the optional cloud, PDF, PostgreSQL, and MCP packages.

Copy `.env.example` to `.env` for optional AI configuration. The existing `GEMINI_API_KEY` and `GEMINI_MODEL` variable names configure Data Genie AI. Keep secrets out of source control. SQL and Structure work without an AI key.

## Connections and APIs

- Browser API routes use the signed-in account, CSRF protection, and current workspace permissions.
- `/api/v1` discovers key-authorized actions; `POST /api/v1/actions/{name}` calls one.
- `/api/v1/openapi.json` describes the HTTP action inputs.
- `/mcp` provides the official SDK's Streamable HTTP transport with browser-based OAuth.
- `/healthz` checks process health. It does not prove a database connection is available.

Agent keys and OAuth access tokens serve different endpoints and are not interchangeable. See [agent setup](../docs/agents.md) for authentication, scopes, expiry, and retries.

`server.py` serves local requests; `wsgi.py` is the Azure/Gunicorn entry point. `remote_mcp.py` adapts the MCP SDK into that same app. `oauth_provider.py` stores OAuth clients, consent requests, codes, and tokens. Database actions still pass through `workbench.py` and live workspace access checks.

For PostgreSQL setup, read [database connections](../docs/database-connections.md). For deployment and data durability, read [Azure](../azure/README.md). See [security](../SECURITY.md) for credential handling and permissions.
