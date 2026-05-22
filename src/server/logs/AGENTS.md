# Server Logs

Observability migration rules:

- New cross-cutting events go through `observability.emit`.
- Sink implementations must not make route handlers wait on network IO.
- Do not log session tokens, provider API keys, datasource secrets, or raw SQL credentials.
