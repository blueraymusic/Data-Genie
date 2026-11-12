# Agent connections

[Main README](../README.md) · [Backend/API](../backend/README.md) · [Full setup guide](../docs/agents.md)

## Hosted MCP

Use this server URL in a client that supports custom remote MCP servers with OAuth:

```text
https://data-genie.space/mcp
```

Follow the browser sign-in, check the client callback address, choose one workspace and allowed actions, then approve. A local program or copied API key is not needed. Your client provider controls which plans support custom connections.

Connections expire after 30 days and can be revoked in **Account → Agents & API**. Database changes still wait for human review in Data Genie; reports stay private drafts until an owner shares them.

## HTTP API and local bridge

For scripts, create an expiring workspace key in Account and use the HTTP API at `https://data-genie.space/api/v1` with a Bearer header.

The optional `server.py` is a local **stdio MCP bridge** to that HTTP API. Install its dependencies on the agent machine:

```bash
python -m pip install -r agents/requirements.txt
```

Set `DATA_GENIE_URL` and `DATA_GENIE_API_KEY` privately in your MCP client's environment. The [setup guide](../docs/agents.md#optional-local-mcp-bridge) contains the full configuration. Hosted OAuth tokens and manually created API keys are not interchangeable.

Both paths use the same workspace permissions and action catalog. See [actions and limits](../docs/agents.md#available-actions), [tests](../tests/README.md), and [security](../SECURITY.md).
