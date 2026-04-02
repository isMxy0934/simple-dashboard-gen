# Server Layer

`src/server/` contains server-only logic.

Allowed here:

- Repositories
- Runtime services
- Data-source access
- Session logging
- Agent session/task persistence and orchestration

Rules:

- Add `server-only` where appropriate.
- Keep route handlers in `src/app/api`; keep actual logic here.
- Prefer subdirectories by responsibility, not by transport.
- Do not depend on `src/web/`.

Current subareas:

- `src/server/agent`: agent session/task/stream services
- `src/server/dashboards`: dashboard persistence
- `src/server/datasource`: Postgres and datasource access
- `src/server/logs`: session log writers and ids
- `src/server/execution`: preview and execute-batch execution
