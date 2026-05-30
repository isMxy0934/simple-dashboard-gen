# Server Layer

`src/server/` contains server-only orchestration, persistence, datasource access,
execution, auth policy, and observability.

Allowed here:

- Repositories and transaction boundaries.
- Runtime services called by route handlers.
- Datasource access and query execution.
- Agent session/task persistence and stream orchestration.
- Server-side checks, quotas, rate limits, and logs.

Rules:

- Add `server-only` where appropriate.
- Keep route handlers in `src/app/api`; keep actual logic here.
- Prefer subdirectories by responsibility, not by transport.
- Do not depend on `src/web/`.
- Do not let request bodies provide trusted `userId` or `workspaceId`; use
  session-derived identity and `WorkspacePolicy`.
- Dashboard writes must preserve the `DashboardDocument` approval path:
  staged draft, checks, proposal, approval, and persistence.

Current subareas:

- `src/server/authoring`: authoring session/task/stream/check services.
- `src/server/cloud`: workspace/dashboard/session cloud persistence.
- `src/server/dashboards`: dashboard persistence.
- `src/server/datasource`: Postgres and datasource access.
- `src/server/execution`: preview and execute-batch execution.
- `src/server/auth`: provider-compatible identity, sessions, CSRF, and workspace policy.
- `src/server/config`: server env loading and provider passthrough allowlists.
- `src/server/guards`: quotas and rate-limit enforcement.
- `src/server/logs`: session log writers and observability sinks.
