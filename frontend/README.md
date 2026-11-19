# Frontend

[Main README](../README.md) · [Backend](../backend/README.md) · [Tests](../tests/README.md)

The interface uses React and Vite. Pages live in `src/pages`, shared components in `src/components`, and styles in `src/styles`.

Run these commands from the repository root:

```bash
npm install
npm run build
npm start
```

For live UI updates, keep the Python server running and open another terminal:

```bash
npm run dev
```

Use the address Vite prints. Its API, MCP, and OAuth proxies point to the backend on port 8000. `npm run dev` starts the frontend only. `npm run build` produces `frontend/dist`, which the Python server serves locally and on Azure.

Keep changes in focused components. Preserve keyboard focus, draft text, visible loading feedback, and the reduced-motion experience. SQL changes must keep their confirmation step.

Frontend tests live beside the code and run with `npm test`. See the [user guide](../docs/user-guide.md) for expected behavior and the [agent guide](../docs/agents.md) for the browser consent flow.
