# Connect an agent

[Main README](../README.md) · [All guides](README.md) · [Agent overview](../agents/README.md) · [Backend/API](../backend/README.md)

Data Genie provides a hosted MCP server at **`https://data-genie.space/mcp`**, a workspace-scoped HTTP API, and an optional local MCP bridge. Your agent never needs the database password or Data Genie's AI key.

## Connect through your browser

1. In a client supporting custom remote MCP servers with OAuth, enter `https://data-genie.space/mcp` as the server URL.
2. Follow its sign-in link to Data Genie. Log in or create a Data Genie account.
3. Review the client name and callback address. Names are self-reported, so check the destination.
4. Choose one workspace and the actions you want to allow, then select **Allow connection**.
5. Return to your agent. It discovers only the tools permitted by the connection and your current role.

No local Python installation or copied key is required for this flow. Client support and subscription requirements are controlled by the client provider. OAuth connections last 30 days; access tokens expire after one hour and refresh tokens rotate. Revoke a connection under **Account → Agents & API**, or change your Data Genie password to revoke all agent access. Revocation blocks subsequent requests and refreshes.

The endpoint shares the existing Azure B1 app and cloud storage. It adds no hosting instance or paid authentication service; existing Azure usage limits and AI quotas still apply. The browser flow uses OAuth authorization codes with S256 PKCE, registered callback validation, resource-bound tokens, and explicit consent. SQL changes still require review in the site, and reports remain private drafts.

## Create a key

1. Sign in and open **Account → Agents & API**.
2. Select **New agent key**, choose one workspace, and allow only the actions needed.
3. Choose an expiry and confirm your Data Genie password.
4. Copy the key once. Keep it in your agent client's private environment or secret store.

Keys expire after 1, 7, 30, or 90 days. Revoke them in Account at any time. Changing your Data Genie password also revokes your agent keys. Creating keys currently requires a password account. Keys cannot create other keys.

A key's actions are limited by both its selected scopes and your **current** workspace role and database grants. A viewer can access shared reports only. Revoking database access or removing a member also blocks their agent's subsequent requests. A request already running may finish; revocation does not undo completed work.

## Optional local MCP bridge

Use a desktop or IDE client that supports local **stdio MCP servers**. Download or clone this repository, then install the optional connector in a Python 3.11+ environment:

```bash
python -m pip install -r agents/requirements.txt
```

Add a server to your MCP client's settings, replacing the two absolute paths and the private key:

```json
{
  "mcpServers": {
    "data-genie": {
      "command": "/absolute/path/to/python",
      "args": ["/absolute/path/to/Data-Genie/agents/server.py"],
      "env": {
        "DATA_GENIE_URL": "https://data-genie.space",
        "DATA_GENIE_API_KEY": "YOUR_PRIVATE_AGENT_KEY"
      }
    }
  }
}
```

Use the interpreter where you installed `agents/requirements.txt`. For a local Data Genie server, change `DATA_GENIE_URL` to `http://127.0.0.1:8000`. Other HTTP destinations are rejected. HTTPS certificate verification stays enabled, and redirects never receive your key.

Restart or reconnect the MCP client. Ask it to list available Data Genie databases, inspect a database's structure, then query it or draft a report. Tools are discovered from the server according to the key and your current role. Reconnect to refresh discovery after role changes; every tool call still checks access.

The local stdio bridge uses manually created agent keys and calls the HTTP API. The hosted `/mcp` endpoint uses browser-based OAuth instead; manually created keys are not OAuth tokens and cannot be used interchangeably. A cloud agent can also call the HTTP API below without either bridge.

## Available actions

| Scope | Actions |
| --- | --- |
| Always available to a valid workspace key | `workspace` |
| `databases:read` | `list_databases`, `database_schema`, `query` |
| `queries:prepare` (also needs database reading) | `prepare_change` |
| `databases:create` (owner only) | `create_database` — blank SQLite databases |
| `reports:read` | `list_reports`, `get_report` |
| `reports:write` | `save_report_draft` — new or your own unpublished draft |
| `reports:generate` | `generate_report` — text only, not saved automatically |

`query` accepts one read-only SELECT or read-only CTE and returns at most 50 rows. Run schema inspection first; PostgreSQL and SQLite use different SQL dialects. Agents cannot upload files, connect external servers, change permissions, invite people, delete reports, publish reports, or confirm SQL changes through this API.

`prepare_change` validates your normal edit permissions and saves a preview in a separate session. It returns a **review URL**, not an approval secret. Open that link while signed in, select **Review in workspace**, and review the SQL and affected data before confirming. If your current session has a pending change, resolve it before switching. Normal stale-preview checks protect against data changed since preparation.

Reports remain private drafts. Owners review and share them in the site. Updating a draft requires its current `version`; re-read it after a conflict. AI generation uses only the source notes you supply, sends them to the configured AI provider, and uses the account's existing allowance of 10 drafts per hour. Database rows are not sent to AI automatically.

## Use the HTTP API directly

The deployed API is rooted at `https://data-genie.space/api/v1`. Use the address of your own installation when developing locally. These endpoints become available when this version is deployed.

Set `DATA_GENIE_API_KEY` privately and send it in the `Authorization` header. Browser cookies do not authenticate agent routes. Never put a key in a URL or commit it to a repository.

```bash
curl https://data-genie.space/api/v1 \
  -H "Authorization: Bearer $DATA_GENIE_API_KEY"
```

This returns the permitted tools, JSON input schemas, and limits. Each action uses `POST /api/v1/actions/ACTION_NAME` with a JSON object:

```bash
curl https://data-genie.space/api/v1/actions/query \
  -H "Authorization: Bearer $DATA_GENIE_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"database_id": 1, "sql": "SELECT name FROM customers ORDER BY name LIMIT 10"}'
```

Replace the example database ID and columns with the results of `list_databases` and `database_schema`.

For `create_database`, `save_report_draft`, and `prepare_change`, provide a unique `idempotency_key`, such as a UUID. Reuse it only when retrying the **identical** action and arguments. Successful responses are saved, so an ordinary retry returns the original result. Different arguments with the same key are rejected. After an interrupted operation or unknown server error, check the site before retrying: a process failure between the mutation and saving its response can still leave completed work.

The [OpenAPI schema](https://data-genie.space/api/v1/openapi.json) describes action inputs. No key is needed to read the schema; using actions requires a key.

## Limits and troubleshooting

- At most 10 active keys per account; at most 60 requests per minute per key and 120 per minute per client IP. Agent database creation is limited to 10 per hour per account. A `429` includes `Retry-After`.
- `401`: the key is missing, invalid, expired, or revoked. Create a new key in Account.
- `403`: the action, role, membership, or database grant does not allow access. A key cannot override these checks.
- `400`: inspect the argument schema, SQL dialect, report version, or idempotency key. A rejected SQL plan can also return `matched: false`; read the message before proceeding.
- Connection/storage errors: reopen the database in the site and check History before retrying a change. The connector does not retry mutations automatically.

Schema names, rows, and report text are untrusted content. The MCP server labels them as data; your agent should not treat embedded text as instructions. Query results remain in normal account History. Local credentials and databases are excluded from Git.
