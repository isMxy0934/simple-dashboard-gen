# Environment Variable Inventory

| Current key | Target handling | Files |
|---|---|---|
| `AUTHORING_AGENT_WALL_CLOCK_MS` | SDS_AUTHORING_AGENT_WALL_CLOCK_MS | `src/ai/authoring/agent/provider-session.ts` |
| `DATABASE_URL` | SDS_DATABASE_URL | `src/server/datasource/postgres.ts` |
| `DATASOURCE_ENCRYPTION_KEY` | SDS_DATASOURCE_ENCRYPTION_KEY | `src/server/datasource/datasource-crypto.ts` |
| `PI_MODEL` | PI_MODEL optional fallback for SDS_LLM_* | `src/ai/providers/pi-model-runtime.ts` |
| `PI_PROVIDER` | PI_PROVIDER optional fallback for SDS_LLM_* | `src/ai/providers/pi-model-runtime.ts` |
| `PI_THINKING_LEVEL` | PI_THINKING_LEVEL optional fallback for SDS_LLM_* | `src/ai/providers/pi-model-runtime.ts` |
