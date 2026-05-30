# Server Logs

`src/server/logs/` owns server-side log identifiers, observability sinks, and
session/agent event writing.

Rules:

- New cross-cutting events go through `observability.emit`.
- Sink implementations must not make route handlers wait on network IO.
- Do not log session tokens, provider API keys, datasource secrets, or raw SQL
  credentials.
- Agent/tool events should record stable tool names, proposal ids, fingerprints,
  and status codes, not full prompt payloads or secret-bearing datasource config.
