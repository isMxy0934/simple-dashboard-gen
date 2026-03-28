# Server Layer

`server/` contains server-only logic.

Allowed here:

- Repositories
- Runtime services
- Data-source access
- Logging
- Agent session/task persistence and orchestration

Rules:

- Add `server-only` where appropriate.
- Keep route handlers in `app/api`; keep actual logic here.
- Prefer subdirectories by responsibility, not by transport.
- Do not depend on `client/` or `components/`.

Current subareas:

- `server/agent`: agent session/task/stream services
- `server/dashboards`: dashboard persistence
- `server/datasource`: Postgres and datasource access
- `server/logging`: operational logging
- `server/runtime`: preview and execute-batch runtime
