# Tests

[Main README](../README.md) · [Frontend](../frontend/README.md) · [Backend](../backend/README.md) · [Agents](../agents/README.md)

Run commands from the repository root. Tests use temporary fixture data; keep production credentials out of test configuration.

## Frontend

```bash
npm test
npm run build
```

React tests live in `frontend/src`. They cover forms, permissions, report editing, history, motion preferences, and OAuth consent behavior.

## Backend

```bash
.venv/bin/python -m pip install -r requirements.txt -r tests/requirements.txt
.venv/bin/python -B -m unittest
```

For a focused agent check:

```bash
.venv/bin/python -B -m unittest tests.test_agent_api tests.test_agent_client tests.test_remote_mcp
```

The remote MCP checks exercise discovery, PKCE, browser consent, one-use codes, refresh rotation, revocation, permissions, and the official SDK's HTTP client. Network-restricted environments skip the loopback integration checks. PostgreSQL integration checks require their documented optional test connection; missing optional dependencies also produce skips.

The [Azure pipeline](../azure/README.md) runs checks before deployment. The public release verifier checks HTTPS, deployed assets, process health, and anonymous cloud-backed authentication; it does not sign in or modify user databases.
